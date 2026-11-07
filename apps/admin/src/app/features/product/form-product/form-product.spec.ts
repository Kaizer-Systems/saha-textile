import { HttpClient } from '@angular/common/http';
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbDate, NgbDateParserFormatter } from '@ng-bootstrap/ng-bootstrap';
import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AddonTemplateService } from '@data-access/services/addon-template.service';
import { AttributeService } from '@data-access/services/attribute.service';
import { NotificationService } from '@data-access/services/notification.service';
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
	title: { en: 'Silk', fr: 'Soie' },
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
	variants: [variant()],
	...overrides,
});

const render = (
	options: { params?: Record<string, unknown>; type?: string; product?: unknown; platform?: string } = {},
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
	const router = { navigateByUrl: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ProductService, useValue: service },
			{ provide: Router, useValue: router },
			{ provide: HttpClient, useValue: {} },
			{ provide: PLATFORM_ID, useValue: options.platform ?? 'browser' },
			{ provide: ActivatedRoute, useValue: { params: new BehaviorSubject(options.params ?? {}) } },
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
	return { fixture, page: fixture.componentInstance, service, router, toasts };
};
const editing = (overrides: Record<string, unknown> = {}) =>
	render({ params: { id: 'p1' }, product: detail(overrides) });
const day = (value: number) => new NgbDate(2026, 11, value);

afterEach(() => {
	for (const value of [catalog, categories, taxes]) value.set(undefined);
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
		const single = [
			['selectMetaImage', 'product_meta_image_id'],
		] as const;
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
});

describe('FormProduct language to-do list', () => {
	const group = {
		attributeCode: 'color',
		label: { en: 'Colour' },
		terms: [
			{ code: 'red', label: { en: 'Red', fr: 'Rouge' } },
			{ code: 'blue', label: { en: 'Blue' } },
			{ code: 'pink', label: {} },
		],
	};

	it('lists fields, option names and values for a language', () => {
		const { page } = render({ params: { id: 'p1' } });
		page.optionGroups.set([group, { attributeCode: 'size', label: {}, terms: [] }] as never);
		TestBed.tick();
		const keys = page.gaps()['fr']?.map((gap) => [gap.key, gap.name]);
		expect(keys).toContainEqual(['option:color', 'Colour']);
		expect(keys).toContainEqual(['option:size', 'size']);
		expect(keys).toContainEqual(['value:color:blue', 'Blue']);
		expect(keys).toContainEqual(['value:color:pink', 'pink']);
		expect(keys).not.toContainEqual(['value:color:red', 'Red']);
	});

	it('adds an image gap only a Go Live attempt can report', () => {
		const { page } = render({ params: { id: 'p1' } });
		page.goLiveGaps.set([
			{ field: 'image_alt', locale: 'fr' },
			{ field: 'image_alt', locale: 'en' },
			{ field: 'price', locale: null },
		] as never);
		TestBed.tick();
		expect(page.gaps()['fr']).toContainEqual({ key: 'image_alt', label: 'gap_image_alt' });
		expect(page.gaps()['fr']?.filter((gap) => gap.key === 'image_alt')).toHaveLength(1);
	});

	it('keeps the list current while typing', () => {
		vi.useFakeTimers();
		const { page } = render({ params: { id: 'p1' } });
		page.switchLanguage('fr');
		page.form.patchValue({ name: 'Soie' });
		vi.advanceTimersByTime(300);
		expect(page.gaps()['fr']?.map((gap) => gap.key)).not.toContain('name');
		vi.useRealTimers();
	});

	it('opens the tab and the language of a line', () => {
		const { page } = render({ params: { id: 'p1' } });
		page.openLanguageGap({ key: 'estimated_delivery_text', locale: 'fr' });
		expect(page.fields.locale()).toBe('fr');
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
			madeToOrder: false,
			estimatedDeliveryText: '3 days',
			lowStockThreshold: 2,
			pinnedBadges: ['new'],
			hiddenBadges: [],
			addonPriceINR: null,
			shipping: { weightGrams: null, lengthCm: 1, widthCm: 2, heightCm: 3 },
			hsnCode: null,
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
				},
			],
			content: {
				title: { en: 'Silk', fr: 'Soie' },
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
			},
			relatedProductIds: ['a'],
			upsellProductIds: [],
			crossSellProductIds: [],
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
