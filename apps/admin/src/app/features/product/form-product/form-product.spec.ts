import { HttpClient } from '@angular/common/http';
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbDate, NgbDateParserFormatter, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { BehaviorSubject, firstValueFrom, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AddonTemplateService } from '@data-access/services/addon-template.service';
import { AttributeService } from '@data-access/services/attribute.service';
import { NotificationService } from '@data-access/services/notification.service';
import { MenuStore } from '@core/state/menu.store';
import { ProductDraftService } from '@data-access/services/product-draft.service';
import { ProductService } from '@data-access/services/product.service';

import { FormProduct } from './form-product';

const catalog = signal<unknown>(undefined);
const categories = signal<unknown>(undefined);
const taxes = signal<unknown>(undefined);

vi.mock('@data-access/queries/product.queries', () => ({
	injectCatalogProductsQuery: (p: () => unknown) => (p(), { data: catalog }),
}));
vi.mock('@data-access/queries/category.queries', () => ({
	injectCategoriesQuery: (p: () => unknown) => (p(), { data: categories }),
}));
vi.mock('@data-access/queries/tag.queries', () => ({
	injectTagsQuery: (p: () => unknown) => (p(), { data: signal(undefined) }),
}));
vi.mock('@data-access/queries/tax.queries', () => ({
	injectTaxesQuery: (p: () => unknown) => (p(), { data: taxes }),
}));
const shippingOverview = signal<unknown>(undefined);
vi.mock('@core/shipping/shipping.gateway', () => ({
	injectShippingOverviewQuery: () => ({ data: shippingOverview }),
	injectShippingExceptionsQuery: () => ({ data: signal(undefined) }),
}));

const variant = (overrides: Record<string, unknown> = {}) => ({
	id: 'v1',
	label: 'Red',
	sku: ' V1 ',
	mrpINR: 100,
	sellingINR: 90,
	quantity: 3,
	weightGrams: 10,
	lengthCm: 1,
	widthCm: 2,
	heightCm: 3,
	barcode: ' 123 ',
	hsnCode: ' 5007 ',
	available: true,
	...overrides,
});
const content = (overrides: Record<string, unknown> = {}) => ({
	title: { en: 'Silk', bn: 'সিল্ক' },
	shortDescription: { en: 'Short' },
	description: { en: 'Long' },
	metaTitle: {},
	metaDescription: {},
	categoryIds: ['c1'],
	optionGroups: [],
	addonTemplateCode: null,
	imageMode: 'simple',
	gallery: ['m1'],
	compound: [],
	altOverrides: {},
	...overrides,
});
const detail = (overrides: Record<string, unknown> = {}) => ({
	id: 'p1',
	slug: 'silk',
	title: 'Silk',
	sku: 'S1',
	type: 'variable',
	status: 'live',
	published: false,
	shipping: { weightGrams: 500, lengthCm: 1, widthCm: 2, heightCm: 3 },
	hsnCode: '5007',
	estimatedDeliveryText: null,
	madeToOrder: false,
	lowStockThreshold: 2,
	pinnedBadges: ['new'],
	hiddenBadges: [],
	replacementPath: null,
	addonPriceINR: null,
	featured: true,
	content: content(),
	images: [{ assetId: 'm1', url: 'https://cdn.test/m1.webp' }],
	relatedProductIds: ['a', ''],
	upsellProductIds: [],
	crossSellProductIds: [],
	videos: [],
	variants: [variant()],
	...overrides,
});

const render = (
	options: {
		params?: Record<string, unknown>;
		type?: string;
		product?: unknown;
		platform?: string;
		query?: Record<string, string>;
		drafts?: Record<string, unknown>;
		modals?: unknown;
	} = {},
) => {
	const service = {
		getCatalogProduct: vi.fn(() => of(options.product ?? detail())),
		getReplacementTargets: vi.fn(() =>
			of([
				{ path: '/product/silk', label: 'Silk' },
				{ path: '/product/cotton', label: 'Cotton' },
			]),
		),
		discontinueCatalogProduct: vi.fn(() => of({})),
		saveCatalogProduct: vi.fn(() => of({})),
		createCatalogProduct: vi.fn(() => of({ id: 'p1', slug: 'silk' })),
		goLive: vi.fn(() => of({ live: true, gaps: [] })),
		getBundle: vi.fn(() => of(null)),
		saveBundle: vi.fn(() => of({})),
	};
	const toasts = { showSuccess: vi.fn(), showError: vi.fn() };
	const router = { navigateByUrl: vi.fn(), navigate: vi.fn(() => Promise.resolve(true)) };
	const drafts = {
		list: vi.fn(() => of({ items: [], mine: 0 })),
		get: vi.fn(() => of(null)),
		save: vi.fn((id: string | null, body: Record<string, unknown>) =>
			of({
				...body,
				id: id ?? 'pdr_1',
				updatedAt: '2026-11-19T09:35:00.000Z',
				createdAt: '2026-11-19T08:44:00.000Z',
			}),
		),
		discard: vi.fn(() => of(undefined)),
		...options.drafts,
	};
	const menu = { setBadge: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ProductService, useValue: service },
			{ provide: Router, useValue: router },
			{ provide: HttpClient, useValue: {} },
			{ provide: PLATFORM_ID, useValue: options.platform ?? 'browser' },
			{
				provide: ActivatedRoute,
				useValue: {
					params: new BehaviorSubject(options.params ?? {}),
					snapshot: { queryParamMap: { get: (key: string) => options.query?.[key] ?? null } },
				},
			},
			{ provide: ProductDraftService, useValue: drafts },
			{ provide: MenuStore, useValue: menu },
			...(options.modals ? [{ provide: NgbModal, useValue: options.modals }] : []),
			{ provide: AttributeService, useValue: { getDefinitions: () => of([]) } },
			{ provide: AddonTemplateService, useValue: { list: () => of([]) } },
			{ provide: NotificationService, useValue: toasts },
			{
				provide: TranslocoService,
				useValue: {
					selectTranslation: () => of({}),
					translate: (key: string, params?: { value?: unknown }) => (params ? `${key}:${params.value}` : key),
				},
			},
		],
	});
	TestBed.overrideComponent(FormProduct, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(FormProduct);
	fixture.componentRef.setInput('type', options.type ?? 'edit');
	fixture.detectChanges();
	TestBed.tick();
	return { fixture, page: fixture.componentInstance, service, router, toasts, drafts, menu };
};
const editing = (overrides: Record<string, unknown> = {}) =>
	render({ params: { id: 'p1' }, product: detail(overrides) });
const day = (value: number) => new NgbDate(2026, 11, value);

afterEach(() => {
	for (const value of [catalog, categories, taxes, shippingOverview]) value.set(undefined);
	vi.useRealTimers();
	document.body.classList.remove('loader-none');
	document.body.innerHTML = '';
});

describe('FormProduct lists', () => {
	it('starts empty', async () => {
		const { page } = render();
		expect(await firstValueFrom(page.products$)).toEqual([]);
		expect(page.taxes()).toEqual([]);
		expect(page.collectionProduct).toEqual([]);
	});

	it('maps products, leaving out the one being edited', async () => {
		const { page } = editing();
		catalog.set({
			items: [
				{ id: 'p1', title: 'Self', variantCount: 1, stock: 1 },
				{ id: 'a', title: 'A', slug: 'a', variantCount: 1, stock: 1, thumbnailUrl: 'i.png' },
				{ id: 'b', title: 'B', slug: 'b', variantCount: 3, stock: 0, thumbnailUrl: null },
				{ id: 'c', title: 'C', slug: 'c', variantCount: 1, stock: 0, thumbnailUrl: null },
			],
		});
		TestBed.tick();
		const rows = await firstValueFrom(page.products$);
		expect(rows.map((row) => 'value' in row && row.value)).toEqual(['a', 'b', 'c']);
		expect(rows[1]).toMatchObject({
			data: { type: 'classified', stock_status: 'out_of_stock', image: 'assets/images/product.png' },
		});
		expect(page.collectionProduct).toHaveLength(1);
	});

	it('maps taxes', () => {
		taxes.set({ data: [{ id: 2, name: 'GST' }] });
		expect(render().page.taxes()).toEqual([{ label: 'GST', value: 2 }]);
	});
});

describe('FormProduct reading', () => {
	it('fills from the catalog and removes the fields it does not save', () => {
		const { page } = editing();
		expect(page.id).toBe('p1');
		expect(page.form.getRawValue()).toMatchObject({ name: 'Silk', type: 'classified', weight: 500 });
		expect(page.form.get('price')).toBeNull();
		expect(page.variationControl.at(0).value).toMatchObject({ id: 'v1', availability: 'available' });
		expect(page.statusOptions.map((row) => 'value' in row && row.value)).toEqual([
			'live',
			'draft',
			'disabled',
			'discontinued',
		]);
		expect(page.statusOptions[0]).toMatchObject({ value: 'live', disabled: false });
	});

	it('reads a simple product, a published SKU and an unavailable row', () => {
		const { page } = editing({ type: 'simple', published: true, variants: [variant({ available: false })] });
		expect(page.form.getRawValue().type).toBe('simple');
		expect(page.form.get('sku')?.disabled).toBe(true);
		expect(page.variationControl.at(0).get('availability')?.value).toBe('unavailable');
		expect(page.variationControl.at(0).get('sku')?.disabled).toBe(true);
	});

	it('shows draft as a locked status', () => {
		const { page } = editing({ status: 'draft' });
		expect(page.statusOptions[0]).toMatchObject({ value: 'live', disabled: true });
		expect(page.statusOptions[1]).toMatchObject({ value: 'draft', disabled: true });
	});

	it('skips the read for a new product, and offers replacements other than itself', () => {
		const fresh = render();
		expect(fresh.service.getCatalogProduct).not.toHaveBeenCalled();
		expect(fresh.page.replacementTargets).toHaveLength(2);
		const { service, page } = editing();
		service.getReplacementTargets.mockClear();
		expect(page.replacementTargets).toEqual([{ value: '/product/cotton', label: 'Cotton · /product/cotton' }]);
	});

	it('flags a selling price above the MRP on a row', () => {
		const { page } = editing();
		const row = page.variationControl.at(0);
		row.patchValue({ price: 200 });
		expect(row.errors).toEqual({ sellingAboveMrp: true });
		row.patchValue({ mrp: '', price: 200 });
		expect(row.errors).toBeNull();
		row.patchValue({ mrp: 'x', price: null });
		expect(row.errors).toBeNull();
	});
});

describe('FormProduct money helpers', () => {
	const row = (mrp: unknown, price: unknown, discount?: unknown) =>
		new FormGroup({
			mrp: new FormControl(mrp),
			price: new FormControl(price),
			discount: new FormControl(discount),
		});

	it('previews a discount only when there is one', () => {
		const { page } = render();
		expect(page.percentPreview(row(100, 75))).toEqual({ price: 75, percent: 25 });
		expect(page.percentPreview(row(null, 75))).toBeNull();
		expect(page.percentPreview(row(100, undefined))).toBeNull();
		expect(page.percentPreview(row(0, 0))).toBeNull();
		expect(page.percentPreview(row(100, 100))).toBeNull();
	});

	it('applies a percentage', () => {
		const { page } = render();
		const group = row(200, 0, 10);
		page.applyPercent(group);
		expect(group.value.price).toBe(180);
		const noMrp = row(null, 5, 10);
		page.applyPercent(noMrp);
		expect(noMrp.value.price).toBe(5);
		const noPercent = row(200, 5, '');
		page.applyPercent(noPercent);
		expect(noPercent.value.price).toBe(5);
	});

	it('works out a sale price, refusing non-numbers', () => {
		const { page } = render();
		expect(page.saleRupee(100, 15)).toBe(85);
		expect(page.saleRupee('x', 15)).toBe(0);
		expect(page.saleRupee(100, 'x')).toBe(0);
	});

	it('describes a value inherited from the product', () => {
		const { page } = render();
		page.form.patchValue({ weight: 500 });
		expect(page.fromProduct('weight')).toBe('from_product:500');
		page.form.patchValue({ weight: '' });
		expect(page.fromProduct('weight')).toBe('');
		page.form.patchValue({ weight: null });
		expect(page.fromProduct('weight')).toBe('');
		expect(page.fromProduct('nope')).toBe('');
	});
});

describe('FormProduct status rules', () => {
	it('knows when it is discontinuing', () => {
		const { page } = editing();
		expect(page.isDiscontinuing).toBe(false);
		page.form.patchValue({ status: 'discontinued' });
		expect(page.isDiscontinuing).toBe(true);
	});

	it('allows made-to-order only on a live product that stays live', () => {
		const fresh = render();
		expect(fresh.page.madeToOrderAllowed).toBe(false);
		const { page } = editing();
		expect(page.madeToOrderAllowed).toBe(true);
		page.form.patchValue({ made_to_order: true });
		page.form.patchValue({ status: 'disabled' });
		expect(page.madeToOrderAllowed).toBe(false);
		expect(page.form.value.made_to_order).toBe(false);
		page.form.patchValue({ made_to_order: true });
		page.form.patchValue({ status: 'live' });
		expect(page.form.value.made_to_order).toBe(true);
	});

	it('swaps the simple fields with the type on a new product only', () => {
		const { page } = render({ type: 'create' });
		page.form.controls['type']?.setValue('classified');
		expect(page.form.get('price')).toBeNull();
		page.form.controls['type']?.setValue('simple');
		expect(page.form.get('price')).not.toBeNull();
		const saved = editing();
		saved.page.form.controls['type']?.setValue('simple');
		expect(saved.page.form.get('price')).toBeNull();
	});
});

describe('FormProduct search', () => {
	it('searches after a pause', async () => {
		vi.useFakeTimers();
		const { page } = render();
		page.searchProduct({ search: 'silk' } as never);
		vi.advanceTimersByTime(300);
		expect(page.filter.search).toBe('silk');
		page.productDropdown({ innerSearchText: 'x' } as never);
		vi.advanceTimersByTime(300);
		expect(page.filter.search).toBe('');
		page.filter.search = 'kept';
		page.productDropdown({ innerSearchText: '' } as never);
		vi.advanceTimersByTime(300);
		expect(page.filter.search).toBe('kept');
	});

	it('widens the page for many related products and pins them on an empty search', () => {
		const { page } = render();
		page.product = { related_products: Array.from({ length: 20 }, (_, id) => id) } as never;
		page.productFilter({ search: '' });
		expect(page.filter).toMatchObject({ paginate: 20, ids: expect.stringContaining('19') });
		expect(document.body.classList.contains('loader-none')).toBe(true);
		page.product = { related_products: [1] } as never;
		page.productFilter({ search: 'x' });
		expect(page.filter).toMatchObject({ paginate: 15, ids: '' });
	});

	it('leaves the body alone on the server', () => {
		const { page } = render({ platform: 'server' });
		page.productFilter({ search: 'x' });
		expect(document.body.classList.contains('loader-none')).toBe(false);
		expect(page.editor).toBeUndefined();
	});
});

describe('FormProduct dates', () => {
	it('builds a range and restarts on an earlier pick', () => {
		const { page } = render();
		page.fromDate = null;
		page.toDate = null;
		page.onDateSelection(day(5));
		expect(page.form.value.sale_starts_at).toBe('2026-11-5');
		page.onDateSelection(day(9));
		expect(page.form.value.sale_expired_at).toBe('2026-11-9');
		page.onDateSelection(day(7));
		expect(page.toDate).toBeNull();
		page.onDateSelection(day(2));
		expect(page.fromDate?.day).toBe(2);
		page.onDateSelection(null as never);
		expect(page.fromDate).toBeNull();
	});

	it('marks hovered, inside and range days', () => {
		const { page } = render();
		page.fromDate = day(5);
		page.toDate = null;
		page.hoveredDate = day(9);
		expect(page.isHovered(day(7))).toBe(true);
		expect(page.isRange(day(7))).toBe(true);
		page.toDate = day(9);
		expect(page.isInside(day(7))).toBe(true);
		expect(page.isRange(day(5))).toBe(true);
		expect(page.isRange(day(9))).toBe(true);
		expect(page.isRange(day(7))).toBe(true);
		expect(page.isRange(day(20))).toBeFalsy();
	});

	it('validates typed dates', () => {
		const { page } = render();
		const formatter = TestBed.inject(NgbDateParserFormatter);
		vi.spyOn(formatter, 'parse').mockReturnValueOnce({ year: 2026, month: 11, day: 5 });
		expect(page.validateInput(null, 'ok')?.day).toBe(5);
		vi.spyOn(formatter, 'parse').mockReturnValueOnce(null);
		expect(page.validateInput(day(1), 'no')?.day).toBe(1);
		vi.spyOn(formatter, 'parse').mockReturnValueOnce({ year: 2026, month: 13, day: 5 });
		expect(page.validateInput(day(1), 'bad')?.day).toBe(1);
	});
});

describe('FormProduct pickers', () => {
	const image = { id: 4 } as never;

	it('stores categories and tags, ignoring anything else', () => {
		const { page } = render();
		page.selectCategoryItem([1] as never);
		page.selectTagItem([2] as never);
		expect(page.form.value).toMatchObject({ categories: [1], tags: [2] });
		page.selectCategoryItem('x' as never);
		page.selectTagItem('x' as never);
		expect(page.form.value).toMatchObject({ categories: [1], tags: [2] });
	});

	it('stores single images, clears them, and ignores lists', () => {
		const { page } = render();
		const single = [['selectMetaImage', 'product_meta_image_id']] as const;
		for (const [method, control] of single) {
			page[method](image);
			expect(page.form.get(control)?.value).toBe(4);
			page[method]([] as never);
			expect(page.form.get(control)?.value).toBe(4);
			page[method](null as never);
			expect(page.form.get(control)?.value).toBeNull();
		}
	});

	it('stores a variation image', () => {
		const { page } = editing();
		page.selectVariationImage(image, 0);
		expect(page.variationControl.at(0).value.variation_image_id).toBe(4);
		page.selectVariationImage(null as never, 0);
		expect(page.variationControl.at(0).value.variation_image_id).toBe('');
	});

	it('keeps the Meta image as a share picture with its version, and shows its tile (owner, 17 Nov)', () => {
		const { page } = render();
		page.selectMetaImage({ id: 'ast_share', versionId: 'ver_2', original_url: 'https://cdn/share.jpg' } as never);
		expect(page.images().shareImage).toEqual({ assetId: 'ast_share', versionId: 'ver_2' });
		expect(page.pictureTile(page.images().shareImage)).toMatchObject({
			id: 'ast_share',
			original_url: 'https://cdn/share.jpg',
			versionId: 'ver_2',
		});
		page.selectMetaImage(null);
		expect(page.images().shareImage).toBeNull();
		expect(page.pictureTile(null)).toBeNull();
		expect(page.pictureTile({ assetId: 'unknown', versionId: null })).toBeNull();
	});

	it("keeps each variant's own picture with its version and sends it on save", () => {
		const { page, service } = editing();
		page.selectVariationImage({ id: 'ast_v', versionId: null, original_url: 'https://cdn/v.jpg' } as never, 0);
		expect(page.variantImages().get('v1')).toEqual({ assetId: 'ast_v', versionId: null });
		page.submit();
		const calls = vi.mocked(service.saveCatalogProduct).mock.calls as unknown as unknown[][];
		const sent = calls.at(-1)?.[1] as { variants: { id: string; image: unknown }[] };
		expect(sent.variants.find((row) => row.id === 'v1')?.image).toEqual({ assetId: 'ast_v', versionId: null });
	});
});

describe('FormProduct language to-do list', () => {
	const group = {
		attributeCode: 'color',
		label: { en: 'Colour' },
		terms: [
			{ code: 'red', label: { en: 'Red', bn: 'লাল' } },
			{ code: 'blue', label: { en: 'Blue' } },
			{ code: 'pink', label: {} },
		],
	};

	it('lists fields, option names and values for a language', () => {
		const { page } = render({ params: { id: 'p1' } });
		page.optionGroups.set([group, { attributeCode: 'size', label: {}, terms: [] }] as never);
		TestBed.tick();
		const keys = page.gaps()['bn']?.map((gap) => [gap.key, gap.name]);
		expect(keys).toContainEqual(['option:color', 'Colour']);
		expect(keys).toContainEqual(['option:size', 'size']);
		expect(keys).toContainEqual(['value:color:blue', 'Blue']);
		expect(keys).toContainEqual(['value:color:pink', 'pink']);
		expect(keys).not.toContainEqual(['value:color:red', 'Red']);
	});

	it('lists missing FAQ text for a language only while the FAQ is on', () => {
		const { page } = render({ params: { id: 'p1' } });
		const rows = [
			{ question: { en: 'Silk?', bn: 'সিল্ক?' }, answer: { en: 'Yes', bn: 'হ্যাঁ' } },
			{ question: { en: 'Fall?' }, answer: { en: 'No', bn: ' ' } },
		];
		page.faq.set({ enabled: false, rows });
		TestBed.tick();
		expect(page.gaps()['bn']?.map((gap) => gap.key)).not.toContain('faq_question:2');
		page.faq.set({ enabled: true, rows });
		TestBed.tick();
		expect(page.gaps()['bn']).toContainEqual({ key: 'faq_question:2', label: 'gap_faq_question', name: '2' });
		expect(page.gaps()['bn']).toContainEqual({ key: 'faq_answer:2', label: 'gap_faq_answer', name: '2' });
		expect(page.gaps()['bn']?.map((gap) => gap.key)).not.toContain('faq_question:1');
	});

	it('adds an image gap only a Go Live attempt can report', () => {
		const { page } = render({ params: { id: 'p1' } });
		page.goLiveGaps.set([
			{ field: 'image_alt', locale: 'bn' },
			{ field: 'image_alt', locale: 'en' },
			{ field: 'price', locale: null },
		] as never);
		TestBed.tick();
		expect(page.gaps()['bn']).toContainEqual({ key: 'image_alt', label: 'gap_image_alt' });
		expect(page.gaps()['bn']?.filter((gap) => gap.key === 'image_alt')).toHaveLength(1);
	});

	it('keeps the list current while typing', () => {
		vi.useFakeTimers();
		const { page } = render({ params: { id: 'p1' } });
		page.switchLanguage('bn');
		page.form.patchValue({ name: 'সিল্ক' });
		vi.advanceTimersByTime(300);
		expect(page.gaps()['bn']?.map((gap) => gap.key)).not.toContain('name');
		vi.useRealTimers();
	});

	it('opens the tab and the language of a line', () => {
		const { page } = render({ params: { id: 'p1' } });
		page.openLanguageGap({ key: 'estimated_delivery_text', locale: 'bn' });
		expect(page.fields.locale()).toBe('bn');
	});
});

describe('FormProduct saree lengths', () => {
	const tree = {
		data: [
			{ id: 'a', slug: 'sarees', subcategories: [{ id: 'b', slug: 'silk' }] },
			{ id: 'c', slug: 'suits' },
		],
	};

	it('shows for anything under Sarees, and sends nothing otherwise', () => {
		categories.set(tree);
		const { page } = render({ params: { id: 'p1' } });
		page.selectCategoryItem(['c'] as never);
		expect(page.showsLengths()).toBe(false);
		page.selectCategoryItem(['b'] as never);
		expect(page.showsLengths()).toBe(true);
		const lengths = page['content']({ saree_length_m: '5.5', blouse_piece_m: '' });
		expect([lengths.sareeLengthM, lengths.blousePieceM]).toEqual([5.5, null]);
		page.selectCategoryItem(['c'] as never);
		expect(page['content']({ saree_length_m: '5.5' }).sareeLengthM).toBeNull();
		categories.set(undefined);
	});

	it('is off with no catalogue yet', () => {
		categories.set(undefined);
		const { page } = render({ params: { id: 'p1' } });
		page.selectCategoryItem(['b'] as never);
		expect(page.showsLengths()).toBe(false);
	});
});

describe('FormProduct.submit', () => {
	it('saves and opens the next product from the list, or the list after the last', () => {
		const { page, service, router } = editing();
		sessionStorage.setItem('st_admin_product_queue', JSON.stringify(['p0', 'p1', 'p2']));
		expect(page.nextProductId()).toBe('p2');
		page.saveAndNext();
		expect(service.saveCatalogProduct).toHaveBeenCalledOnce();
		expect(router.navigateByUrl).toHaveBeenLastCalledWith('/product/edit/p2');
		sessionStorage.setItem('st_admin_product_queue', JSON.stringify(['p0', 'p1']));
		expect(page.nextProductId()).toBeNull();
		page.saveAndNext();
		expect(router.navigateByUrl).toHaveBeenLastCalledWith('/product');
		page.submit();
		expect(router.navigateByUrl).toHaveBeenLastCalledWith('/product');
		sessionStorage.clear();
	});

	it('saves the cleaned values', () => {
		const { page, service, router } = editing();
		page.form.patchValue({
			estimated_delivery_text: ' 3 days ',
			hsn_code: 5007,
			weight: '',
			upsell_products: null,
		});
		page.variationControl.at(0).patchValue({ availability: 'unavailable', mrp: '', price: 80.6, quantity: 2.4 });
		page.submit();
		expect(service.saveCatalogProduct).toHaveBeenCalledWith('p1', {
			sku: 'S1',
			status: 'live',
			featured: true,
			showOnShop: true,
			madeToOrder: false,
			estimatedDeliveryText: '3 days',
			lowStockThreshold: 2,
			pinnedBadges: ['new'],
			hiddenBadges: [],
			addonPriceINR: null,
			shipping: { weightGrams: null, lengthCm: 1, widthCm: 2, heightCm: 3 },
			shippingCharges: { domesticINR: null, internationalFirstINR: null, internationalFurtherINR: null },
			freeShipping: false,
			hsnCode: null,
			soldBy: 'piece',
			returnable: null,
			variants: [
				{
					id: 'v1',
					sku: 'V1',
					mrpINR: null,
					sellingINR: 81,
					quantity: 2,
					available: false,
					weightGrams: 10,
					lengthCm: 1,
					widthCm: 2,
					heightCm: 3,
					barcode: '123',
					hsnCode: '5007',
					image: null,
				},
			],
			content: {
				title: { en: 'Silk', bn: 'সিল্ক' },
				shortDescription: { en: 'Short' },
				description: { en: 'Long' },
				metaTitle: { en: '' },
				metaDescription: { en: '' },
				categoryIds: ['c1'],
				optionGroups: [],
				addonTemplateCode: null,
				estimatedDeliveryText: { en: ' 3 days ' },
				sareeLengthM: null,
				blousePieceM: null,
				imageMode: 'simple',
				gallery: ['m1'],
				compound: [],
				altOverrides: {},
				versions: {},
				shareImage: null,
				faqEnabled: false,
				faq: [],
			},
			relatedProductIds: ['a'],
			upsellProductIds: [],
			crossSellProductIds: [],
			freeWith: null,
			videos: [],
		});
		expect(page.tabError).toBeNull();
		expect(router.navigateByUrl).toHaveBeenCalledWith('/product');
	});

	it('sends disabled, and keeps a published SKU', () => {
		const { page, service } = editing({ published: true });
		page.form.patchValue({ status: 'disabled' });
		page.form.get('sku')?.setValue(null);
		page.submit();
		expect(service.saveCatalogProduct).toHaveBeenCalledWith(
			'p1',
			expect.objectContaining({ status: 'disabled', sku: 'S1' }),
		);
	});

	it('discontinues with a replacement', () => {
		const { page, service, router } = editing();
		page.form.patchValue({ status: 'discontinued', replacement_path: ' /product/cotton ' });
		page.submit();
		expect(service.discontinueCatalogProduct).toHaveBeenCalledWith('p1', '/product/cotton');
		expect(service.saveCatalogProduct).not.toHaveBeenCalled();
		expect(router.navigateByUrl).toHaveBeenCalledWith('/product');
	});

	it('needs a lead time for made-to-order, and opens its tab', () => {
		const { page, service } = editing();
		document.body.innerHTML = '<div class="tab" tab="shipping"><input id="estimated_delivery_text" /></div>';
		const select = vi.fn();
		Object.defineProperty(page, 'nav', { value: () => ({ select }) });
		page.form.patchValue({ made_to_order: true });
		page.submit();
		expect(page.form.get('estimated_delivery_text')?.errors).toEqual({ leadTimeRequired: true });
		expect(select).toHaveBeenCalledWith('shipping');
		expect(page.tabError).toBe('shipping');
		expect(service.saveCatalogProduct).not.toHaveBeenCalled();
	});

	it('accepts made-to-order with a lead time', () => {
		const { page, service } = editing();
		page.form.patchValue({ made_to_order: true, estimated_delivery_text: '3 days' });
		page.submit();
		expect(service.saveCatalogProduct).toHaveBeenCalledOnce();
	});

	it('copes with a missing tab, a missing nav and an unattributed error', () => {
		const { page } = editing();
		page.form.setErrors({ other: true });
		page.submit();
		expect(page.tabError).toBeUndefined();
		document.body.innerHTML = '<div class="tab" tab="variants"><div formarrayname="variations"></div></div>';
		page.form.setErrors({ other: true });
		page.submit();
		expect(page.tabError).toBe('variants');
	});

	it('does not look for a tab on the server', () => {
		const { page } = render({ platform: 'server', params: { id: 'p1' } });
		document.body.innerHTML = '<div class="tab" tab="variants"><div formarrayname="variations"></div></div>';
		page.form.setErrors({ other: true });
		page.submit();
		expect(page.tabError).toBeUndefined();
	});
});

describe('FormProduct inventory and HSN (F01, F02, A01)', () => {
	const tree = () => ({
		data: [
			{
				id: 'sarees',
				name: 'Sarees',
				subcategories: [
					{ id: 'banarasi', name: 'Banarasi', row: { hsnCode: '5007', returnable: true } },
					{ id: 'tant', name: 'Tant', row: { hsnCode: '5208', returnable: false } },
				],
			},
		],
	});

	it('refills the HSN from a new main category and asks before replacing a different code', async () => {
		const { page } = editing({ content: content({ categoryIds: ['banarasi'] }) });
		const modals = TestBed.inject(NgbModal);
		categories.set(tree());
		const started: unknown[] = [];
		const open = vi.spyOn(modals, 'open').mockReturnValue({
			componentInstance: { start: (change: unknown) => started.push(change) },
			result: Promise.resolve('5407'),
		} as never);
		page.selectCategoryItem(['tant', 'banarasi']);
		expect(page.form.get('hsn_code')?.value).toBe('5208');
		expect(started[0]).toMatchObject({
			category: 'Tant',
			oldCategory: 'Banarasi',
			oldHsn: '5007',
			newHsn: '5208',
			returnableBefore: true,
			returnableNow: false,
		});
		await Promise.resolve();
		await Promise.resolve();
		// Enter manually: the typed code goes into the field; "Can be returned" follows Tant now.
		expect(page.form.get('hsn_code')?.value).toBe('5407');
		expect(page.hsnChangedFrom()).toBe('5007');
		expect(page.returnableNow()).toBe(false);
		open.mockRestore();
	});

	it('fills the HSN quietly on the first category of a new product', () => {
		const { page } = render();
		categories.set(tree());
		page.selectCategoryItem(['banarasi']);
		expect(page.form.get('hsn_code')?.value).toBe('5007');
		expect(page.hsnChangedFrom()).toBeNull();
	});

	it('refuses an HSN that is not 4, 6 or 8 digits before saving', () => {
		const { page, service } = editing();
		page.form.patchValue({ hsn_code: '54' });
		page.submit();
		expect(service.saveCatalogProduct).not.toHaveBeenCalled();
		page.form.patchValue({ hsn_code: '520811' });
		page.submit();
		expect(service.saveCatalogProduct).toHaveBeenCalled();
	});

	it('keeps Sold by fixed once locked, and shows stock as on hand, held and free', () => {
		const { page } = editing({
			soldBy: 'piece',
			soldByLocked: true,
			variants: [variant({ quantity: 7, held: 1, inOrders: 0, freeToSell: 6 })],
		});
		page.setSoldBy('metre');
		expect(page.soldBy()).toBe('piece');
		expect(page.totals()).toEqual({ onHand: 7, held: 1, inOrders: 0, free: 6 });
		expect(page.stockStatus()).toBe('stock_status_in');
	});

	it('saves a metre product in tenths and refuses one without its cut and weight', () => {
		const { page, service } = editing({ soldBy: 'piece', soldByLocked: false, lowStockThreshold: null });
		page.setSoldBy('metre');
		expect(page.metreCut()).toBe('1.0');
		page.submit();
		expect(page.metreError()).toBe('metre_weight_invalid');
		expect(service.saveCatalogProduct).not.toHaveBeenCalled();
		page.metreWeight.set('85');
		page.metreWidth.set('44');
		page.addQuickLength();
		page.setQuickLength(0, 'length', '2.5');
		page.setQuickLength(0, 'label', 'suit');
		page.form.patchValue({ low_stock_threshold: '5.0' });
		page.submit();
		expect(service.saveCatalogProduct).toHaveBeenCalledWith(
			'p1',
			expect.objectContaining({
				soldBy: 'metre',
				lowStockThreshold: 50,
				metre: {
					shortestCutTenths: 10,
					quickLengths: [{ tenths: 25, label: { en: 'suit' } }],
					widthInches: 44,
					weightPerMetreGrams: 85,
				},
			}),
		);
	});

	it('sends the product’s own returnability, or null to follow the category', () => {
		const { page, service } = editing({ returnable: false });
		expect(page.returnableChoice()).toBe('no');
		page.returnableChoice.set('');
		page.submit();
		expect(service.saveCatalogProduct).toHaveBeenCalledWith('p1', expect.objectContaining({ returnable: null }));
	});

	it('the switch follows the category until flipped; flipping saves the product’s own answer (H2)', () => {
		const { page, service } = editing({ returnable: null });
		expect(page.returnableChoice()).toBe('');
		const following = page.returnableNow();
		page.setReturnable(!following);
		expect(page.returnableChoice()).toBe(following ? 'no' : 'yes');
		expect(page.returnableNow()).toBe(!following);
		page.submit();
		expect(service.saveCatalogProduct).toHaveBeenCalledWith(
			'p1',
			expect.objectContaining({ returnable: !following }),
		);
		// Flipping back to the category's answer is still the product's own choice until "Follow … again".
		page.setReturnable(following);
		expect(page.returnableChoice()).toBe(following ? 'yes' : 'no');
		expect(page.form.contains('is_return')).toBe(false);
	});
});

describe('FormProduct shipping charges (shipping brief prd01)', () => {
	it('follows the shop default when no category sets a charge, and starts an own value from it', () => {
		const { page } = editing();
		const charges = { domestic: 100, internationalFirst: 2000, internationalFurther: 900 };
		shippingOverview.set({ settings: null, defaults: { defaultCharges: charges }, ruleSets: [] });
		TestBed.tick();
		expect(page.inheritedCharge('internationalFirst')).toEqual({ amountINR: 2000, fromCategory: null });
		expect(page.rupees(2000)).toBe('₹2,000');
		page.followCategoryCharge('internationalFirst', false);
		expect(page.ownCharges().internationalFirst).toBe(2000);
		page.followCategoryCharge('internationalFirst', true);
		expect(page.ownCharges().internationalFirst).toBeNull();
	});

	it('names a rule set exception by the rule set’s name', () => {
		const { page } = editing();
		shippingOverview.set({ settings: null, defaults: {}, ruleSets: [{ id: 'rs1', name: 'Heavy parcels' }] });
		TestBed.tick();
		expect(page.exceptionLabel({ kind: 'ruleSet', ruleSetId: 'rs1' })).toBe('Heavy parcels');
		expect(page.exceptionLabel({ kind: 'cantShip' })).toBe('ship_choice_cantShip');
	});
});

describe('FormProduct Save as draft (brief § 7)', () => {
	const flush = async () => {
		for (let i = 0; i < 10; i += 1) await Promise.resolve();
	};
	const popups = (...answers: unknown[]) => ({
		open: vi.fn(() => ({
			componentInstance: { start: vi.fn(), name: { set: vi.fn() }, conflicts: { set: vi.fn() } },
			result: Promise.resolve(answers.shift()),
		})),
	});

	it('keeps a new product as a draft with its mistakes, and gives it its own address', async () => {
		const { page, drafts, router, toasts, menu } = render({ type: 'create' });
		page.form.get('name')?.setValue('Kantha');
		page.form.get('short_description')?.setValue('x'.repeat(400));
		expect(await page.saveDraft()).toBe(true);
		const [id, body] = drafts.save.mock.calls[0] as [string | null, Record<string, unknown>];
		expect(id).toBeNull();
		expect(body).toMatchObject({ kind: 'new', productId: null, title: 'Kantha', changes: [] });
		expect(body['toFix']).toBeGreaterThan(0);
		expect((body['form'] as { text: { name: { en: string } } }).text.name.en).toBe('Kantha');
		expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { draft: 'pdr_1' } }));
		expect(toasts.showSuccess).toHaveBeenCalledWith('draft_saved');
		expect(page.draft()).toMatchObject({ id: 'pdr_1', kind: 'new' });
		expect(menu.setBadge).toHaveBeenCalledWith('/product/drafts', 0);
		expect(page.isDirty()).toBe(false);
		drafts.save.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		expect(await page.saveDraft()).toBe(false);
		expect(toasts.showError).toHaveBeenCalledWith('draft_not_saved');
	});

	it('opens a new-product draft from its address, exactly as it was left', async () => {
		const saved = render({ type: 'create' });
		saved.page.form.get('name')?.setValue('Kantha');
		saved.page.form.get('sku')?.setValue('KAN-1');
		saved.page.setSoldBy('metre');
		const form = saved.page.snapshot();
		const { page } = render({
			type: 'create',
			query: { draft: 'pdr_1' },
			drafts: { get: vi.fn(() => of({ id: 'pdr_1', kind: 'new', form, updatedAt: 'u', createdAt: 'c' })) },
		});
		await flush();
		expect(page.form.get('name')?.value).toBe('Kantha');
		expect(page.form.get('sku')?.value).toBe('KAN-1');
		expect(page.soldBy()).toBe('metre');
		expect(page.draft()?.kind).toBe('new');
		const missing = render({ type: 'create', query: { draft: 'gone' } });
		await flush();
		expect(missing.toasts.showError).toHaveBeenCalledWith('draft_not_found');
	});

	it('keeps a draft of changes apart, marks the changed fields, and ends it on Update', async () => {
		const { page, drafts, service, toasts } = editing();
		await flush();
		expect(await page.saveDraft()).toBe(false);
		expect(toasts.showError).toHaveBeenCalledWith('draft_nothing_changed');
		page.form.get('weight')?.setValue(650);
		page.switchLanguage('bn');
		page.form.get('name')?.setValue('সিল্ক শাড়ি');
		expect(await page.saveDraft()).toBe(true);
		const body = drafts.save.mock.calls[0]?.[1] as { kind: string; changes: { path: string; from: unknown }[] };
		expect(body.kind).toBe('edit');
		expect(body.changes).toEqual([
			{ path: 'raw.weight', from: 500 },
			{ path: 'text.name.bn', from: 'সিল্ক' },
		]);
		expect(page.wasFor(['weight'])).toBe('draft_was:500');
		expect(page.wasFor(['name'])).toBe('draft_was:সিল্ক');
		expect(page.wasFor(['sku'])).toBeNull();
		expect(page.wasFor(['variations', '0', 'price'])).toBeNull();
		expect(page.wasFor(null)).toBeNull();
		expect([...page.changedTabs()].sort()).toEqual(['general', 'inventory']);
		page.submit();
		expect(service.saveCatalogProduct).toHaveBeenCalled();
		expect(drafts.discard).toHaveBeenCalledWith('pdr_1');
		expect(page.draft()).toBeNull();
	});

	it('lays a draft of changes over the product as it is now, and asks where both changed', async () => {
		const mine = editing();
		await flush();
		mine.page.form.get('weight')?.setValue(650);
		mine.page.form.get('low_stock_threshold')?.setValue(9);
		const form = mine.page.snapshot();
		const modals = popups({ 'raw.weight': 'theirs' });
		const { page, service } = render({
			params: { id: 'p1' },
			product: detail({ shipping: { weightGrams: 700, lengthCm: 1, widthCm: 2, heightCm: 3 } }),
			query: { draft: 'pdr_2' },
			modals,
			drafts: {
				get: vi.fn(() =>
					of({
						id: 'pdr_2',
						kind: 'edit',
						productId: 'p1',
						form,
						changes: [
							{ path: 'raw.weight', from: 500 },
							{ path: 'raw.low_stock_threshold', from: 2 },
						],
						updatedAt: 'u',
						createdAt: 'c',
					}),
				),
			},
		});
		await flush();
		expect(page.form.get('low_stock_threshold')?.value).toBe(9);
		expect(page.conflicts()).toEqual([expect.objectContaining({ path: 'raw.weight', theirs: '700', mine: '650' })]);
		page.submit();
		await flush();
		expect(modals.open).toHaveBeenCalled();
		expect(page.form.get('weight')?.value).toBe(700);
		expect(page.conflicts()).toEqual([]);
		expect(service.saveCatalogProduct).toHaveBeenCalled();
	});

	it('names a waiting draft: yours to continue or discard, a colleague’s as a note', async () => {
		const row = (mine: boolean) => ({ id: 'pdr_3', mine, updatedAt: '2026-11-18T10:00:00.000Z', changedCount: 2 });
		const theirs = render({
			params: { id: 'p1' },
			drafts: { list: vi.fn(() => of({ items: [row(false)], mine: 0 })) },
		});
		await flush();
		expect(theirs.page.waitingDraft()).toMatchObject({ mine: false });
		theirs.page.continueDraft();
		expect(theirs.router.navigate).not.toHaveBeenCalled();
		const modals = popups(true);
		const yours = render({
			params: { id: 'p1' },
			modals,
			drafts: { list: vi.fn(() => of({ items: [row(true)], mine: 1 })) },
		});
		await flush();
		expect(yours.page.waitingDraft()).toMatchObject({ id: 'pdr_3', mine: true, changed: 2 });
		await yours.page.discardDraft();
		expect(yours.drafts.discard).toHaveBeenCalledWith('pdr_3');
		expect(yours.page.waitingDraft()).toBeNull();
		yours.page.continueDraft();
		await yours.page.discardDraft();
		const broken = render({
			params: { id: 'p1' },
			drafts: { list: vi.fn(() => throwError(() => new Error('down'))) },
		});
		await flush();
		expect(broken.page.waitingDraft()).toBeNull();
	});

	it('discards an open draft of changes and shows the product as it is', async () => {
		const modals = popups(false, true);
		const { page, drafts, service } = render({ params: { id: 'p1' }, modals });
		await flush();
		page.form.get('weight')?.setValue(650);
		await page.saveDraft();
		await page.discardDraft();
		expect(drafts.discard).not.toHaveBeenCalled();
		await page.discardDraft();
		await flush();
		expect(drafts.discard).toHaveBeenCalledWith('pdr_1');
		expect(service.getCatalogProduct).toHaveBeenCalledTimes(2);
		expect(page.form.get('weight')?.value).toBe(500);
	});

	it('asks before leaving with unsaved work, and the browser asks on closing the tab', async () => {
		const modals = popups('stay', 'leave', 'draft');
		const { page, drafts } = render({ type: 'create', modals });
		await flush();
		await new Promise((resolve) => setTimeout(resolve));
		expect(await page.confirmLeave()).toBe(true);
		const quiet = { preventDefault: vi.fn() } as unknown as BeforeUnloadEvent;
		page.onBeforeUnload(quiet);
		expect(quiet.preventDefault).not.toHaveBeenCalled();
		page.form.get('name')?.setValue('Kantha');
		expect(page.isDirty()).toBe(true);
		const closing = { preventDefault: vi.fn() } as unknown as BeforeUnloadEvent;
		page.onBeforeUnload(closing);
		expect(closing.preventDefault).toHaveBeenCalled();
		expect(await page.confirmLeave()).toBe(false);
		expect(await page.confirmLeave()).toBe(true);
		expect(await page.confirmLeave()).toBe(true);
		expect(drafts.save).toHaveBeenCalledTimes(1);
	});
});
