import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConsentStore } from '@core/consent/consent.store';
import { LocaleSeo } from '@core/i18n/locale-seo';
import { SiteConfigStore } from '@core/state/site-config.store';
import { ProductService } from '@data-access/services/product.service';

import { ContactUs } from './contact-us/contact-us';
import { Gone } from './gone/gone';
import { Search } from './search/search';
import { StaticPage } from './static-page/static-page';

const page = signal<unknown>(undefined);
const catalog = signal<unknown>(undefined);
const fetching = signal(false);
vi.mock('@data-access/queries/page.queries', () => ({
	injectStaticPageQuery: (slug: () => unknown) => {
		slug();
		return { data: page };
	},
}));
vi.mock('@data-access/queries/product.queries', () => ({
	injectCatalogQuery: (filter: () => unknown) => {
		filter();
		return { data: catalog, isFetching: fetching };
	},
}));

const stores = signal<unknown>(undefined);
const brand = signal<unknown>(undefined);
vi.mock('@data-access/queries/store-location.queries', () => ({ injectStoreLocationsQuery: () => ({ data: stores }) }));
vi.mock('@data-access/queries/brand.queries', () => ({ injectBrandQuery: () => ({ data: brand }) }));
const photo = {
	assetId: 'p1',
	width: 1600,
	height: 1200,
	dominantColor: null,
	roles: {
		store_photo: [
			{ url: 'https://cdn.test/400.webp', width: 400, height: 300 },
			{ url: 'https://cdn.test/800.webp', width: 800, height: 600 },
		],
	},
};

const translate = { provide: TranslocoService, useValue: { selectTranslate: () => of('Title') } };

afterEach(() => {
	stores.set(undefined);
	brand.set(undefined);
	page.set(undefined);
	catalog.set(undefined);
	fetching.set(false);
	vi.useRealTimers();
});

describe('ContactUs', () => {
	const motion = { reduce: false };
	beforeEach(() => {
		motion.reduce = false;
		window.matchMedia = vi.fn(() => ({ matches: motion.reduce })) as never;
	});
	const render = () => {
		const siteConfig = signal<unknown>(null);
		const seo = { applyJsonLd: vi.fn(), removeJsonLd: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				translate,
				{ provide: SiteConfigStore, useValue: { siteConfig } },
				{ provide: LocaleSeo, useValue: seo },
			],
		});
		TestBed.overrideComponent(ContactUs, { set: { imports: [], template: '' } });
		const form = TestBed.createComponent(ContactUs).componentInstance;
		TestBed.tick();
		return { form, siteConfig, seo };
	};

	it('shows the active stores, writes their structured data and takes it away on leaving', () => {
		const { form, seo } = render();
		expect(form.stores()).toEqual([]);
		expect(seo.applyJsonLd).not.toHaveBeenCalled();
		stores.set([
			{
				name: 'Barasat',
				address: 'KB Basu Rd',
				pinCode: '700124',
				mapUrl: 'https://maps.google.com/?cid=1',
				phone: '+913325521595',
				geo: { lat: 22.7, lng: 88.4 },
				hours: [
					{ day: 'mon', open: true, opens: '10:00', closes: '21:00' },
					{ day: 'tue', open: true, opens: '10:00', closes: '21:00' },
					{ day: 'sun', open: false, opens: null, closes: null },
				],
				photos: [photo],
			},
			{
				name: 'Agartala',
				address: 'Colonel Chowmuhani',
				pinCode: '799001',
				mapUrl: 'u',
				phone: null,
				geo: null,
				hours: [],
				photos: [],
			},
		]);
		TestBed.tick();
		expect(form.stores()).toHaveLength(2);
		const data = seo.applyJsonLd.mock.calls.at(-1)?.[1] as { '@graph': Record<string, unknown>[] };
		expect(data['@graph'][0]).toMatchObject({
			name: 'Barasat',
			telephone: '+913325521595',
			image: 'https://cdn.test/800.webp',
			geo: { latitude: 22.7, longitude: 88.4 },
			openingHoursSpecification: [{ dayOfWeek: ['Monday', 'Tuesday'], opens: '10:00', closes: '21:00' }],
		});
		expect(data['@graph'][1]).not.toHaveProperty('telephone');
		expect(data['@graph'][1]).not.toHaveProperty('image');
		form.ngOnDestroy();
		expect(seo.removeJsonLd).toHaveBeenCalledWith('stores-jsonld');
	});

	it('picks photo sizes and the seal', () => {
		const { form } = render();
		expect(form.src(photo as never)).toBe('https://cdn.test/800.webp');
		expect(form.src({ roles: { store_photo: [{ url: 'small', width: 400, height: 300 }] } } as never)).toBe(
			'small',
		);
		expect(form.src({ roles: {} } as never)).toBe('');
		expect(form.srcset(photo as never)).toContain('800w');
		expect(form.seal()).toBeNull();
		brand.set({ seal: { url: 's.png' } });
		TestBed.tick();
		expect(form.seal()).toEqual({ url: 's.png' });
		expect(form.interval).toBe(4000);
	});

	it('keeps the photos still for visitors who ask for less motion', () => {
		motion.reduce = true;
		expect(render().form.interval).toBe(0);
	});

	it('reads the contact details', () => {
		const { form, siteConfig } = render();
		expect(form.contactData).toBeUndefined();
		siteConfig.set({ contact_us: { title: 'Hi' } });
		TestBed.tick();
		expect(form.contactData).toEqual({ title: 'Hi' });
	});

	it('clears only a complete message', () => {
		const { form } = render();
		form.form.patchValue({ name: 'A' });
		form.submit();
		expect(form.form.value.name).toBe('A');
		form.form.patchValue({ email: 'a@b.co', phone: '1', subject: 's', message: 'm' });
		form.submit();
		expect(form.form.value.name).toBeNull();
	});
});

describe('StaticPage', () => {
	const render = (url: string) => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: Router, useValue: { url } }] });
		TestBed.overrideComponent(StaticPage, { set: { imports: [], template: '' } });
		return TestBed.createComponent(StaticPage).componentInstance;
	};

	it('takes the slug from the address', () => {
		expect(render('/privacy-policy/?x=1#top').slug).toBe('privacy-policy');
	});

	it('is empty until the page arrives', () => {
		const view = render('/terms');
		expect(view.content()).toBe('');
		expect(view.breadcrumb()).toBeNull();
		page.set({ title: 'Terms', content: '<p>x</p>' });
		expect(view.content()).toBe('<p>x</p>');
		expect(view.breadcrumb()).toEqual({ title: 'Terms', items: [{ label: 'Terms', active: true }] });
		page.set({ title: 'Terms' });
		expect(view.content()).toBe('');
	});
});

describe('Gone', () => {
	const render = () => {
		const router = { navigate: vi.fn(), navigateByUrl: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [translate, { provide: Router, useValue: router }] });
		TestBed.overrideComponent(Gone, { set: { imports: [], template: '' } });
		return { view: TestBed.createComponent(Gone).componentInstance, router };
	};

	it('goes home or to the collections', () => {
		const { view, router } = render();
		view.back();
		expect(router.navigateByUrl).toHaveBeenLastCalledWith('/');
		view.collections();
		expect(router.navigateByUrl).toHaveBeenLastCalledWith('/collections');
	});

	it('searches for a term, or opens the empty search', () => {
		const { view, router } = render();
		view.search.setValue('  silk ');
		view.searchProduct();
		expect(router.navigate).toHaveBeenLastCalledWith(['/search'], { queryParams: { search: 'silk' } });
		view.search.setValue('  ');
		view.searchProduct();
		expect(router.navigate).toHaveBeenLastCalledWith(['/search'], { queryParams: {} });
	});
});

describe('Search page', () => {
	const render = (query: Record<string, string> = {}, platform = 'browser') => {
		const params = new BehaviorSubject<Record<string, string>>(query);
		const router = { navigate: vi.fn() };
		const service = {
			search: vi.fn(() => of<{ items: unknown[]; total: number }>({ items: [{ id: 1 }], total: 30 })),
			searchClick: vi.fn(),
		};
		const route = { queryParams: params };
		const consent = { allows: vi.fn(() => true) };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				translate,
				{ provide: ActivatedRoute, useValue: route },
				{ provide: Router, useValue: router },
				{ provide: ProductService, useValue: service },
				{ provide: ConsentStore, useValue: consent },
				{ provide: PLATFORM_ID, useValue: platform },
			],
		});
		TestBed.overrideComponent(Search, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(Search);
		fixture.detectChanges();
		return { view: fixture.componentInstance, params, router, service, route, consent };
	};

	afterEach(() => localStorage.clear());

	it('shows the catalogue, a page at a time, with no term', () => {
		const { view, service } = render({ page: '2' });
		fetching.set(true);
		expect(view.loading()).toBe(true);
		expect(view.products()).toEqual([]);
		catalog.set({ data: [{ id: 9 }], total: 50 });
		expect(view.products()).toEqual([{ id: 9 }]);
		expect(view.total()).toBe(50);
		expect(view.page()).toBe(2);
		expect(service.search).not.toHaveBeenCalled();
	});

	it('searches the page in the address as a committed search', () => {
		const { view, service } = render({ search: ' silk ', page: '3' });
		expect(service.search).toHaveBeenCalledWith('silk', { page: 3, pageSize: 24, source: 'page' });
		expect(view.products()).toEqual([{ id: 1 }]);
		expect(view.total()).toBe(30);
		expect(view.loading()).toBe(false);
		expect(view.search.value).toBe('silk');
	});

	it('does not count a search again when Back or Forward returns to it', () => {
		const { service, params, router } = render();
		Object.assign(router, { currentNavigation: () => ({ trigger: 'popstate' }) });
		params.next({ search: 'silk' });
		expect(service.search).toHaveBeenLastCalledWith('silk', { page: 1, pageSize: 24, source: 'typeahead' });
	});

	it('treats a broken page number as page 1', () => {
		const { service } = render({ search: 'silk', page: 'two' });
		expect(service.search).toHaveBeenCalledWith('silk', expect.objectContaining({ page: 1 }));
	});

	it('waits for the browser on the server', () => {
		const { view, service } = render({ search: 'silk' }, 'server');
		expect(service.search).not.toHaveBeenCalled();
		expect(view.loading()).toBe(true);
		expect(view.products()).toEqual([]);
	});

	it('says so when search is down', () => {
		const parts = render();
		parts.service.search.mockReturnValue(throwError(() => new Error('down')));
		parts.params.next({ search: 'silk' });
		expect(parts.view.unavailable()).toBe(true);
		expect(parts.view.products()).toEqual([]);
	});

	it('puts new words in the address from page 1, and remembers them with consent', () => {
		const { view, router, route, consent } = render();
		view.search.setValue('  red   silk ');
		view.searchProduct();
		expect(router.navigate).toHaveBeenLastCalledWith([], {
			relativeTo: route,
			queryParams: { search: 'red silk', page: null },
		});
		expect(localStorage.getItem('st_search')).toContain('red silk');
		view.searchProduct('jamdani');
		expect(router.navigate.mock.lastCall?.[1].queryParams).toEqual({ search: 'jamdani', page: null });
		consent.allows.mockReturnValue(false);
		view.searchProduct('tant');
		expect(localStorage.getItem('st_search')).not.toContain('tant');
		view.searchProduct('   ');
		expect(router.navigate.mock.lastCall?.[1].queryParams).toEqual({ search: null, page: null });
	});

	it('moves between pages in the address', () => {
		const { view, router } = render({ search: 'silk' });
		view.setPage(2);
		expect(router.navigate).toHaveBeenLastCalledWith(
			[],
			expect.objectContaining({ queryParams: { page: 2 }, queryParamsHandling: 'merge' }),
		);
		view.setPage(1);
		expect(router.navigate.mock.lastCall?.[1].queryParams).toEqual({ page: null });
	});

	it('counts a product opened from the results, and only from its link', () => {
		const { view, service } = render({ search: 'silk' });
		const product = { id: 7, slug: 'red-silk' } as never;
		const link = document.createElement('a');
		link.setAttribute('href', '/en/product/red-silk');
		const inner = document.createElement('img');
		link.append(inner);
		view.openedFromResults({ target: document.createElement('button') } as never, product);
		expect(service.searchClick).not.toHaveBeenCalled();
		view.openedFromResults({ target: inner } as never, product);
		expect(service.searchClick).toHaveBeenCalledWith('silk', 7);
		expect(localStorage.getItem('st_search')).toContain('red-silk');
	});
});
