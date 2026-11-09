import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleSeo } from '@core/i18n/locale-seo';
import { ProductService } from '@data-access/services/product.service';

import { Home } from './home';

const held = vi.hoisted(() => ({ options: null as null | { queryFn: () => Promise<unknown> } }));
const homeData = signal<unknown>(undefined);
const pending = signal(true);
const bannerData = signal<unknown>(undefined);
const railData = signal<unknown>(undefined);
const railPlacement = vi.hoisted(() => ({ value: '' }));

vi.mock('@tanstack/angular-query-experimental', async (original) => ({
	...(await original<object>()),
	injectQuery: (options: () => { queryFn: () => Promise<unknown> }) => {
		held.options = options();
		return { data: homeData, isPending: pending };
	},
}));
vi.mock('@data-access/queries/banner.queries', () => ({
	injectBannersQuery: (key: () => string) => {
		key();
		return { data: bannerData };
	},
	bannerSrc: (image: { url: string }) => image.url,
}));
vi.mock('@data-access/queries/youtube.queries', () => ({
	injectVideoRailQuery: (placement: () => string) => {
		railPlacement.value = placement();
		return { data: railData };
	},
}));

const banner = (position: string, slot: string, url: string) => ({
	position,
	slot,
	images: { desktop: { url } },
});

const seo = { applyDocument: vi.fn() };
const transloco = { selectTranslate: (key: string) => of(`t:${key}`) };

const render = (cards = vi.fn(() => of<unknown[]>([{ id: 1 }])), platform = 'browser') => {
	const home = vi.fn(() => of({ newArrivals: [] }));
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ProductService, useValue: { home, cardsFor: cards } },
			{ provide: PLATFORM_ID, useValue: platform },
			{ provide: LocaleSeo, useValue: seo },
			{ provide: TranslocoService, useValue: transloco },
		],
	});
	TestBed.overrideComponent(Home, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(Home);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, home, cards };
};

afterEach(() => {
	homeData.set(undefined);
	bannerData.set(undefined);
	railData.set(undefined);
	pending.set(true);
	localStorage.clear();
});

describe('Home head', () => {
	it('sends the search title and description in the page language', () => {
		render();
		expect(seo.applyDocument).toHaveBeenCalledWith({
			title: 't:home_page_title',
			description: 't:home_page_description',
		});
	});
});

describe('Home YouTube rail', () => {
	it('reads the home placement, and is empty until the API answers', () => {
		const { page } = render();
		expect(railPlacement.value).toBe('home');
		expect(page.railVideos()).toEqual([]);
		railData.set([{ videoId: 'v1' }]);
		expect(page.railVideos()).toEqual([{ videoId: 'v1' }]);
	});
});

describe('Home rails', () => {
	it('asks the API for the rails', async () => {
		const { home } = render();
		await held.options?.queryFn();
		expect(home).toHaveBeenCalledOnce();
	});

	it('shows empty rails while loading, then the data', () => {
		const { page } = render();
		expect(page.railsLoading()).toBe(true);
		expect([page.newArrivals(), page.bestsellers(), page.featuredRail(), page.saleRail()]).toEqual([
			[],
			[],
			[],
			[],
		]);
		homeData.set({ newArrivals: [1], bestsellers: [2], featured: [3], sale: [4] });
		pending.set(false);
		expect(page.railsLoading()).toBe(false);
		expect([page.newArrivals(), page.bestsellers(), page.featuredRail(), page.saleRail()]).toEqual([
			[1],
			[2],
			[3],
			[4],
		]);
	});

	it('fills the recently viewed rail from this browser only', async () => {
		const empty = render();
		await empty.fixture.whenStable();
		expect(empty.cards).not.toHaveBeenCalled();
		localStorage.setItem('st_recent', JSON.stringify([{ slug: 'red-saree', at: Date.now() }]));
		const seen = render();
		await seen.fixture.whenStable();
		expect(seen.cards).toHaveBeenCalledWith(['red-saree']);
		expect(seen.page.recentRail()).toEqual([{ id: 1 }]);
	});

	it('leaves the recently viewed rail to the browser when rendering on the server', async () => {
		localStorage.setItem('st_recent', JSON.stringify([{ slug: 'red-saree', at: Date.now() }]));
		const server = render(undefined, 'server');
		await server.fixture.whenStable();
		expect(server.cards).not.toHaveBeenCalled();
		expect(server.page.recentRail()).toEqual([]);
	});
});

describe('Home promo banners', () => {
	it('stays away until one is live', () => {
		const { page } = render();
		expect(page.promoBanners()).toBeNull();
		bannerData.set({ heroLayout: 'hero_full', banners: [banner('hero', 'main', 'x')] });
		expect(page.promoBanners()).toBeNull();
	});

	it('places each banner in its own slot', () => {
		const { page } = render();
		const second = banner('promo_wide', 'item_2', 'https://cdn/2.webp');
		bannerData.set({ heroLayout: 'hero_full', banners: [second] });
		expect(page.promoBanners()).toEqual({
			first: null,
			second: { image_url: 'https://cdn/2.webp', resolved: second },
		});
	});
});

describe('Home hero', () => {
	it('keeps the theme artwork with no data or no live hero', () => {
		const { page } = render();
		expect(page.heroTheme()).toBeNull();
		expect(page.heroSlides()).toBeNull();
		expect(page.heroThemeData()).toEqual({ main_banner: null, sub_banner_1: null, sub_banner_2: null });
		bannerData.set({ heroLayout: 'hero_full', banners: [banner('strip', 'main', 'x')] });
		expect(page.heroTheme()).toBeNull();
		expect(page.heroSlides()).toBeNull();
	});

	it('uses the carousel for a full hero', () => {
		const { page } = render();
		const main = banner('hero', 'main', 'https://cdn/1.webp');
		bannerData.set({ heroLayout: 'hero_full', banners: [main, banner('hero', 'side', 'https://cdn/2.webp')] });
		expect(page.heroTheme()).toBeNull();
		expect(page.heroSlides()).toEqual([{ image_url: 'https://cdn/1.webp', resolved: main }]);
	});

	it('plays the slides in order, whatever order they arrive in', () => {
		const { page } = render();
		const first = banner('hero', 'main', 'https://cdn/1.webp');
		const second = banner('hero', 'slide_2', 'https://cdn/2.webp');
		const third = banner('hero', 'slide_3', 'https://cdn/3.webp');
		bannerData.set({ heroLayout: 'hero_full', banners: [third, first, second] });
		expect(page.heroSlides()?.map((slide) => slide.resolved)).toEqual([first, second, third]);
	});

	it('reads only the tiles of the chosen layout when every slot is live', () => {
		const { page } = render();
		const left = banner('hero', 'left', 'https://cdn/l.webp');
		const right = banner('hero', 'right', 'https://cdn/r.webp');
		const side = banner('hero', 'side', 'https://cdn/s.webp');
		const top = banner('hero', 'side_top', 'https://cdn/t.webp');
		const bottom = banner('hero', 'side_bottom', 'https://cdn/b.webp');
		const banners = [left, right, side, bottom, top];
		bannerData.set({ heroLayout: 'hero_main_stack', banners });
		expect(page.heroThemeData()).toMatchObject({
			sub_banner_1: { resolved: top },
			sub_banner_2: { resolved: bottom },
		});
		bannerData.set({ heroLayout: 'hero_main_side', banners });
		expect(page.heroThemeData()).toMatchObject({ sub_banner_1: { resolved: side }, sub_banner_2: null });
	});

	it('maps the other layouts onto the theme hero, filling each slot', () => {
		const { page } = render();
		const main = banner('hero', 'main', 'https://cdn/m.webp');
		const left = banner('hero', 'left', 'https://cdn/l.webp');
		const right = banner('hero', 'right', 'https://cdn/r.webp');
		bannerData.set({ heroLayout: 'hero_center_sides', banners: [main, left, right] });
		expect(page.heroTheme()).toBe('tokyo');
		expect(page.heroSlides()).toBeNull();
		expect(page.heroThemeData()).toEqual({
			main_banner: { image_url: 'https://cdn/m.webp', resolved: main },
			sub_banner_1: { image_url: 'https://cdn/l.webp', resolved: left },
			sub_banner_2: { image_url: 'https://cdn/r.webp', resolved: right },
		});
	});
});
