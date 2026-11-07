import { PLATFORM_ID, signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AttributeService } from '@data-access/services/attribute.service';
import { BlogService } from '@data-access/services/blog.service';
import { CategoryService } from '@data-access/services/category.service';
import { CurrencyService } from '@data-access/services/currency.service';
import { PageService } from '@data-access/services/page.service';
import { TaxService } from '@data-access/services/tax.service';

import { FormAttribute } from './attribute/form-attribute/form-attribute';
import { FormBlog } from './blog/form-blog/form-blog';
import { FormCategory } from './category/form-category/form-category';
import { FormCurrency } from './currency/form-currency/form-currency';
import { FormPage } from './page/form-page/form-page';
import { FormTax } from './tax/form-tax/form-tax';

const categories = signal<unknown>(undefined);
vi.mock('@data-access/queries/category.queries', () => ({
	injectCategoriesQuery: (p: () => unknown) => (p(), { data: categories }),
}));
vi.mock('@data-access/queries/tag.queries', () => ({
	injectTagsQuery: (p: () => unknown) => (p(), { data: signal(undefined) }),
}));

interface Options {
	params?: Record<string, unknown>;
	inputs?: Record<string, unknown>;
	platform?: string;
}

const mount = <T>(component: Type<T>, service: [unknown, Record<string, unknown>], options: Options = {}) => {
	const router = { navigateByUrl: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: service[0] as never, useValue: service[1] },
			{ provide: Router, useValue: router },
			{ provide: ActivatedRoute, useValue: { params: new BehaviorSubject(options.params ?? {}) } },
			{ provide: PLATFORM_ID, useValue: options.platform ?? 'browser' },
		],
	});
	TestBed.overrideComponent(component, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(component);
	for (const [name, value] of Object.entries(options.inputs ?? {})) fixture.componentRef.setInput(name, value);
	fixture.detectChanges();
	TestBed.tick();
	return { fixture, page: fixture.componentInstance, router };
};

afterEach(() => categories.set(undefined));

describe('FormBlog', () => {
	const rows = [
		{
			id: 1,
			title: 'Weaving',
			blog_thumbnail_id: 4,
			categories: [{ id: 2 }],
			tags: [{ id: 3 }],
			is_featured: 1,
			is_sticky: 0,
			status: 1,
		},
	];
	const render = (options?: Options) =>
		mount(FormBlog, [BlogService, { getBlogs: () => of({ data: rows }) }], options);

	it('fills from a saved post, and has an editor in the browser', async () => {
		const { page } = render({ params: { id: 1 } });
		expect(page.id).toBe(1);
		expect(page.form.value).toMatchObject({ title: 'Weaving', categories: [2], tags: [3] });
		expect(page.editor).toBeDefined();
		expect(await firstValueFrom(page.category$)).toBeUndefined();
	});

	it('copes with a post that is not there', () => {
		const { page } = render({ params: { id: 9 } });
		expect(page.blog).toBeNull();
		expect(page.id).toBeUndefined();
	});

	it('stays blank for a new post, and skips the editor on the server', () => {
		const { page } = render({ platform: 'server' });
		expect(page.blog).toBeNull();
		expect(page.editor).toBeUndefined();
	});

	it('stores images, clears them and ignores lists', () => {
		const { page } = render();
		page.selectThumbnail({ id: 4 } as never);
		page.selectMetaImage({ id: 5 } as never);
		page.selectThumbnail([] as never);
		page.selectMetaImage([] as never);
		expect(page.form.value).toMatchObject({ blog_thumbnail_id: 4, blog_meta_image_id: 5 });
		page.selectThumbnail(null as never);
		page.selectMetaImage(null as never);
		expect(page.form.value).toMatchObject({ blog_thumbnail_id: '', blog_meta_image_id: null });
	});

	it('stores categories and tags, ignoring anything else', () => {
		const { page } = render();
		page.selectCategoryItem([1]);
		page.selectTagItem([2]);
		page.selectCategoryItem('x' as never);
		page.selectTagItem('x' as never);
		expect(page.form.value).toMatchObject({ categories: [1], tags: [2] });
	});

	it('returns to the list from a valid form only', () => {
		const { page, router } = render({ params: { id: 1 } });
		page.submit();
		expect(router.navigateByUrl).toHaveBeenCalledWith('/blog');
		router.navigateByUrl.mockClear();
		page.form.patchValue({ title: '' });
		page.submit();
		expect(router.navigateByUrl).not.toHaveBeenCalled();
	});
});

describe('FormCurrency', () => {
	const rows = [
		{
			id: 1,
			code: 'INR',
			symbol: '₹',
			no_of_decimal: 2,
			exchange_rate: 1,
			symbol_position: 'before_price',
			status: 1,
		},
	];
	const render = (options?: Options) =>
		mount(FormCurrency, [CurrencyService, { getCurrencies: () => of({ data: rows }) }], options);

	it('fills from a saved currency and lists the choices', () => {
		const { page } = render({ params: { id: 1 } });
		expect(page.form.value).toMatchObject({ code: 'INR', symbol: '₹' });
		expect(page.currency_dropdown.length).toBe(page.currency.length);
		expect(page.isBrowser).toBe(true);
	});

	it('copes with a missing one, and knows the server', () => {
		const { page } = render({ params: { id: 9 }, platform: 'server' });
		expect(page.id).toBeUndefined();
		expect(page.isBrowser).toBe(false);
	});

	it('fills the symbol from the picked code', () => {
		const { page } = render();
		const first = page.currency[0] as { currency_code: string; currency_symbol: string };
		page.changeCurrency({ value: first.currency_code } as never);
		expect(page.form.value.symbol).toBe(first.currency_symbol);
		page.changeCurrency({ value: 'nope' } as never);
		expect(page.form.value.symbol).toBeUndefined();
	});

	it('returns to the list from a valid form only', () => {
		const { page, router } = render({ params: { id: 1 } });
		page.submit();
		expect(router.navigateByUrl).toHaveBeenCalledWith('/currency');
		router.navigateByUrl.mockClear();
		page.form.patchValue({ code: '' });
		page.submit();
		expect(router.navigateByUrl).not.toHaveBeenCalled();
	});
});

describe('FormPage', () => {
	const rows = [{ id: 1, title: 'About', content: 'Text', status: 1 }];
	const render = (options?: Options) =>
		mount(FormPage, [PageService, { getPages: () => of({ data: rows }) }], options);

	it('fills from a saved page, with an editor in the browser', () => {
		const { page } = render({ params: { id: 1 } });
		expect(page.form.value.title).toBe('About');
		expect(page.editor).toBeDefined();
	});

	it('copes with a missing page and skips the editor on the server', () => {
		const { page } = render({ params: { id: 9 }, platform: 'server' });
		expect(page.page).toBeNull();
		expect(page.editor).toBeUndefined();
	});

	it('stores the image, clears it and ignores lists', () => {
		const { page } = render();
		page.selectMetaImage({ id: 4 } as never);
		page.selectMetaImage([] as never);
		expect(page.form.value.page_meta_image_id).toBe(4);
		page.selectMetaImage(null as never);
		expect(page.form.value.page_meta_image_id).toBeNull();
	});

	it('returns to the list from a valid form only', () => {
		const { page, router } = render({ params: { id: 1 } });
		page.submit();
		expect(router.navigateByUrl).toHaveBeenCalledWith('/page');
		router.navigateByUrl.mockClear();
		page.form.patchValue({ title: '' });
		page.submit();
		expect(router.navigateByUrl).not.toHaveBeenCalled();
	});
});

describe('FormTax', () => {
	const rows = [{ id: 1, name: 'GST', rate: 5, status: 1 }];
	const render = (options?: Options) => mount(FormTax, [TaxService, { getTaxes: () => of({ data: rows }) }], options);

	it('fills from a saved tax and copes with a missing one', () => {
		expect(render({ params: { id: 1 } }).page.form.value).toMatchObject({ name: 'GST', rate: 5 });
		expect(render({ params: { id: 9 } }).page.id).toBeUndefined();
	});

	it('stays blank for a new one', () => {
		expect(render().page.form.value.name).toBe('');
	});

	it('returns to the list from a valid form only', () => {
		const { page, router } = render({ params: { id: 1 } });
		page.submit();
		expect(router.navigateByUrl).toHaveBeenCalledWith('/tax');
		router.navigateByUrl.mockClear();
		page.form.patchValue({ name: '' });
		page.submit();
		expect(router.navigateByUrl).not.toHaveBeenCalled();
	});
});
