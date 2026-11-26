import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ShippingGateway } from '@core/shipping/shipping.gateway';
import { BlogService } from '@data-access/services/blog.service';
import { CategoryService } from '@data-access/services/category.service';
import { NotificationService } from '@data-access/services/notification.service';

import { FormCategory, shippingValue } from './form-category';

const row = (over: Record<string, unknown> = {}) => ({
	id: 'cat_1',
	name: { en: 'Sarees' },
	description: {},
	seoTitle: {},
	seoDescription: {},
	slug: 'sarees',
	parentId: null,
	alsoUnder: [],
	path: 'sarees',
	productCount: 0,
	image: { id: 'a1', url: 'https://cdn.test/a1' },
	icon: { id: 'a2', url: 'https://cdn.test/a2' },
	imageVersions: { a1: 'v3' },
	returnable: false,
	hsnCode: null,
	...over,
});

interface Options {
	id?: string;
	type?: string;
	rows?: unknown[];
	blogRows?: unknown[];
	usage?: 'fails';
	exceptions?: unknown[] | 'fails';
	impact?: unknown;
	saveBlog?: () => unknown;
}

function render(options: Options = {}) {
	const service = {
		getCategoryRows: () => of(options.rows ?? [row()]),
		saveCategory: vi.fn(() => of({ id: 'cat_1' })),
		hsnImpact: vi.fn(() =>
			options.impact === 'fails' ? throwError(() => new Error('offline')) : of(options.impact ?? null),
		),
	};
	const blogs = {
		getTerms: () => of(options.blogRows ?? []),
		saveTerm: vi.fn(options.saveBlog ?? (() => of({ id: 'bcat_1' }))),
	};
	const shipping = {
		categoryUsage: () =>
			options.usage === 'fails'
				? throwError(() => new Error('no permission'))
				: of({ products: 3, ownCharges: 0 }),
		exceptions: () =>
			options.exceptions === 'fails'
				? throwError(() => new Error('no permission'))
				: of(options.exceptions ?? []),
		overview: () => of({ ruleSets: [{ id: 'rs_1', name: 'Heavy parcels' }] }),
	};
	const toasts = { showSuccess: vi.fn(), showError: vi.fn() };
	const modals = { open: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: CategoryService, useValue: service },
			{ provide: BlogService, useValue: blogs },
			{ provide: ShippingGateway, useValue: shipping },
			{ provide: Router, useValue: { navigateByUrl: vi.fn() } },
			{
				provide: ActivatedRoute,
				useValue: { params: new BehaviorSubject(options.id ? { id: options.id } : {}) },
			},
			{ provide: QueryClient, useValue: { invalidateQueries: vi.fn() } },
			{ provide: NotificationService, useValue: toasts },
			{ provide: NgbModal, useValue: modals },
			{
				provide: TranslocoService,
				useValue: { translate: (key: string) => key, selectTranslation: () => of({}) },
			},
		],
	});
	TestBed.overrideComponent(FormCategory, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(FormCategory);
	fixture.componentRef.setInput('type', options.id ? 'edit' : 'create');
	fixture.componentRef.setInput('categoryType', options.type ?? 'product');
	fixture.detectChanges();
	TestBed.tick();
	return { page: fixture.componentInstance, service, blogs, toasts, modals };
}

describe('the category form: loading', () => {
	it('keeps the picture versions, a category that cannot be returned, and its own shipping exceptions', () => {
		const { page } = render({
			id: 'cat_1',
			exceptions: [
				{
					id: 'ex_1',
					target: { kind: 'category', categoryId: 'cat_1', includeSubcategories: true },
					domestic: { kind: 'ruleSet', ruleSetId: 'rs_1' },
					international: { kind: 'ruleSet', ruleSetId: 'rs_gone' },
					note: '',
				},
			],
		});
		expect(page.category['category_image']).toMatchObject({ id: 'a1', versionId: 'v3' });
		expect(page.category['category_icon']).toMatchObject({ id: 'a2' });
		expect(page.form.value.returnable).toBe('no');
		expect(page.shippingUsage()).toEqual({ products: 3, ownCharges: 0 });
		expect(page.zoneExceptions()).toEqual([
			{ zone: 'domestic', label: 'Heavy parcels', cantShip: false },
			{ zone: 'international', label: 'rs_gone', cantShip: false },
		]);
	});

	it('shows no usage or exceptions when the shipping screens are not allowed', () => {
		const { page } = render({ id: 'cat_1', usage: 'fails', exceptions: 'fails' });
		expect(page.shippingUsage()).toBeNull();
		expect(page.zoneExceptions()).toEqual([]);
	});

	it('opens a blog category that no longer exists as a new one', () => {
		const { page } = render({ id: 'bcat_gone', type: 'post' });
		expect(page.id).toBeUndefined();
	});
});

describe('the category form: a changed HSN', () => {
	const changed = (impact: unknown, hsn = '5208') => {
		const view = render({ id: 'cat_1', rows: [row({ hsnCode: '5007' })], impact });
		view.page.form.patchValue({ hsn_code: hsn });
		view.page.submit();
		return view;
	};
	const asked = (modals: { open: ReturnType<typeof vi.fn> }) => {
		let ask: unknown;
		modals.open.mockImplementation(() => ({
			componentInstance: { start: (value: unknown) => (ask = value) },
			result: Promise.resolve(false),
		}));
		return () => ask;
	};

	it('saves without asking when nothing follows the code, or the products cannot be counted', async () => {
		const none = changed({ categoryHsn: '5007', using: 0, own: [] });
		await vi.waitFor(() =>
			expect(none.service.saveCategory).toHaveBeenCalledWith(
				'cat_1',
				expect.objectContaining({ updateProductsHsn: false }),
			),
		);
		const failed = changed('fails');
		await vi.waitFor(() => expect(failed.service.saveCategory).toHaveBeenCalled());
	});

	it('words the question for products that all follow, and names at most six that have their own code', async () => {
		const plain = render({ id: 'cat_1', rows: [row({ hsnCode: '5007' })], impact: { using: 4, own: [] } });
		const plainAsk = asked(plain.modals);
		plain.page.form.patchValue({ hsn_code: null });
		plain.page.submit();
		await vi.waitFor(() => expect(plainAsk()).toBeTruthy());
		expect(plainAsk()).toMatchObject({ body: 'category_hsn_body', params: { from: '5007', to: '—' } });

		const own = Array.from({ length: 8 }, (_, n) => ({
			id: `p${n}`,
			sku: `ST-${n}`,
			title: 'Own',
			hsnCode: '5407',
		}));
		const many = render({ id: 'cat_1', rows: [row()], impact: { using: 4, own } });
		const manyAsk = asked(many.modals);
		many.page.form.patchValue({ hsn_code: '5208' });
		many.page.submit();
		await vi.waitFor(() => expect(manyAsk()).toBeTruthy());
		expect(manyAsk()).toMatchObject({ body: 'category_hsn_body_own', params: { from: '—' }, more: 'and_n_more' });
		expect((manyAsk() as { items: string[] }).items).toHaveLength(6);
	});
});

describe('the category form: blog categories', () => {
	const typed = (page: FormCategory, slug: unknown, status: boolean) => {
		page.fields.load({ name: { en: '  Saree guides ' }, description: {} });
		page.form.patchValue({ slug, status });
	};

	it('makes the address from the English name, saves a draft, and refuses a bad address', () => {
		const { page, blogs } = render({ type: 'post' });
		typed(page, null, false);
		page.submit();
		expect(blogs.saveTerm).toHaveBeenLastCalledWith(
			'categories',
			null,
			expect.objectContaining({ slug: 'saree-guides', status: 'draft' }),
		);
		typed(page, 'Not An Address', true);
		page.submit();
		expect(blogs.saveTerm).toHaveBeenCalledTimes(1);
	});

	it('names what Go Live misses without moving language when the gap is the whole field', () => {
		const refused = new HttpErrorResponse({
			status: 400,
			error: { error: { issues: [{ code: 'go_live_blocked', path: ['slug'] }] } },
		});
		const { page, toasts } = render({ type: 'post', saveBlog: () => throwError(() => refused) });
		const moved = vi.spyOn(page, 'switchLanguage');
		typed(page, 'saree-guides', true);
		page.submit();
		expect(toasts.showError).toHaveBeenCalled();
		expect(moved).not.toHaveBeenCalled();
	});
});

describe('shipping values', () => {
	it('reads empty as inherit and anything but a non-negative number as nothing', () => {
		expect([null, undefined, ''].map(shippingValue)).toEqual([null, null, null]);
		expect(shippingValue('120')).toBe(120);
		expect(shippingValue('abc')).toBeNull();
		expect(shippingValue(-5)).toBeNull();
	});

	it('saves a category whose HSN box was cleared to nothing', () => {
		const { page, service } = render();
		page.fields.load({ name: { en: 'Sarees' }, description: {}, seo_title: {}, seo_description: {} });
		page.form.patchValue({ slug: 'sarees', hsn_code: null });
		page.submit();
		expect(service.saveCategory).toHaveBeenCalledWith(null, expect.objectContaining({ hsnCode: null }));
	});
});
