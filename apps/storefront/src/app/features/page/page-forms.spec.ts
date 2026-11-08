import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConsentStore } from '@core/consent/consent.store';
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

const translate = { provide: TranslocoService, useValue: { selectTranslate: () => of('Title') } };

afterEach(() => {
	page.set(undefined);
	catalog.set(undefined);
	fetching.set(false);
	vi.useRealTimers();
});

describe('ContactUs', () => {
	const render = () => {
		const siteConfig = signal<unknown>(null);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [translate, { provide: SiteConfigStore, useValue: { siteConfig } }],
		});
		TestBed.overrideComponent(ContactUs, { set: { imports: [], template: '' } });
		const form = TestBed.createComponent(ContactUs).componentInstance;
		TestBed.tick();
		return { form, siteConfig };
	};

	it('keeps the map back until there is consent or a click', () => {
		const { form } = render();
		expect(form.mapShown()).toBe(false);
		form.mapRequested.set(true);
		expect(form.mapShown()).toBe(true);
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
