import { PLATFORM_ID, signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProductService } from '@data-access/services/product.service';

import { PbBanner } from './pb-banner';
import { PbBlogPosts } from './pb-blog-posts';
import { PbNewsletter } from './pb-newsletter';
import { PbPiece } from './pb-piece';
import { PbProductRow } from './pb-product-row';
import { PbPromos } from './pb-promos';
import { PbRecentlyViewed } from './pb-recently-viewed';
import { PbVideos } from './pb-videos';

const rails = { data: signal<unknown>(undefined), isPending: signal(true) };
const videos = signal<unknown>(undefined);
const asked = vi.hoisted(() => ({ placement: '' }));

vi.mock('@data-access/queries/product.queries', () => ({ injectHomeRailsQuery: () => rails }));
vi.mock('@data-access/queries/youtube.queries', () => ({
	injectVideoRailQuery: (placement: () => string) => {
		asked.placement = placement();
		return { data: videos };
	},
}));

const section = (over: Record<string, unknown> = {}) => ({
	look: { width: 'page' },
	pieces: [],
	...over,
});

const render = <T>(type: Type<T>, inputs: Record<string, unknown>, providers: unknown[] = []) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: providers as never[] });
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(type);
	for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
	fixture.detectChanges();
	return { fixture, part: fixture.componentInstance };
};

afterEach(() => {
	rails.data.set(undefined);
	rails.isPending.set(true);
	videos.set(undefined);
	localStorage.clear();
});

describe('Page Builder sections', () => {
	it('banner: Main first, the sides after it, sized for the arrangement', () => {
		const main = { name: 'main', pictures: [] };
		const side = (name: string) => ({ name, pictures: [] });
		const { part, fixture } = render(PbBanner, {
			section: section({ arrangement: 'hero_main_side', pieces: [side('right'), main], phoneSides: 'main_only' }),
		});
		expect(part.container()).toBe('container-fluid-lg');
		expect(part.main()).toBe(main);
		expect(part.sides()).toEqual([side('right')]);
		expect(part.mainColumn()).toBe('col-xl-9');
		expect(part.mainSizes()).toBe('(min-width: 1200px) 75vw, 100vw');
		expect(part.sidesColumn()).toBe('col-xl-3 d-none d-md-block');
		expect(part.sideColumn()).toBe('col-12');

		fixture.componentRef.setInput(
			'section',
			section({ arrangement: 'hero_two_sides', pieces: [side('top'), side('bottom')], look: { width: 'full' } }),
		);
		expect(part.main()).toBeNull();
		expect(part.mainColumn()).toBe('col-xl-8');
		expect(part.mainSizes()).toBe('(min-width: 1200px) 66vw, 100vw');
		expect(part.sidesColumn()).toBe('col-xl-4');
		expect(part.sideColumn()).toBe('col-6 col-xl-12');
		expect(part.container()).toBe('container-fluid px-0');
	});

	it('product row: the chosen row’s cards, up to the section’s count, while the rows load', () => {
		const { part, fixture } = render(PbProductRow, { section: section({ source: 'on_sale', cards: 2 }) });
		expect(part.loading()).toBe(true);
		expect(part.products()).toEqual([]);
		rails.isPending.set(false);
		rails.data.set({ newArrivals: [1, 2, 3], bestsellers: [4], featured: [5], sale: [6, 7, 8] });
		expect(part.loading()).toBe(false);
		expect(part.products()).toEqual([6, 7]);

		fixture.componentRef.setInput('section', section({ source: 'new_arrivals' }));
		expect(part.products()).toEqual([1, 2, 3]);
		fixture.componentRef.setInput('section', section({ source: 'trending' }));
		expect(part.products()).toEqual([]);
		fixture.componentRef.setInput('section', section({}));
		expect(part.products()).toEqual([]);
		rails.data.set({ newArrivals: [1] });
		fixture.componentRef.setInput('section', section({ source: 'bestsellers' }));
		expect(part.products()).toEqual([]);
		expect(part.container()).toBe('container-fluid-lg');
	});

	describe('recently viewed', () => {
		const products = (
			cardsFor = vi.fn((slugs: string[]) => of(slugs.map((slug) => ({ slug })))),
			platform = 'browser',
		) =>
			[
				{ provide: ProductService, useValue: { cardsFor } },
				{ provide: PLATFORM_ID, useValue: platform },
			] as unknown[];

		it('fills in the cards the shopper viewed, after the page has painted', () => {
			localStorage.setItem('st_recent', JSON.stringify([{ slug: 'red-saree', at: 1 }]));
			const { part } = render(PbRecentlyViewed, { section: section({ look: { width: 'narrow' } }) }, products());
			TestBed.tick();
			expect(part.products()).toEqual([{ slug: 'red-saree' }]);
			expect(part.container()).toBe('container');
		});

		it('asks for nothing when nothing was viewed, or on the server', () => {
			const cardsFor = vi.fn(() => of([]));
			render(PbRecentlyViewed, { section: section() }, products(cardsFor));
			TestBed.tick();
			localStorage.setItem('st_recent', JSON.stringify([{ slug: 'red-saree', at: 1 }]));
			render(PbRecentlyViewed, { section: section() }, products(cardsFor, 'server'));
			TestBed.tick();
			expect(cardsFor).not.toHaveBeenCalled();
		});
	});

	it('videos: the home rail’s videos, none until they arrive', () => {
		const { part } = render(PbVideos, { section: section() });
		expect(asked.placement).toBe('home');
		expect(part.videos()).toEqual([]);
		videos.set([{ videoId: 'v1' }]);
		expect(part.videos()).toEqual([{ videoId: 'v1' }]);
		expect(part.container()).toBe('container-fluid-lg');
	});

	it('newsletter: the section’s words over the strip’s picture', () => {
		const { part, fixture } = render(PbNewsletter, { section: section({ title: 'Join', subtitle: 'News' }) });
		expect(part.data()).toEqual({
			title: 'Join',
			sub_title: 'News',
			image_url: 'assets/images/data/newsletter.jpg',
			status: true,
		});
		fixture.componentRef.setInput('section', section());
		expect(part.data()).toMatchObject({ title: '', sub_title: '' });
	});

	it('blog posts and promos: their container, and promos’ early picture switch', () => {
		const blog = render(PbBlogPosts, { section: section() }).part;
		expect(blog.container()).toBe('container-fluid-lg');
		expect(blog.slider).toBeTruthy();
		const promos = render(PbPromos, { section: section({ look: { width: 'full' } }), early: true }).part;
		expect(promos.container()).toBe('container-fluid px-0');
		expect(promos.early()).toBe(true);
	});

	it('piece: one picture place with its sizes and early flag', () => {
		const piece = { name: 'main', pictures: [] };
		const { part } = render(PbPiece, { piece });
		expect(part.piece()).toBe(piece);
		expect(part.early()).toBe(false);
		expect(part.sizes()).toBe('100vw');
	});
});
