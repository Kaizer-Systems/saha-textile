import { HttpClient } from '@angular/common/http';
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StockGateway } from '@core/purchasing/stock.gateway';
import { MenuStore } from '@core/state/menu.store';
import { AddonTemplateService } from '@data-access/services/addon-template.service';
import { AttributeService } from '@data-access/services/attribute.service';
import { NotificationService } from '@data-access/services/notification.service';
import { ProductDraftService } from '@data-access/services/product-draft.service';
import { ProductService } from '@data-access/services/product.service';

import { DraftMarkDirective } from './draft-mark';
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
const shippingExceptions = signal<unknown>(undefined);
const confirmed = vi.hoisted(() => ({ yes: true }));
vi.mock('@features/purchasing/shared/popups', () => ({ askConfirm: async () => confirmed.yes }));
vi.mock('@core/shipping/shipping.gateway', () => ({
	injectShippingOverviewQuery: () => ({ data: shippingOverview }),
	injectShippingExceptionsQuery: () => ({ data: shippingExceptions }),
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
		stock?: unknown;
		template?: string;
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
			{
				provide: StockGateway,
				useValue: options.stock ?? { detail: vi.fn(() => throwError(() => new Error('none'))) },
			},
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
	TestBed.overrideComponent(FormProduct, {
		set: options.template
			? { imports: [DraftMarkDirective], template: options.template }
			: { imports: [], template: '' },
	});
	const fixture = TestBed.createComponent(FormProduct);
	fixture.componentRef.setInput('type', options.type ?? 'edit');
	fixture.detectChanges();
	TestBed.tick();
	return { fixture, page: fixture.componentInstance, service, router, toasts, drafts, menu };
};
const editing = (overrides: Record<string, unknown> = {}) =>
	render({ params: { id: 'p1' }, product: detail(overrides) });

afterEach(() => {
	for (const value of [catalog, categories, taxes, shippingOverview, shippingExceptions]) value.set(undefined);
	confirmed.yes = true;
	sessionStorage.clear();
	vi.useRealTimers();
	document.body.classList.remove('loader-none');
	document.body.innerHTML = '';
});

/** A popup service whose popups answer in turn; an Error closes one without an answer. */
const popups = (...answers: unknown[]) => {
	const instance = { start: vi.fn(async () => undefined), name: signal(''), conflicts: signal<unknown[]>([]) };
	const open = vi.fn(() => {
		const answer = answers.length > 1 ? answers.shift() : answers[0];
		const result = answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
		result.catch(() => undefined);
		return { componentInstance: instance, result };
	});
	return { open, instance };
};
const settle = async () => {
	for (let i = 0; i < 12; i++) await Promise.resolve();
};
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
const metre = {
	soldBy: 'metre',
	lowStockThreshold: 15,
	metre: {
		shortestCutTenths: 5,
		widthInches: 44,
		weightPerMetreGrams: 120,
		quickLengths: [{ tenths: 25, label: { en: '2.5 m' } }],
	},
};
interface Private {
	restore(snapshot: unknown, only?: ReadonlySet<string>): void;
	fieldLabel(path: string): string;
	refreshMissing(): void;
}

describe('FormProduct: drawn fields and shipping', () => {
	it('a field drawn on the form reads its draft marks from the form itself', () => {
		const { fixture, page } = render({ template: '<input formControlName="sku" />' });
		expect(fixture.nativeElement.querySelector('input')).toBeTruthy();
		expect(page.wasFor(['sku'])).toBeNull();
	});

	it('a new draft marks no tab as changed', () => {
		const { page } = render({ type: 'create' });
		page.draft.set({ id: 'pdr_1', kind: 'new', savedAt: 'x', createdAt: 'y' });
		expect(page.changedTabs().size).toBe(0);
	});

	it('follows the product’s own main category, or none, and the shop default only once known', () => {
		const own = editing({ content: content({ categoryIds: [] }), mainCategory: { id: 'banarasi' } });
		categories.set(tree());
		expect(own.page.inheritedCharge('domestic')).toEqual({ amountINR: null, fromCategory: null });
		const none = editing({ content: content({ categoryIds: [] }) });
		expect(none.page.inheritedCharge('domestic')).toEqual({ amountINR: null, fromCategory: null });
		none.page.followCategoryCharge('domestic', false);
		expect(none.page.ownCharges().domestic).toBe(0);
		shippingOverview.set({
			settings: null,
			defaults: { defaultCharges: { domestic: 80, internationalFirst: 1500, internationalFurther: 700 } },
			ruleSets: [{ id: 'rs_1', name: 'Domestic' }],
		});
		expect(none.page.inheritedCharge('domestic')).toEqual({ amountINR: 80, fromCategory: null });
	});

	it('lists the exceptions for this product, a new one, and names a rule set it no longer has', () => {
		const created = render({ type: 'create' });
		expect(created.page.zoneExceptions()).toEqual([]);
		const { page } = editing();
		shippingOverview.set({
			settings: {
				domestic: { kind: 'ruleSet', ruleSetId: 'rs_1' },
				international: { kind: 'ruleSet', ruleSetId: 'rs_2' },
				abroadPolicy: 'exportOffIndianInvoice',
				defaultCharges: { domestic: 80, internationalFirst: 1500, internationalFurther: 700 },
			},
			defaults: null,
			ruleSets: [{ id: 'rs_1', name: 'Domestic' }],
		});
		shippingExceptions.set([
			{
				id: 'ex_p1',
				target: { kind: 'product', productId: 'p1' },
				domestic: { kind: 'free' },
				international: { kind: 'siteWide' },
				note: '',
				updatedBy: null,
			},
		]);
		expect(page.zoneExceptions()).toEqual([{ zone: 'domestic', choice: { kind: 'free' } }]);
		shippingOverview.set({
			settings: null,
			defaults: {
				domestic: { kind: 'ruleSet', ruleSetId: null },
				international: { kind: 'ruleSet', ruleSetId: null },
				abroadPolicy: 'indiaOnly',
				defaultCharges: { domestic: 0, internationalFirst: 0, internationalFurther: 0 },
			},
			ruleSets: [],
		});
		expect(Array.isArray(page.zoneExceptions())).toBe(true);
		expect(page.exceptionLabel({ kind: 'ruleSet', ruleSetId: 'rs_gone' } as never)).toBe('rs_gone');
	});

	it('takes a typed charge as a number, and anything else as ₹0', () => {
		const { page } = editing();
		for (const typed of ['', null, 'abc', -5]) {
			page.setOwnCharge('domestic', typed);
			expect(page.ownCharges().domestic).toBe(0);
		}
		page.setOwnCharge('domestic', '120');
		expect(page.ownCharges().domestic).toBe(120);
		expect(page.form.dirty).toBe(true);
	});

	it('works out the box’s volumetric and chargeable weight', () => {
		const { page } = editing();
		page.form.patchValue({ weight: 500, length_cm: 30, width_cm: 20, height_cm: 10 });
		const { volumetric, chargeable } = page.shippingWeights();
		expect(volumetric).toBeGreaterThan(0);
		expect(chargeable).toBe(Math.max(500, volumetric as number));
		page.form.patchValue({ weight: '', length_cm: '' });
		expect(page.shippingWeights()).toEqual({ volumetric: null, chargeable: null });
	});

	it('offers free items from the product list but never this product or a set, with the chosen ones first', () => {
		const { page } = editing();
		catalog.set({
			items: [
				{ id: 'p1', title: 'Self', type: 'simple' },
				{ id: 'b1', title: 'Set', type: 'bundle' },
				{ id: 'f2', title: 'Pin', type: 'simple' },
			],
		});
		page.freeItemInfo.set(new Map([['f9', { title: 'Old pin', sku: 'P9', variants: [] }]]));
		expect(page.freeWithData()).toEqual([
			{ label: 'Old pin', value: 'f9' },
			{ label: 'Pin', value: 'f2' },
		]);
	});

	it('offers the compound galleries’ photos once each as swatch pictures', () => {
		const { page } = editing();
		page.images.update((images) => ({
			...images,
			imageMode: 'compound',
			compound: [
				{ selectionHash: 'a', gallery: ['m1', 'm2'] },
				{ selectionHash: 'b', gallery: ['m2', 'm3'] },
			],
		}));
		expect(page.swatchPhotos()).toEqual(['m1', 'm2', 'm3']);
	});
});

describe('FormProduct: bundles, loading and the address', () => {
	it('opens the builder for a saved bundle, and makes a new one from its name first', async () => {
		const saved = editing();
		saved.page.openBuilder();
		expect(saved.router.navigate).toHaveBeenCalledWith(['/product/bundle', 'p1']);
		const { page, service, router } = render({ type: 'create' });
		page.openBuilder();
		expect(service.createCatalogProduct).not.toHaveBeenCalled();
		page.fields.load({ name: { en: ' Wedding set ' } });
		page.openBuilder();
		expect(service.createCatalogProduct).toHaveBeenCalledWith({
			type: 'bundle',
			sku: 'BND',
			title: { en: 'Wedding set' },
			basePriceINR: 0,
		});
		expect(router.navigate).toHaveBeenCalledWith(['/product/bundle', 'p1']);
		service.createCatalogProduct.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		page.openBuilder();
		expect(page.openingBuilder()).toBe(false);
	});

	it('loads a returnable metre product with its width, weight, quick lengths and low-stock level in metres', () => {
		const { page } = editing({ ...metre, returnable: true });
		expect(page.returnableChoice()).toBe('yes');
		expect(page.metreWidth()).toBe('44');
		expect(page.metreWeight()).toBe('120');
		expect(page.quickLengths()).toEqual([{ length: '2.5', label: { en: '2.5 m' } }]);
		expect(page.form.get('low_stock_threshold')?.value).toBe('1.5');
		expect(page.lowLevelUnits()).toBe(15);
		expect(page.qty(25)).not.toBe('25');
	});

	it('opens the tab the address names, and a new bundle from Products › Bundles', () => {
		const tab = render({ query: { tab: 'inventory' } });
		expect(tab.page.active).toBe('inventory');
		const bogus = render({ query: { tab: 'nowhere' } });
		expect(bogus.page.active).toBe('general');
		const bundle = render({ type: 'create', query: { type: 'bundle' } });
		expect(bundle.page.form.controls['type'].value).toBe('bundle');
	});

	it('reads the free items as they are picked, a cleared pick as none, and skips one it cannot read', async () => {
		const { page, service } = editing();
		service.getCatalogProduct.mockReturnValueOnce(throwError(() => new Error('gone')) as never);
		page.form.controls['free_with_products'].setValue(['f_gone']);
		await settle();
		expect(page.freeItemInfo().has('f_gone')).toBe(false);
		page.form.controls['free_with_products'].setValue(null);
		await settle();
		expect(page.freeItemInfo().size).toBe(0);
	});

	it('takes a whole number for a free item’s quantity, and starts its settings when there are none', () => {
		const { page } = editing();
		page.form.controls['free_with_items'].setValue(null);
		page.setFreeQuantity('f1', 'abc');
		expect(page.freeSetting('f1')).toEqual({ quantity: 1, variantId: null });
	});

	it('a cleared category list has no main category', () => {
		const { page } = editing();
		categories.set(tree());
		page.selectCategoryItem([]);
		expect(page.form.controls['categories'].value).toEqual([]);
	});

	it('the HSN popup: closed, a code that is not one, and the old code chosen again', async () => {
		const modals = popups(new Error('closed'), '12', '5208');
		const { page } = render({
			params: { id: 'p1' },
			product: detail({ hsnCode: '5208', content: content({ categoryIds: ['tant'] }) }),
			modals,
		});
		categories.set(tree());
		page.form.get('hsn_code')?.setValue('5208');
		page.selectCategoryItem(['banarasi']);
		await settle();
		expect(page.form.get('hsn_code')?.value).toBe('5007');
		page.form.get('hsn_code')?.setValue('5208');
		page.selectCategoryItem(['tant']);
		page.selectCategoryItem(['banarasi']);
		await settle();
		expect(page.form.get('hsn_code')?.value).toBe('5007');
		page.form.get('hsn_code')?.setValue('5208');
		page.selectCategoryItem(['tant']);
		page.selectCategoryItem(['banarasi']);
		await settle();
		expect(page.form.get('hsn_code')?.value).toBe('5208');
		expect(page.hsnChangedFrom()).toBeNull();
	});
});

describe('FormProduct: sold by the metre and stock', () => {
	it('a new metre product starts at 1.0 m, keeps four quick lengths at most, and edits one of several', () => {
		const { page } = render({ type: 'create' });
		page.metreCut.set('');
		page.setSoldBy('metre');
		expect(page.metreCut()).toBe('1.0');
		for (let i = 0; i < 5; i++) page.addQuickLength();
		expect(page.quickLengths()).toHaveLength(4);
		page.setQuickLength(1, 'length', '3');
		expect(page.quickLengths()[0]?.length).toBe('');
		expect(page.quickLengths()[1]?.length).toBe('3');
		page.removeQuickLength(0);
		expect(page.quickLengths()).toHaveLength(3);
	});

	it('shows stock in pieces or metres, per variant, and the low-stock level as typed', () => {
		const { page } = editing({ variants: [variant({ held: 1, inOrders: 0, freeToSell: 2 })] });
		expect(page.qty(3)).toBe('3');
		expect(page.variantFigures('v1')).toMatchObject({ onHand: 3, free: 2 });
		expect(page.variantFigures('gone')).toBeNull();
		page.form.get('low_stock_threshold')?.setValue('');
		expect(page.lowLevelUnits()).toBeNull();
		page.form.get('low_stock_threshold')?.setValue('4');
		expect(page.lowLevelUnits()).toBe(4);
	});

	it('Adjust: nothing when the variant cannot be read or the popup closes; fresh figures after an adjustment', async () => {
		const stock = { detail: vi.fn(() => throwError(() => new Error('none'))) };
		const modals = popups(new Error('closed'), { done: true }, { done: true });
		const { page, service } = render({ params: { id: 'p1' }, product: detail(), modals, stock });
		await page.adjustStock('v1');
		expect(modals.open).not.toHaveBeenCalled();
		stock.detail.mockReturnValue(of({ row: { id: 'v1' } }) as never);
		await page.adjustStock('v1');
		expect(modals.instance.start).toHaveBeenCalledWith({ id: 'v1' });
		service.getCatalogProduct.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		await page.adjustStock('v1');
		expect(page.variantStock().get('v1')?.quantity).toBe(3);
		service.getCatalogProduct.mockReturnValueOnce(
			of(detail({ soldByLocked: true, variants: [variant({ quantity: 9 })] })) as never,
		);
		await page.adjustStock('v1');
		expect(page.variantStock().get('v1')?.quantity).toBe(9);
		expect(page.soldByLocked()).toBe(true);
		const fresh = render({ type: 'create', modals: popups({ done: true }), stock });
		await fresh.page.adjustStock('v1');
		expect(fresh.service.getCatalogProduct).not.toHaveBeenCalled();
	});

	it('a variation picture for a row with no id yet is not remembered', () => {
		const { page } = editing();
		const before = new Map(page.variantImages());
		page.variationControl.push(new FormGroup({}));
		page.selectVariationImage({ id: 'm9', original_url: 'u' } as never, page.variationControl.length - 1);
		expect(page.variantImages()).toEqual(before);
	});

	it('asks for each quick length’s label in every language', () => {
		const { page } = editing(metre);
		(page as unknown as Private).refreshMissing();
		expect(page.gaps()['bn']?.some((gap) => gap.key === 'quick_length_0')).toBe(true);
	});
});

describe('FormProduct: saving', () => {
	it('on the server there is no next product', () => {
		const { page } = render({ platform: 'server', params: { id: 'p1' } });
		expect(page.nextProductId()).toBeNull();
	});

	it('a save ends the open draft, and stays when the move away is refused', async () => {
		const { page, drafts, router } = editing();
		router.navigateByUrl.mockReturnValue(Promise.resolve(false) as never);
		page.draft.set({ id: 'pdr_9', kind: 'edit', savedAt: 'x', createdAt: 'y' });
		page.submit();
		await settle();
		expect(drafts.discard).toHaveBeenCalledWith('pdr_9');
		expect(page.draft()).toBeNull();
		expect((page as unknown as { leaving: boolean }).leaving).toBe(false);
	});

	it('a save still leaves when its draft cannot be thrown away', async () => {
		const { page, drafts, router } = render({
			params: { id: 'p1' },
			drafts: { discard: vi.fn(() => throwError(() => new Error('down'))) },
		});
		page.draft.set({ id: 'pdr_9', kind: 'edit', savedAt: 'x', createdAt: 'y' });
		page.submit();
		await settle();
		expect(drafts.discard).toHaveBeenCalledWith('pdr_9');
		expect(router.navigateByUrl).toHaveBeenCalledWith('/product');
	});

	it('saves a metre product with no low-stock level or width, keeps a fixed unit, and sends no videos as none', () => {
		const { page, service } = editing({ ...metre, soldByLocked: true, lowStockThreshold: null });
		page.form.patchValue({ low_stock_threshold: null });
		page.metreWidth.set('');
		page.form.get('videos')?.setValue(null);
		page.submit();
		const body = (service.saveCatalogProduct.mock.calls.at(-1) as unknown[])[1] as Record<string, unknown>;
		expect(body['lowStockThreshold']).toBeNull();
		expect(body).not.toHaveProperty('soldBy');
		expect((body['metre'] as Record<string, unknown>)['widthInches']).toBeNull();
		expect(body['videos']).toEqual([]);
	});

	it('words the free items: none picked, several with no rule, a range, and a list with no settings', () => {
		const { page, service } = editing();
		const sent = () =>
			((service.saveCatalogProduct.mock.calls.at(-1) as unknown[])[1] as Record<string, unknown>)['freeWith'];
		page.form.controls['free_with_products'].setValue(null);
		page.submit();
		expect(sent()).toBeNull();
		page.form.patchValue({ free_with_products: ['f1', 'f2'], free_take: null, free_with_items: null });
		page.submit();
		expect(sent()).toMatchObject({
			take: 'all',
			count: null,
			from: null,
			items: [
				{ productId: 'f1', variantId: null, quantity: 1 },
				{ productId: 'f2', variantId: null, quantity: 1 },
			],
		});
		page.form.patchValue({ free_take: 'between', free_count: 'abc', free_from: 'abc' });
		page.submit();
		expect(sent()).toMatchObject({ take: 'between', count: 1, from: 0 });
	});
});

describe('FormProduct: drafts', () => {
	it('puts back a draft with parts missing, rows it does not have, and lists that are not lists', () => {
		const { page } = editing({ variants: [variant()] });
		const restore = (page as unknown as Private).restore.bind(page);
		restore({ v: 1 });
		restore({
			v: 1,
			raw: {
				variations: [{ id: 'v1', price: 70 }, { price: 1 }, { id: 'gone', price: 2 }],
				categories: 'c1',
				tags: 'x',
			},
			text: { name: null },
			state: { variantImages: null },
		});
		expect(page.variationControl.at(0).value.price).toBe(70);
		expect(page.selectedTags).toEqual([]);
		restore(
			{
				v: 1,
				raw: { variations: [{ id: 'v1', price: 60, sku: 'X' }], tags: [1] },
				state: { tiles: { m1: 'u' }, imageSizes: { m1: [750, 1000] } },
			},
			new Set(['raw.variations.v1.sku', 'raw.tags']),
		);
		expect(page.variationControl.at(0).value.price).toBe(70);
		expect(page.variationControl.at(0).value.sku).toBe('X');
		expect(page.selectedTags).toEqual([1]);
	});

	it('counts what stops Save for a draft: no English name, and a metre problem', async () => {
		const { page, drafts } = render({ type: 'create' });
		page.setSoldBy('metre');
		page.metreWeight.set('');
		page.fields.switchTo('bn');
		page.fields.load({ name: { bn: 'কাঁথা' } });
		await page.saveDraft(false);
		const body = drafts.save.mock.calls.at(-1)?.[1] as Record<string, unknown>;
		expect(body['title']).toBe('');
		expect(body['toFix']).toBeGreaterThanOrEqual(2);
	});

	it('words a changed field for the conflict question, and marks no field in a row it cannot find', () => {
		const { page } = editing({ variants: [variant()] });
		const label = (page as unknown as Private).fieldLabel.bind(page);
		expect(label('text.name.bn')).toContain('বাংলা');
		expect(label('raw.variations.v1.price')).toContain('price');
		expect(label('raw.variations.gone.price').startsWith('gone · ')).toBe(true);
		expect(label('raw.sku').startsWith('sku · ')).toBe(true);
		expect(label('state.soldBy')).not.toContain('·');
		page.draft.set({ id: 'pdr_1', kind: 'edit', savedAt: 'x', createdAt: 'y' });
		expect(page.wasFor(['variations', '9', 'price'])).toBeNull();
	});

	it('says a draft is gone when it cannot be read, new or of changes', async () => {
		const failing = { get: vi.fn(() => throwError(() => new Error('down'))) };
		const created = render({ type: 'create', query: { draft: 'pdr_1' }, drafts: failing });
		await settle();
		expect(created.toasts.showError).toHaveBeenCalledWith('draft_not_found');
		const edited = render({ params: { id: 'p1' }, query: { draft: 'pdr_2' }, drafts: failing });
		await settle();
		expect(edited.toasts.showError).toHaveBeenCalledWith('draft_not_found');
	});

	it('continues only your own waiting draft', async () => {
		const { page, router, drafts } = editing();
		page.waitingDraft.set({ id: 'pdr_x', mine: false, updatedAt: 'x', changed: 1 });
		page.continueDraft();
		expect(router.navigate).not.toHaveBeenCalled();
		page.waitingDraft.set({ id: 'pdr_x', mine: true, updatedAt: 'x', changed: 1 });
		page.continueDraft();
		expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { draft: 'pdr_x' } }));
		await settle();
		expect(drafts.get).toHaveBeenCalledWith('pdr_x');
	});

	it('discarding: says when it fails, leaves a new draft for the list, and keeps the form when the product cannot be read again', async () => {
		const failing = render({
			type: 'create',
			drafts: { discard: vi.fn(() => throwError(() => new Error('down'))) },
		});
		failing.page.draft.set({ id: 'pdr_1', kind: 'new', savedAt: 'x', createdAt: 'y' });
		await failing.page.discardDraft();
		expect(failing.toasts.showError).toHaveBeenCalledWith('draft_not_saved');
		const fresh = render({ type: 'create' });
		fresh.page.draft.set({ id: 'pdr_1', kind: 'new', savedAt: 'x', createdAt: 'y' });
		await fresh.page.discardDraft();
		expect(fresh.router.navigateByUrl).toHaveBeenCalledWith('/product/drafts', { onSameUrlNavigation: 'reload' });
		const saved = editing();
		saved.page.draft.set({ id: 'pdr_2', kind: 'edit', savedAt: 'x', createdAt: 'y' });
		saved.service.getCatalogProduct.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		saved.drafts.list.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		await saved.page.discardDraft();
		expect(saved.router.navigateByUrl).toHaveBeenCalledWith('/product/edit/p1', { onSameUrlNavigation: 'reload' });
		expect(saved.page.catalogProduct?.id).toBe('p1');
	});

	it('the conflict question: closed asks nothing more, and keeping mine saves without putting anything back', async () => {
		const modals = popups(new Error('closed'), { 'raw.sku': 'mine' });
		const { page, service } = render({ params: { id: 'p1' }, product: detail(), modals });
		page.conflicts.set([{ path: 'raw.sku', label: 'sku', theirs: 'A', mine: 'B' }]);
		page.submit();
		await settle();
		expect(service.saveCatalogProduct).not.toHaveBeenCalled();
		page.submit();
		await settle();
		expect(page.conflicts()).toEqual([]);
		expect(service.saveCatalogProduct).toHaveBeenCalledOnce();
	});

	it('leaving with unsaved work and no English name: the popup closed means stay', async () => {
		const modals = popups(new Error('closed'));
		const { page } = render({ type: 'create', modals });
		// The new form is marked clean once it has drawn.
		await new Promise((resolve) => setTimeout(resolve));
		expect(page.isDirty()).toBe(false);
		// Only a Bengali name, typed while Bengali shows: there is no English one yet.
		page.fields.switchTo('bn');
		page.fields.load({ name: { bn: 'কাঁথা' } });
		expect(await page.confirmLeave()).toBe(false);
		expect(modals.instance.name()).toBe('');
	});
});
