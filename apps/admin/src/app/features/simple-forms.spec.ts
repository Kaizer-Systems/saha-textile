import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID, signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { BehaviorSubject, firstValueFrom, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AttributeService } from '@data-access/services/attribute.service';
import { BlogService } from '@data-access/services/blog.service';
import { CategoryService } from '@data-access/services/category.service';
import { CurrencyService } from '@data-access/services/currency.service';
import { NotificationService } from '@data-access/services/notification.service';
import { PageService } from '@data-access/services/page.service';
import { TaxService } from '@data-access/services/tax.service';

import { FormAttribute } from './attribute/form-attribute/form-attribute';
import { FormBlog, fromShopDate, shopDate } from './blog/form-blog/form-blog';
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
	const post = {
		id: 'blg_1',
		slug: 'real-banarasi',
		title: { en: 'Real Banarasi', bn: 'আসল বেনারসি' },
		excerpt: {},
		content: { en: '<p>Checks</p>', bn: '<p>পরীক্ষা</p>' },
		coverAssetId: 'med_1',
		shareImageAssetId: null,
		categoryIds: ['bcat_1'],
		tagIds: ['btag_1'],
		featured: true,
		sticky: false,
		author: { en: 'Saha Textile', bn: 'সাহা টেক্সটাইল' },
		publishedAt: '2026-11-07T20:00:00.000Z',
		seoTitle: {},
		seoDescription: {},
		status: 'draft',
	};
	const row = {
		post,
		cover: { id: 'med_1', url: 'https://cdn/c', alt: { en: 'Red', bn: 'লাল' }, title: {}, caption: {} },
		shareImage: null,
	};
	const refusal = new HttpErrorResponse({
		status: 400,
		error: { error: { issues: [{ path: ['content', 'bn'], code: 'go_live_blocked', message: 'x' }] } },
	});

	const render = (options: Options = {}, overrides: Record<string, unknown> = {}) => {
		const blogs = {
			getPost: vi.fn(() => of(row)),
			savePost: vi.fn(() => of(row)),
			goLive: vi.fn(() => of({ live: true, gaps: [] })),
			...overrides,
		};
		const toasts = { showSuccess: vi.fn(), showError: vi.fn() };
		const client = { invalidateQueries: vi.fn() };
		const router = { navigateByUrl: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: BlogService, useValue: blogs },
				{ provide: NotificationService, useValue: toasts },
				{ provide: QueryClient, useValue: client },
				{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
				{ provide: Router, useValue: router },
				{ provide: ActivatedRoute, useValue: { params: new BehaviorSubject(options.params ?? {}) } },
				{ provide: PLATFORM_ID, useValue: options.platform ?? 'browser' },
			],
		});
		TestBed.overrideComponent(FormBlog, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(FormBlog);
		for (const [name, value] of Object.entries(options.inputs ?? {})) fixture.componentRef.setInput(name, value);
		fixture.detectChanges();
		TestBed.tick();
		return { page: fixture.componentInstance, blogs, toasts, router, client };
	};

	it('fills from a saved post in every language, and has an editor in the browser', async () => {
		const { page } = render({ params: { id: 'blg_1' } });
		expect(page.id).toBe('blg_1');
		expect(page.form.value).toMatchObject({
			title: 'Real Banarasi',
			slug: 'real-banarasi',
			cover_alt: 'Red',
			categories: ['bcat_1'],
			tags: ['btag_1'],
			is_featured: true,
			published_at: '2026-11-08',
		});
		page.switchLanguage('bn');
		expect(page.form.value.title).toBe('আসল বেনারসি');
		expect(page.cover).toMatchObject({ id: 'med_1', original_url: 'https://cdn/c' });
		expect(page.editor).toBeDefined();
		expect(page.isLive()).toBe(false);
		expect(await firstValueFrom(page.category$)).toBeUndefined();
	});

	it('starts a new post with the shop byline, and skips the editor on the server', () => {
		const { page, blogs } = render({ platform: 'server' });
		expect(blogs.getPost).not.toHaveBeenCalled();
		expect(page.row).toBeNull();
		expect(page.form.value.author).toBe('Saha Textile');
		expect(page.editor).toBeUndefined();
		expect(page.gaps()['bn']?.map((gap) => gap.key)).toEqual(['title', 'content', 'cover_alt']);
	});

	it('stores pictures, clears them and ignores lists', () => {
		const { page } = render();
		page.selectThumbnail({ id: 'm4' } as never);
		page.selectMetaImage({ id: 'm5' } as never);
		page.selectThumbnail([] as never);
		page.selectMetaImage([] as never);
		expect(page.form.value).toMatchObject({ blog_thumbnail_id: 'm4', blog_meta_image_id: 'm5' });
		page.selectThumbnail(null as never);
		page.selectMetaImage(null as never);
		expect(page.form.value).toMatchObject({ blog_thumbnail_id: '', blog_meta_image_id: null });
	});

	it('stores categories and tags, ignoring anything else', () => {
		const { page } = render();
		page.selectCategoryItem(['c1']);
		page.selectTagItem(['t2']);
		page.selectCategoryItem('x' as never);
		page.selectTagItem('x' as never);
		expect(page.form.value).toMatchObject({ categories: ['c1'], tags: ['t2'] });
	});

	it('saves a new post and opens it for editing; needs an English title first', () => {
		const { page, blogs, router, toasts } = render();
		page.submit();
		expect(blogs.savePost).not.toHaveBeenCalled();
		page.form.patchValue({ title: 'Real Banarasi', slug: '', published_at: '2026-11-01' });
		page.selectThumbnail({ id: 'med_1' } as never);
		page.submit();
		expect(blogs.savePost).toHaveBeenCalledWith(
			null,
			expect.objectContaining({
				title: { en: 'Real Banarasi' },
				coverAssetId: 'med_1',
				author: { en: 'Saha Textile', bn: 'সাহা টেক্সটাইল' },
				publishedAt: '2026-10-31T18:30:00.000Z',
			}),
		);
		expect(blogs.savePost.mock.lastCall?.[1]).not.toHaveProperty('slug');
		expect(toasts.showSuccess).toHaveBeenCalledWith('saved');
		expect(router.navigateByUrl).toHaveBeenCalledWith('/blog/edit/blg_1');
	});

	it('keeps the stored publish moment unless the date changes, and refuses a bad address', () => {
		const { page, blogs } = render({ params: { id: 'blg_1' } });
		page.submit();
		expect(blogs.savePost.mock.lastCall?.[1]).not.toHaveProperty('publishedAt');
		expect(blogs.savePost.mock.lastCall?.[1]).toMatchObject({ slug: 'real-banarasi' });
		page.form.patchValue({ published_at: '' });
		page.submit();
		expect(blogs.savePost.mock.lastCall?.[1]).toMatchObject({ publishedAt: null });
		page.form.patchValue({ slug: 'Not Valid' });
		page.submit();
		expect(blogs.savePost).toHaveBeenCalledTimes(2);
	});

	it('shows what stops a save of a live post, and a plain refusal', () => {
		const refused = render({ params: { id: 'blg_1' } }, { savePost: vi.fn(() => throwError(() => refusal)) });
		refused.page.submit();
		expect(refused.page.goLiveGaps()).toEqual([{ field: 'content', locale: 'bn' }]);
		expect(refused.page.gapLabels()).toEqual(['বাংলা: blog_gap_content']);
		refused.page.openGap({ field: 'content', locale: 'bn' });
		expect(refused.page.fields.locale()).toBe('bn');
		refused.page.openLanguageGap({ key: 'title', locale: 'en' });
		expect(refused.page.fields.locale()).toBe('en');
		const plain = render({ params: { id: 'blg_1' } }, { savePost: vi.fn(() => throwError(() => new Error('x'))) });
		plain.page.submit();
		expect(plain.toasts.showError).toHaveBeenCalledWith('blog_rejected');
	});

	it('goes live after saving, and lists the gaps when it cannot', () => {
		const live = render({ params: { id: 'blg_1' } });
		live.page.goLive();
		expect(live.blogs.savePost).toHaveBeenCalled();
		expect(live.blogs.goLive).toHaveBeenCalledWith('blg_1');
		expect(live.toasts.showSuccess).toHaveBeenCalledWith('blog_go_live_done');
		expect(live.router.navigateByUrl).toHaveBeenCalledWith('/blog');
		const blocked = render(
			{ params: { id: 'blg_1' } },
			{ goLive: vi.fn(() => of({ live: false, gaps: [{ field: 'cover', locale: null }] })) },
		);
		blocked.page.goLive();
		expect(blocked.page.goLiveGaps()).toEqual([{ field: 'cover', locale: null }]);
		expect(blocked.router.navigateByUrl).not.toHaveBeenCalled();
		const failing = render({ params: { id: 'blg_1' } }, { goLive: vi.fn(() => throwError(() => new Error('x'))) });
		failing.page.goLive();
		expect(failing.toasts.showError).toHaveBeenCalledWith('blog_rejected');
		const fresh = render();
		fresh.page.goLive();
		expect(fresh.blogs.goLive).not.toHaveBeenCalled();
	});
});

describe('shop dates', () => {
	it('reads and writes the date in Kolkata time', () => {
		expect(shopDate('2026-11-07T20:00:00.000Z')).toBe('2026-11-08');
		expect(shopDate(null)).toBe('');
		expect(fromShopDate('2026-11-08')).toBe('2026-11-07T18:30:00.000Z');
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
