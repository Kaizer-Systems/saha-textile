import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProductService } from '@data-access/services/product.service';

import { Home } from './home';

const held = vi.hoisted(() => ({ options: null as null | { queryFn: () => Promise<unknown> } }));
const homeData = signal<unknown>(undefined);
const pending = signal(true);
const bannerData = signal<unknown>(undefined);

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

const banner = (position: string, slot: string, url: string) => ({
	position,
	slot,
	images: { desktop: { url } },
});

const render = (cards = vi.fn(() => of<unknown[]>([{ id: 1 }]))) => {
	const home = vi.fn(() => of({ newArrivals: [] }));
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [{ provide: ProductService, useValue: { home, cardsFor: cards } }],
	});
	TestBed.overrideComponent(Home, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(Home);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, home, cards };
};

afterEach(() => {
	homeData.set(undefined);
	bannerData.set(undefined);
	pending.set(true);
	localStorage.clear();
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
