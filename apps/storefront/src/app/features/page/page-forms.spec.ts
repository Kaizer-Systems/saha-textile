import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
		const service = { search: vi.fn(() => of<unknown[]>([{ id: 1 }])) };
		const route = { queryParams: params };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				translate,
				{ provide: ActivatedRoute, useValue: route },
				{ provide: Router, useValue: router },
				{ provide: ProductService, useValue: service },
				{ provide: PLATFORM_ID, useValue: platform },
			],
		});
		TestBed.overrideComponent(Search, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(Search);
		fixture.detectChanges();
		return { view: fixture.componentInstance, params, router, service, route };
	};

	it('shows the catalogue with no term', () => {
		const { view, service } = render();
		fetching.set(true);
		expect(view.loading()).toBe(true);
		expect(view.products()).toEqual([]);
		catalog.set({ data: [{ id: 9 }] });
		expect(view.products()).toEqual([{ id: 9 }]);
		expect(service.search).not.toHaveBeenCalled();
	});

	it('searches in the browser for a term in the address', () => {
		const { view, service } = render({ search: 'silk' });
		expect(service.search).toHaveBeenCalledWith('silk');
		expect(view.products()).toEqual([{ id: 1 }]);
		expect(view.loading()).toBe(false);
		expect(view.search.value).toBe('silk');
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

	it('updates the address on submit', () => {
		const { view, router, route } = render();
		view.search.setValue('cotton');
		view.searchProduct();
		expect(router.navigate).toHaveBeenCalledWith([], { relativeTo: route, queryParams: { search: 'cotton' } });
		expect(view.filter()['search']).toBe('cotton');
	});

	it('clears the search when the box is emptied, and ignores typing', () => {
		vi.useFakeTimers();
		const { view, router, route } = render({ search: 'silk' });
		view.search.setValue('co');
		vi.advanceTimersByTime(300);
		expect(router.navigate).not.toHaveBeenCalled();
		view.search.setValue('');
		vi.advanceTimersByTime(300);
		expect(router.navigate).toHaveBeenCalledWith([], { relativeTo: route, queryParams: { search: '' } });
		expect(view.filter()['search']).toBe('');
	});
});
