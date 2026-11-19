import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID, signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { BehaviorSubject, firstValueFrom, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { goLiveLabels, goLiveToast } from '@core/catalog/go-live-report';
import { LocalizedFields } from '@core/i18n/localized-fields';
import { MediaGateway } from '@core/media/media.gateway';
import { AddonTemplateService } from '@data-access/services/addon-template.service';
import { AttributeService } from '@data-access/services/attribute.service';
import { BlogService } from '@data-access/services/blog.service';
import { CategoryService } from '@data-access/services/category.service';
import { NotificationService } from '@data-access/services/notification.service';
import { ProductDraftService } from '@data-access/services/product-draft.service';
import { ProductService } from '@data-access/services/product.service';
import { LanguageSwitch } from '@shared/ui/language-switch/language-switch';

import { Attribute } from './attribute/attribute';
import { FormAttribute } from './attribute/form-attribute/form-attribute';
import { FormCategory } from './category/form-category/form-category';
import { TreeNode } from './category/tree/tree-node/tree-node';
import { FormProduct } from './product/form-product/form-product';
import { OptionGroups } from './product/form-product/option-groups/option-groups';
import { ProductBundleForm } from './product/form-product/product-bundle/product-bundle';
import { ProductImages } from './product/form-product/product-images/product-images';
import { variantCombinations } from './product/form-product/variant-combinations';
import { Product } from './product/product';

const empty = signal<unknown>(undefined);
const refetch = vi.fn();
vi.mock('@data-access/queries/product.queries', () => ({
	injectCatalogProductsQuery: (p: () => unknown) => (p(), { data: empty, refetch }),
}));
vi.mock('@data-access/queries/category.queries', () => ({
	injectCategoriesQuery: (p: () => unknown) => (p(), { data: empty }),
}));
vi.mock('@data-access/queries/tag.queries', () => ({
	injectTagsQuery: (p: () => unknown) => (p(), { data: empty }),
}));
vi.mock('@data-access/queries/tax.queries', () => ({
	injectTaxesQuery: (p: () => unknown) => (p(), { data: empty }),
}));
vi.mock('@data-access/queries/attribute.queries', () => ({
	injectAttributesQuery: (p: () => unknown) => (p(), { data: empty, refetch }),
}));
vi.mock('@core/shipping/shipping.gateway', async () => {
	const { of } = await import('rxjs');
	const { Injectable } = await import('@angular/core');
	@Injectable({ providedIn: 'root' })
	class ShippingGateway {
		categoryUsage = () => of({ products: 214, ownCharges: 5 });
		exceptions = () =>
			of([
				{
					id: 'ex-1',
					target: { kind: 'category', categoryId: 'cat_1', includeSubcategories: true },
					domestic: { kind: 'siteWide' },
					international: { kind: 'cantShip' },
					note: '',
				},
			]);
		overview = () => of({ ruleSets: [] });
	}
	return {
		ShippingGateway,
		injectShippingOverviewQuery: () => ({ data: empty }),
		injectShippingExceptionsQuery: () => ({ data: empty }),
	};
});

const translate = { translate: (key: string) => key, selectTranslation: () => of({}) };
const both = { en: 'Red', bn: 'লাল' };

const mount = <T>(type: Type<T>, providers: unknown[], inputs: Record<string, unknown> = {}) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: providers as never[] });
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(type);
	for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
	fixture.detectChanges();
	TestBed.tick();
	return fixture.componentInstance;
};

afterEach(() => refetch.mockClear());

describe('LocalizedFields', () => {
	const build = () => {
		const form = new FormGroup({ name: new FormControl(''), other: new FormControl<unknown>('') });
		return { form, fields: new LocalizedFields(form, ['name', 'other']) };
	};

	it('swaps the controls with the language and keeps what was typed', () => {
		const { form, fields } = build();
		form.patchValue({ name: 'Silk' });
		fields.switchTo('bn');
		expect(form.value.name).toBe('');
		expect(fields.source('name')).toBe('Silk');
		form.patchValue({ name: 'সিল্ক' });
		fields.switchTo('en');
		expect(form.value.name).toBe('Silk');
		expect(fields.source('name')).toBe('');
		expect(fields.text('name')).toEqual({ en: 'Silk', bn: 'সিল্ক' });
	});

	it('loads every language, treats non-text as empty, and counts what is missing', () => {
		const { form, fields } = build();
		fields.load({ name: { en: 'Silk' } });
		expect(form.value).toMatchObject({ name: 'Silk', other: '' });
		form.patchValue({ other: 5 });
		expect(fields.gaps('en').length).toBe(1);
		expect(fields.gaps('bn').length).toBe(2);
		fields.switchTo('bn');
		expect(fields.source('unknown')).toBe('');
	});
});

describe('LocalizedFields with an optional field', () => {
	it('asks for other languages only once English is written', () => {
		const form = new FormGroup({ note: new FormControl('') });
		const fields = new LocalizedFields(form, ['note'], ['note']);
		expect(fields.gaps('bn').length).toBe(0);
		form.patchValue({ note: 'Soon' });
		expect(fields.gaps('en').length).toBe(0);
		expect(fields.gaps('bn').length).toBe(1);
	});
});

describe('LanguageSwitch', () => {
	it('names each language in its own script, from the browser’s language data', () => {
		const page = mount(LanguageSwitch, [], { locales: ['en'], active: 'en' });
		expect(['en', 'bn', 'hi', 'xx'].map((code) => page.name(code))).toEqual(['English', 'বাংলা', 'हिन्दी', 'xx']);
	});
});

describe('Go Live report', () => {
	const key = (text: string) => text;
	const toasts = () => ({ showSuccess: vi.fn(), showError: vi.fn() });

	it('names each gap with its language', () => {
		expect(
			goLiveLabels(
				[
					{ field: 'title', locale: 'bn' },
					{ field: 'value:color:red', locale: 'xx' },
					{ field: 'category', locale: null },
				],
				key,
			),
		).toEqual(['বাংলা: gap_title', 'xx: gap_value color red', 'gap_category']);
	});

	it('names English in English and every other language in its own script', () => {
		expect(goLiveLabels([{ field: 'title', locale: 'en' }], key)).toEqual(['English: gap_title']);
		expect(goLiveLabels([{ field: 'title', locale: 'hi' }], key)).toEqual(['हिन्दी: gap_title']);
	});

	it('toasts success, or the first gaps and how many more', () => {
		const ok = toasts();
		goLiveToast({ live: true, gaps: [] }, ok, key);
		expect(ok.showSuccess).toHaveBeenCalledWith('go_live_done');
		const many = toasts();
		const gaps = ['a', 'b', 'c', 'd'].map((field) => ({ field, locale: null }));
		goLiveToast({ live: false, gaps }, many, key);
		expect(many.showError.mock.calls[0]?.[0]).toBe('go_live_blocked gap_a, gap_b, gap_c (+1)');
		const few = toasts();
		goLiveToast({ live: false, gaps: gaps.slice(0, 1) }, few, key);
		expect(few.showError.mock.calls[0]?.[0]).toBe('go_live_blocked gap_a');
	});
});

const group = (over: Record<string, unknown> = {}) =>
	({
		attributeCode: 'color',
		label: both,
		semanticRole: 'variation_axis',
		displayStyle: 'rectangle',
		requiredSelection: false,
		defaultTermCode: null,
		terms: [
			{
				code: 'red',
				label: both,
				isBase: false,
				addonTemplateIds: [],
				requiresMeasurements: false,
				sortOrder: 0,
			},
		],
		...over,
	}) as never;

describe('variantCombinations', () => {
	it('crosses the axes only', () => {
		expect(variantCombinations([group({ semanticRole: 'filter_only' })])).toEqual([]);
		const size = group({
			attributeCode: 'size',
			terms: [
				{ code: 's', label: both },
				{ code: 'm', label: both },
			],
		});
		const rows = variantCombinations([size, group()]);
		expect(rows.map((row) => row.hash)).toEqual(['color:red|size:s', 'color:red|size:m']);
	});
});

const definition = (over: Record<string, unknown> = {}) => ({
	id: 'attr_color',
	code: 'color',
	label: both,
	defaultRole: 'variation_axis',
	defaultDisplayStyle: 'color_swatch',
	valueType: 'color',
	terms: [
		{
			code: 'red',
			label: both,
			slug: 'red',
			hex: '#ff0000',
			swatchAssetId: 'a1',
			aliases: [],
			isBase: false,
			hidden: false,
		},
		{ code: 'blue', label: { en: 'Blue' }, slug: 'blue', aliases: [], isBase: false, hidden: false },
		{ code: 'old', label: both, slug: 'old', aliases: [], isBase: false, hidden: true },
	],
	...over,
});

describe('OptionGroups', () => {
	const providers = [{ provide: TranslocoService, useValue: translate }];
	const render = (groups: unknown[] = [], definitions: unknown[] = [definition()], locale = 'bn') =>
		mount(OptionGroups, providers, { groups, definitions, locale });

	it('names roles in plain words', () => {
		expect(render().roleOptions()[0]).toEqual({ value: 'variation_axis', label: 'role_name_variation_axis' });
	});

	describe('changing a role', () => {
		const axis = () => group({ semanticRole: 'variation_axis' });
		const ask = (answer: boolean) => vi.spyOn(window, 'confirm').mockReturnValue(answer);

		afterEach(() => vi.restoreAllMocks());

		it('asks before retiring saved variant rows, and keeps the role on a no', async () => {
			const confirm = ask(false);
			const page = mount(OptionGroups, providers, {
				groups: [axis()],
				definitions: [],
				locale: 'en',
				savedAxes: ['color'],
			});
			page.setRole(0, page.groups()[0] as never, 'filter_only');
			expect(confirm).toHaveBeenCalledWith('role_change_confirm');
			expect(page.groups()[0]?.semanticRole).toBe('variation_axis');
			expect(page.redrawing()).toBe(true);
			await vi.waitFor(() => expect(page.redrawing()).toBe(false));
			confirm.mockReturnValue(true);
			page.setRole(0, page.groups()[0] as never, 'filter_only');
			expect(page.groups()[0]?.semanticRole).toBe('filter_only');
		});

		it('changes freely when nothing would be lost', () => {
			const confirm = ask(false);
			const unsaved = render([axis()]);
			unsaved.setRole(0, unsaved.groups()[0] as never, 'filter_only');
			expect(unsaved.groups()[0]?.semanticRole).toBe('filter_only');
			const toAxis = render([group({ semanticRole: 'filter_only' })]);
			toAxis.setRole(0, toAxis.groups()[0] as never, 'variation_axis');
			expect(toAxis.groups()[0]?.semanticRole).toBe('variation_axis');
			const same = render([axis()]);
			same.setRole(0, same.groups()[0] as never, 'variation_axis');
			expect(confirm).not.toHaveBeenCalled();
		});
	});

	it('offers attributes not yet used, by name or code', () => {
		const page = render([group()], [definition(), definition({ code: 'size', label: { en: 'Size' } })]);
		expect(page.attributeOptions()).toEqual([{ value: 'size', label: 'size' }]);
		const english = render([], [definition({ code: 'size', label: { en: 'Size' } })], 'en');
		expect(english.attributeOptions()).toEqual([{ value: 'size', label: 'Size' }]);
	});

	it('titles a group, offers only named visible values, and flags the unnamed', () => {
		const page = render();
		expect(page.title(group())).toBe('লাল');
		expect(page.title(group({ label: {} }))).toBe('color');
		expect(page.valueOptions(group())).toEqual([{ value: 'red', label: 'লাল' }]);
		expect(page.valueOptions(group({ attributeCode: 'none' }))).toEqual([]);
		expect(page.picked(group())).toEqual(['red']);
		const unnamed = group({ terms: [{ code: 'blue', label: { en: 'Blue' } }] });
		expect(page.unnamed(unnamed)).toHaveLength(1);
		expect(page.baseOptions(unnamed)).toEqual([{ value: 'blue', label: 'blue' }]);
		expect(page.baseOptions(group())).toEqual([{ value: 'red', label: 'লাল' }]);
	});

	it('adds a group from its definition, and ignores anything else', () => {
		const page = render();
		page.add({ value: 'nope' } as never);
		expect(page.groups()).toEqual([]);
		page.add({ value: 'color' } as never);
		expect(page.groups()[0]).toMatchObject({ semanticRole: 'variation_axis', displayStyle: 'color_swatch' });
		expect(page.groups()[0]?.terms[0]).toMatchObject({ hex: '#ff0000', swatchAssetId: 'a1' });
		const plain = render([], [definition({ defaultRole: 'descriptive', terms: [definition().terms[1]] })]);
		plain.add({ value: 'color' } as never);
		expect(plain.groups()[0]?.semanticRole).toBe('filter_only');
		const search = render([], [definition({ defaultRole: 'search' })]);
		search.add({ value: 'color' } as never);
		expect(search.groups()[0]?.semanticRole).toBe('filter_only');
	});

	it('updates and removes a group, leaving the others', () => {
		const page = render([group(), group({ attributeCode: 'size' })]);
		page.update(1, { displayStyle: 'radio' });
		expect(page.groups()[1]?.displayStyle).toBe('radio');
		expect(page.groups()[0]?.displayStyle).toBe('rectangle');
		page.remove(0);
		expect(page.groups().map((row) => row.attributeCode)).toEqual(['size']);
	});

	it('picks values, keeping held ones and refusing unknown ones', () => {
		const page = render([group()]);
		const current = page.groups()[0] as never;
		page.pick(0, current, { value: ['red', 'blue', 'nope'] } as never);
		expect(page.groups()[0]?.terms.map((term) => term.code)).toEqual(['red', 'blue']);
		page.pick(0, current, { value: 'bad' } as never);
		expect(page.groups()[0]?.terms).toEqual([]);
		const orphan = render([group({ attributeCode: 'gone' })]);
		orphan.pick(0, orphan.groups()[0] as never, { value: ['x'] } as never);
		expect(orphan.groups()[0]?.terms).toEqual([]);
	});

	it('names templates in this language, and marks an option as measuring', () => {
		const page = mount(OptionGroups, [{ provide: TranslocoService, useValue: translate }], {
			groups: [
				group({
					terms: [
						{ code: 'a', label: both },
						{ code: 'b', label: both },
					],
				}),
			],
			definitions: [],
			locale: 'bn',
			templates: [
				{ code: 't1', label: { en: 'Blouse', bn: 'Blouse bn' } },
				{ code: 't2', label: { en: 'Fall' } },
			],
		});
		expect(page.templateOptions()).toEqual([
			{ value: 't1', label: 'Blouse bn' },
			{ value: 't2', label: 't2' },
		]);
		page.setMeasures(0, page.groups()[0] as never, 'b', true);
		expect(page.groups()[0]?.terms.map((term) => term.requiresMeasurements)).toEqual([undefined, true]);
	});

	it('sets and clears an override, rounding to whole rupees', () => {
		const two = group({
			terms: [
				{ code: 'a', label: both },
				{ code: 'b', label: both },
			],
		});
		const page = render([two]);
		page.setOverride(0, page.groups()[0] as never, 'a', '99.6');
		expect(page.groups()[0]?.terms[0]?.priceDeltaINR).toBe(100);
		page.setOverride(0, page.groups()[0] as never, 'a', '');
		expect(page.groups()[0]?.terms[0]).not.toHaveProperty('priceDeltaINR');
	});
});

describe('ProductImages', () => {
	const value = (over: Record<string, unknown> = {}) => ({
		imageMode: 'simple',
		gallery: ['a', 'b', 'c'],
		compound: [{ selectionHash: 'h', gallery: ['x'] }],
		altOverrides: {},
		...over,
	});
	const library = {
		details: vi.fn((assetId: string) =>
			assetId === 'broken'
				? throwError(() => new Error('gone'))
				: of({ slug: assetId, text: { alt: { bn: `${assetId} বিবরণ` }, title: {}, caption: {} } }),
		),
	};
	/** What the Media picker hands back (media step 4b); each test sets it before opening. */
	let picks: unknown = [];
	const modals = {
		open: vi.fn(() => ({ componentInstance: { start: vi.fn() }, result: Promise.resolve(picks) })),
	};
	const pick = (assetId: string, versionId: string | null = null) => ({
		assetId,
		versionId,
		name: `${assetId}.jpg`,
		thumbnailUrl: `https://cdn.test/${assetId}.webp`,
	});
	const render = (over: Record<string, unknown> = {}) =>
		mount(
			ProductImages,
			[
				{ provide: MediaGateway, useValue: library },
				{ provide: NgbModal, useValue: modals },
				{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
			],
			{
				value: value(over),
				tiles: new Map(),
				combinations: [],
				locale: 'bn',
			},
		);

	it('shows the primary image’s library alt text as what an empty field uses', () => {
		const page = render();
		expect(page.libraryAlt()).toEqual({ bn: 'a বিবরণ' });
		page.makePrimary(null, 1);
		TestBed.tick();
		expect(page.libraryAlt()).toEqual({ bn: 'b বিবরণ' });
		expect(render({ gallery: ['broken'] }).libraryAlt()).toEqual({});
		expect(render({ gallery: [] }).libraryAlt()).toEqual({});
	});

	it('knows the primary in each mode, and when there is none', () => {
		expect(render().primary()).toBe('a');
		expect(render({ imageMode: 'compound' }).primary()).toBe('x');
		expect(render({ gallery: [] }).primary()).toBeUndefined();
	});

	it('reorders, and stops at the ends', () => {
		const page = render();
		page.move(null, 0, 1);
		expect(page.value().gallery).toEqual(['b', 'a', 'c']);
		page.move(null, 0, -1);
		page.move(null, 2, 1);
		expect(page.value().gallery).toEqual(['b', 'a', 'c']);
		page.makePrimary(null, 2);
		expect(page.value().gallery).toEqual(['c', 'b', 'a']);
		page.remove(null, 0);
		expect(page.value().gallery).toEqual(['b', 'a']);
	});

	it('keeps the other mode when switching, and writes to one combination', () => {
		const page = render();
		page.setMode('compound');
		expect(page.value().gallery).toEqual(['a', 'b', 'c']);
		expect(page.gallery('h')).toEqual(['x']);
		expect(page.gallery('missing')).toEqual([]);
		page.remove('h', 0);
		expect(page.gallery('h')).toEqual([]);
	});

	it('adds what the Media picker hands back once, with each photo’s version, to the gallery it was opened for', async () => {
		const page = render();
		picks = [pick('b', 'product_3x4.white'), pick('d', 'product_3x4.blur')];
		await page.open(null);
		expect(page.value().gallery).toEqual(['a', 'b', 'c', 'd']);
		expect(page.value().versions).toEqual({ b: 'product_3x4.white', d: 'product_3x4.blur' });
		expect(page.tiles().get('d')).toBe('https://cdn.test/d.webp');
		// E04: a tile names its version when it isn't the photo as it is.
		expect(page.versionLabel('d')).toBe('profile_fill_blur');
		expect(page.versionLabel('a')).toBeNull();
		picks = [pick('z')];
		await page.open('new');
		expect(page.gallery('new')).toEqual(['z']);
		picks = [];
		await page.open(null);
		expect(page.value().gallery).toEqual(['a', 'b', 'c', 'd']);
	});

	it('E05: the photo popup sets its version and its alt text on this product', async () => {
		const page = render();
		picks = { versionId: 'product_3x4.blur', alt: { bn: 'লাল' } } as never;
		await page.editPhoto('a');
		expect(page.value().versions).toEqual({ a: 'product_3x4.blur' });
		expect(page.value().altOverrides).toEqual({ a: { bn: 'লাল' } });
		// Cancelled: nothing changes.
		modals.open.mockReturnValueOnce({
			componentInstance: { start: vi.fn() },
			result: Promise.reject(new Error('x')),
		} as never);
		await page.editPhoto('a');
		expect(page.value().versions).toEqual({ a: 'product_3x4.blur' });
	});

	it('flags images more than 5% away from 3:4', () => {
		const page = render();
		expect(page.offShape(null)).toEqual([]);
		page.sizes.set(
			new Map<string, readonly [number, number]>([
				['a', [750, 1000]],
				['b', [760, 1000]],
				['c', [1000, 1000]],
			]),
		);
		expect(page.offShape(null)).toEqual([3]);
	});

	it('edits alt text for the primary in this language', () => {
		const page = render();
		expect(page.alt()).toBe('');
		page.setAlt('লাল');
		expect(page.alt()).toBe('লাল');
		const none = render({ gallery: [] });
		none.setAlt('x');
		expect(none.alt()).toBe('');
		expect(none.value().altOverrides).toEqual({});
	});
});

describe('ProductBundleForm', () => {
	const render = () =>
		mount(ProductBundleForm, [], {
			value: { bundleType: 'fixed_kit', pricePolicy: 'sum_components', fixedPriceINR: null, groups: [] },
			products: [{ value: 'p1', label: 'Saree' }, { options: [] }],
			locale: 'bn',
		});

	it('edits groups and components', () => {
		const page = render();
		page.addGroup();
		page.addGroup();
		const first = () => page.value().groups[0] as never;
		page.setName(0, first(), 'পিস');
		page.setLimit(0, 'maxSelections', '2.4');
		page.addComponent(0, first(), 'p1');
		page.addComponent(0, first(), 'p2');
		page.addComponent(0, first(), '');
		page.addComponent(0, first(), null);
		page.setComponent(0, first(), 1, { quantity: 3 });
		expect(page.value().groups[0]).toMatchObject({
			label: { bn: 'পিস' },
			maxSelections: 2,
			components: [
				{ productId: 'p1', quantity: 1 },
				{ productId: 'p2', quantity: 3 },
			],
		});
		page.removeComponent(0, first(), 0);
		expect(page.value().groups[0]?.components).toHaveLength(1);
		page.removeGroup(1);
		expect(page.value().groups).toHaveLength(1);
		page.set({ bundleType: 'optional_addons' });
		expect(page.value().bundleType).toBe('optional_addons');
		expect(page.productName('p1')).toBe('Saree');
		expect(page.productName('zz')).toBe('zz');
	});
});

const detail = (over: Record<string, unknown> = {}) => ({
	id: 'p1',
	slug: 'silk',
	title: 'Silk',
	sku: 'S1',
	type: 'simple',
	status: 'disabled',
	published: false,
	shipping: { weightGrams: null, lengthCm: null, widthCm: null, heightCm: null },
	hsnCode: null,
	estimatedDeliveryText: null,
	madeToOrder: false,
	lowStockThreshold: null,
	pinnedBadges: [],
	hiddenBadges: [],
	replacementPath: null,
	addonPriceINR: null,
	featured: false,
	relatedProductIds: [],
	upsellProductIds: [],
	crossSellProductIds: [],
	videos: [],
	content: {
		title: { en: 'Silk' },
		shortDescription: {},
		description: {},
		metaTitle: {},
		metaDescription: {},
		estimatedDeliveryText: {},
		categoryIds: [],
		optionGroups: [],
		addonTemplateCode: null,
		imageMode: 'simple',
		gallery: [],
		compound: [],
		altOverrides: {},
	},
	images: [],
	variants: [
		{
			id: 'v1',
			label: 'Base',
			sku: 'S1',
			mrpINR: null,
			sellingINR: 100,
			quantity: 0,
			weightGrams: null,
			lengthCm: null,
			widthCm: null,
			heightCm: null,
			barcode: null,
			hsnCode: null,
			available: true,
		},
	],
	...over,
});

describe('FormProduct builder', () => {
	const render = (options: { id?: string; product?: unknown; bundle?: unknown } = {}) => {
		const service = {
			getCatalogProduct: vi.fn(() => of(options.product ?? detail())),
			getReplacementTargets: vi.fn(() => of([])),
			saveCatalogProduct: vi.fn(() => of({})),
			createCatalogProduct: vi.fn(() => of({ id: 'p1', slug: 'silk' })),
			goLive: vi.fn(() => of({ live: false, gaps: [{ field: 'title', locale: 'bn' }] })),
			getBundle: vi.fn(() => of(options.bundle ?? null)),
			saveBundle: vi.fn(() => of({})),
			discontinueCatalogProduct: vi.fn(() => of({})),
		};
		const router = { navigateByUrl: vi.fn() };
		const toasts = { showSuccess: vi.fn(), showError: vi.fn() };
		const page = mount(
			FormProduct,
			[
				{ provide: ProductService, useValue: service },
				{ provide: Router, useValue: router },
				{ provide: HttpClient, useValue: {} },
				{ provide: PLATFORM_ID, useValue: 'server' },
				{
					provide: ActivatedRoute,
					useValue: { params: new BehaviorSubject(options.id ? { id: options.id } : {}) },
				},
				{ provide: AttributeService, useValue: { getDefinitions: () => of([definition()]) } },
				{ provide: AddonTemplateService, useValue: { list: () => of([{ code: 't1' }]) } },
				{ provide: NotificationService, useValue: toasts },
				{ provide: TranslocoService, useValue: translate },
			],
			{ type: options.id ? 'edit' : 'create' },
		);
		return { page, service, router, toasts };
	};

	it('loads definitions, and refuses a save with no English name', () => {
		const { page, service } = render();
		expect(page.definitions()).toHaveLength(1);
		expect(page.addonTemplates()).toEqual([{ code: 't1' }]);
		page.switchLanguage('bn');
		page.submit();
		expect(page.fields.locale()).toBe('en');
		expect(page.tabError).toBe('general');
		expect(service.createCatalogProduct).not.toHaveBeenCalled();
	});

	it('creates the product, then saves what was typed onto it', () => {
		const { page, service, router } = render();
		page.form.patchValue({ name: 'New', sku: ' N1 ', price: '4500', quantity: '7' });
		page.optionGroups.set([group({ semanticRole: 'filter_only' })]);
		page.submit();
		expect(service.createCatalogProduct).toHaveBeenCalledWith({
			type: 'simple',
			sku: 'N1',
			title: { en: 'New' },
			basePriceINR: 4500,
		});
		const body = (service.saveCatalogProduct.mock.calls[0] as unknown as [string, Record<string, never>])[1];
		expect(body['content']).toMatchObject({ title: { en: 'New' } });
		expect((body['content'] as { optionGroups: unknown[] }).optionGroups).toHaveLength(1);
		expect((body['variants'] as Array<{ quantity: number }>)[0]?.quantity).toBe(7);
		expect(router.navigateByUrl).toHaveBeenCalledWith('/product');
	});

	it('creates a variable product and a free one, whatever the type', () => {
		const variable = render();
		variable.page.form.patchValue({ name: 'V', sku: 'V1', type: 'classified' });
		variable.page.submit();
		expect(variable.service.createCatalogProduct.mock.calls[0]).toEqual([
			{ type: 'variable', sku: 'V1', title: { en: 'V' }, basePriceINR: 0 },
		]);
	});

	it('does not send the address unless it changed, and keeps live only for a live product', () => {
		const live = render({ id: 'p1', product: detail({ status: 'live' }) });
		live.page.form.patchValue({ name: 'Silk', slug: 'silk' });
		live.page.submit();
		const sent = (live.service.saveCatalogProduct.mock.calls[0] as unknown as [string, object])[1];
		expect(sent).not.toHaveProperty('slug');
		expect(sent).toMatchObject({ status: 'live' });
		const renamed = render({ id: 'p1' });
		renamed.page.form.patchValue({ slug: 'new-address' });
		renamed.page.submit();
		expect((renamed.service.saveCatalogProduct.mock.calls[0] as unknown as [string, object])[1]).toMatchObject({
			slug: 'new-address',
			status: 'disabled',
		});
	});

	it('keeps categories, and treats a cleared list as none', () => {
		const { page, service } = render({ id: 'p1' });
		page.selectCategoryItem(['c1', 'c2']);
		page.submit();
		const body = (
			service.saveCatalogProduct.mock.calls[0] as unknown as [string, { content: { categoryIds: string[] } }]
		)[1];
		expect(body.content.categoryIds).toEqual(['c1', 'c2']);
		page.form.patchValue({ categories: null });
		page.submit();
		const next = (
			service.saveCatalogProduct.mock.calls[1] as unknown as [string, { content: { categoryIds: string[] } }]
		)[1];
		expect(next.content.categoryIds).toEqual([]);
	});

	it('reads a bundle, and saves it after the product', () => {
		const saved = {
			bundleType: 'choose_one_per_group',
			pricePolicy: 'sum_components',
			fixedPriceINR: null,
			groups: [{}],
		};
		const { page, service } = render({ id: 'p1', product: detail({ type: 'bundle' }), bundle: saved });
		expect(page.bundle()).toEqual(saved);
		page.submit();
		expect(service.saveBundle).toHaveBeenCalledWith('p1', saved);
		const blank = render({ id: 'p1', product: detail({ type: 'bundle' }) });
		expect(blank.page.bundle().groups).toEqual([]);
		blank.page.submit();
		expect(blank.service.saveBundle).not.toHaveBeenCalled();
	});

	it('names combinations in the current language, falling back to English, then the code', () => {
		const { page } = render({ id: 'p1' });
		page.optionGroups.set([
			group({
				terms: [
					{ code: 'red', label: both },
					{ code: 'blue', label: { en: 'Blue' } },
					{ code: 'bare', label: {} },
				],
			}),
		]);
		page.switchLanguage('bn');
		expect(page.combinations().map((row) => row.label)).toEqual(['লাল', 'Blue', 'bare']);
		page.optionGroups.update((rows) => rows.map((row) => ({ ...row, attributeCode: 'color' })));
	});

	it('shows Go Live gaps in place, and leaves on success', () => {
		const { page, service, toasts, router } = render({ id: 'p1' });
		page.goLive();
		expect(page.gapLabels()).toEqual(['বাংলা: gap_title']);
		expect(toasts.showError).toHaveBeenCalledOnce();
		expect(router.navigateByUrl).not.toHaveBeenCalled();
		service.goLive.mockReturnValueOnce(of({ live: true, gaps: [] }) as never);
		page.goLive();
		expect(router.navigateByUrl).toHaveBeenCalledWith('/product');
		const fresh = render();
		fresh.page.goLive();
		expect(fresh.service.goLive).not.toHaveBeenCalled();
	});

	it('opens the tab and language a gap belongs to', () => {
		const { page } = render({ id: 'p1' });
		const select = vi.fn();
		(page as unknown as { nav: () => unknown }).nav = () => ({ select });
		page.openGap({ field: 'meta_title', locale: 'bn' });
		expect(page.fields.locale()).toBe('bn');
		expect(select).toHaveBeenLastCalledWith('seo');
		page.openGap({ field: 'value:color:red', locale: null });
		expect(page.fields.locale()).toBe('bn');
		expect(select).toHaveBeenLastCalledWith('inventory');
	});

	it('knows the saved axes and image sizes of a product', () => {
		const product = detail({ images: [{ assetId: 'a', url: 'u', width: 3, height: 4 }] });
		(product.content as { optionGroups: unknown[] }).optionGroups = [
			group({ semanticRole: 'variation_axis' }),
			group({ attributeCode: 'fall', semanticRole: 'named_add_on' }),
		];
		const { page } = render({ id: 'p1', product });
		expect(page.savedAxes()).toEqual(['color']);
		expect(page.imageSizes().get('a')).toEqual([3, 4]);
	});

	it('leaves out bundles from the bundle picker, and lists simple products', () => {
		const { page } = render();
		expect(page.bundleProducts()).toEqual([]);
	});
});

describe('FormCategory', () => {
	const row = {
		id: 'cat_1',
		name: { en: 'Sarees', bn: 'শাড়ি' },
		description: {},
		seoTitle: {},
		seoDescription: {},
		slug: 'sarees',
		parentId: 'cat_0',
		alsoUnder: ['cat_9'],
		path: 'sarees',
		productCount: 0,
		image: { id: 'a1', url: 'https://cdn.test/a1' },
		icon: null,
	};
	const blogRow = {
		id: 'bcat_1',
		slug: 'saree-guides',
		name: { en: 'Saree guides' },
		description: { en: 'How to choose' },
		status: 'draft',
		displayOrder: 0,
	};
	const render = (
		id?: string,
		inputs: Record<string, unknown> = {},
		save = () => of({ id: 'cat_1' }) as never,
		saveBlog = () => of({ id: 'bcat_1' }) as never,
	) => {
		const service = {
			getCategoryRows: () => of([row]),
			saveCategory: vi.fn(save),
			hsnImpact: vi.fn(() =>
				of({
					categoryHsn: '5007',
					using: 214,
					own: [{ id: 'p9', sku: 'ST-9', title: 'Own', hsnCode: '5407' }],
				}),
			),
		};
		const blogs = { getTerms: () => of([blogRow]), saveTerm: vi.fn(saveBlog) };
		const router = { navigateByUrl: vi.fn() };
		const toasts = { showSuccess: vi.fn(), showError: vi.fn() };
		const client = { invalidateQueries: vi.fn() };
		const page = mount(
			FormCategory,
			[
				{ provide: CategoryService, useValue: service },
				{ provide: BlogService, useValue: blogs },
				{ provide: Router, useValue: router },
				{ provide: ActivatedRoute, useValue: { params: new BehaviorSubject(id ? { id } : {}) } },
				{ provide: QueryClient, useValue: client },
				{ provide: NotificationService, useValue: toasts },
				{ provide: TranslocoService, useValue: translate },
			],
			{ type: id ? 'edit' : 'create', ...inputs },
		);
		return { page, service, blogs, router, toasts, client };
	};

	it('asks about the products that follow a changed HSN, and saves the answer with the category (F03)', async () => {
		const { page, service } = render('cat_1');
		const modals = TestBed.inject(NgbModal);
		const asked: unknown[] = [];
		let answer: unknown = true;
		const open = vi.spyOn(modals, 'open').mockImplementation(
			() =>
				({
					componentInstance: { start: (ask: unknown) => asked.push(ask) },
					result: Promise.resolve(answer),
				}) as never,
		);
		// Unchanged HSN: no question, saved at once with its returnability.
		page.form.patchValue({ hsn_code: '', returnable: 'no' });
		page.submit();
		expect(service.saveCategory).toHaveBeenLastCalledWith(
			'cat_1',
			expect.objectContaining({ hsnCode: null, returnable: false, updateProductsHsn: false }),
		);
		expect(asked).toEqual([]);
		page.form.patchValue({ hsn_code: '5208' });
		page.submit();
		await vi.waitFor(() => expect(service.saveCategory).toHaveBeenCalledTimes(2));
		expect(asked[0]).toMatchObject({
			params: { count: 214, to: '5208', own: 1 },
			items: ['ST-9 · Own · 5407'],
			yes: 'category_hsn_update',
			no: 'category_hsn_only',
		});
		expect(service.saveCategory).toHaveBeenLastCalledWith(
			'cat_1',
			expect.objectContaining({ hsnCode: '5208', updateProductsHsn: true }),
		);
		// Cancelled: nothing is saved.
		answer = undefined;
		open.mockImplementation(
			() =>
				({
					componentInstance: { start: () => undefined },
					result: Promise.reject(new Error('closed')),
				}) as never,
		);
		page.submit();
		await new Promise((resolve) => setTimeout(resolve));
		expect(service.saveCategory).toHaveBeenCalledTimes(2);
		// A bad code never reaches the API.
		page.form.patchValue({ hsn_code: '54' });
		page.submit();
		expect(service.saveCategory).toHaveBeenCalledTimes(2);
		open.mockRestore();
	});

	it('switches to the language of a to-do line', () => {
		const { page } = render();
		page.openLanguageGap({ key: 'name', locale: 'bn' });
		expect(page.fields.locale()).toBe('bn');
	});

	it('fills from the API, and copes with a missing row', () => {
		const { page } = render('cat_1');
		expect(page.form.value).toMatchObject({ name: 'Sarees', slug: 'sarees', parent_id: 'cat_0' });
		expect(page.gaps()['bn']?.length).toBe(3);
		expect(page.form.value).toMatchObject({ category_image_id: 'a1', category_icon_id: '' });
		expect(page.category.category_image?.original_url).toBe('https://cdn.test/a1');
		expect(page.category.category_icon).toBeUndefined();
		// Shipping (brief cat01): who reads its charges, and its own exception per zone.
		expect(page.shippingUsage()).toEqual({ products: 214, ownCharges: 5 });
		expect(page.zoneExceptions()).toEqual([
			{ zone: 'international', label: 'ship_choice_cantShip', cantShip: true },
		]);
		expect(render('nope').page.id).toBeUndefined();
	});

	it('starts with no images when none are saved', () => {
		row.image = null as never;
		const { page } = render('cat_1');
		row.image = { id: 'a1', url: 'https://cdn.test/a1' };
		expect(page.form.value.category_image_id).toBe('');
		expect(page.category.category_image).toBeUndefined();
	});

	it('tells the tree when the language changes', () => {
		const { page } = render();
		const seen: string[] = [];
		page.localeChange.subscribe((locale) => seen.push(locale));
		page.switchLanguage('bn');
		expect(seen).toEqual(['bn']);
	});

	it('takes its type, and stores images', () => {
		const { page } = render();
		page.ngOnChanges();
		page.selectItem(['cat_2']);
		expect(page.form.value.parent_id).toBe('cat_2');
		expect(page.hasParent()).toBe(true);
		page.selectItem([]);
		expect(page.form.value.parent_id).toBe('');
		// A top-level category's empty shipping fields follow the shop default, not a parent.
		expect(page.hasParent()).toBe(false);
		page.selectItem('x' as never);
		page.selectCategoryImage({ id: 3 } as never);
		page.selectCategoryImage(null as never);
		page.selectCategoryImage([] as never);
		page.selectCategoryIcon({ id: 4 } as never);
		page.selectCategoryIcon(null as never);
		page.selectCategoryIcon([] as never);
		expect(page.form.value.category_image_id).toBe('');
	});

	it('offers other categories for the second placement', () => {
		const tree = [
			{ id: 'a', name: 'A', subcategories: [{ id: 'b', name: 'B' }] },
			{ id: 'cat_1', name: 'Self' },
		];
		const page = render('cat_1', { categories: tree }).page;
		expect(page.placementOptions()).toEqual([
			{ value: 'a', label: 'A' },
			{ value: 'b', label: 'B' },
		]);
		expect(render().page.placementOptions()).toEqual([]);
	});

	it('refuses no English name or a bad address', () => {
		const { page, service } = render();
		page.submit();
		expect(page.form.get('name')?.errors).toEqual({ required: true });
		page.form.patchValue({ name: 'New', slug: 'Bad Slug' });
		page.submit();
		expect(service.saveCategory).not.toHaveBeenCalled();
	});

	it('saves every language, for a new and an existing category', () => {
		const created = render();
		created.page.form.patchValue({ name: 'New', slug: 'new', also_under: null, parent_id: '' });
		created.page.submit();
		expect(created.service.saveCategory.mock.calls[0]).toMatchObject([
			null,
			{ name: { en: 'New' }, slug: 'new', parentId: null, alsoUnder: [] },
		]);
		expect(created.client.invalidateQueries).toHaveBeenCalledOnce();
		expect(created.router.navigateByUrl).toHaveBeenCalledWith('/category');
		const edited = render('cat_1');
		edited.page.switchLanguage('bn');
		// The icon chosen in the Media picker brings its version (R4-1, media step 4d).
		edited.page.selectCategoryIcon({ id: 'a7', versionId: 'square_1x1.crop' } as never);
		edited.page.submit();
		expect(edited.service.saveCategory.mock.calls[0]).toMatchObject([
			'cat_1',
			{
				name: { en: 'Sarees', bn: 'শাড়ি' },
				parentId: 'cat_0',
				alsoUnder: ['cat_9'],
				imageId: 'a1',
				iconId: 'a7',
				imageVersions: { a7: 'square_1x1.crop' },
			},
		]);
	});

	it('says when a save is refused', () => {
		const refused = render(undefined, {}, () => throwError(() => new Error('no')) as never);
		refused.page.form.patchValue({ name: 'New', slug: 'new' });
		refused.page.submit();
		expect(refused.toasts.showError).toHaveBeenCalledWith('category_rejected');
	});

	it('saves a blog category through the blog API, its address made from the English name', () => {
		const blog = render(undefined, { categoryType: 'post' });
		blog.page.form.patchValue({ name: 'Care and styling', slug: '' });
		blog.page.submit();
		expect(blog.service.saveCategory).not.toHaveBeenCalled();
		expect(blog.blogs.saveTerm).toHaveBeenCalledWith('categories', null, {
			name: { en: 'Care and styling' },
			description: { en: '' },
			slug: 'care-and-styling',
			status: 'live',
		});
		expect(blog.router.navigateByUrl).toHaveBeenCalledWith('/blog/category');
	});

	it('fills a saved blog category and lists only its name and description as to-dos', () => {
		const blog = render('bcat_1', { categoryType: 'post' });
		expect(blog.page.form.value).toMatchObject({ name: 'Saree guides', slug: 'saree-guides', status: false });
		expect(blog.page.gaps()['bn']?.map((gap) => gap.key)).toEqual(['name', 'description']);
	});

	it('opens the missing language when a blog category is refused for going live', () => {
		const refusal = new HttpErrorResponse({
			status: 400,
			error: { error: { issues: [{ path: ['name', 'bn'], code: 'go_live_blocked', message: 'x' }] } },
		});
		const blog = render(undefined, { categoryType: 'post' }, undefined, () => throwError(() => refusal) as never);
		blog.page.form.patchValue({ name: 'Care', slug: 'care' });
		blog.page.submit();
		expect(blog.toasts.showError).toHaveBeenCalledWith('blog_go_live_blocked বাংলা: blog_gap_name');
		expect(blog.page.fields.locale()).toBe('bn');
		const plain = render(
			undefined,
			{ categoryType: 'post' },
			undefined,
			() => throwError(() => new Error('x')) as never,
		);
		plain.page.form.patchValue({ name: 'Care', slug: 'care' });
		plain.page.submit();
		expect(plain.toasts.showError).toHaveBeenCalledWith('category_rejected');
	});
});

describe('TreeNode', () => {
	const render = (remove = () => of(undefined) as never) => {
		const router = { navigateByUrl: vi.fn() };
		const service = { deleteCategory: vi.fn(remove) };
		const blogs = { deleteTerm: vi.fn(() => of(undefined)) };
		const toasts = { showError: vi.fn() };
		const node = mount(TreeNode, [
			{ provide: Router, useValue: router },
			{ provide: ActivatedRoute, useValue: { params: of({ id: 'c4' }) } },
			{ provide: CategoryService, useValue: service },
			{ provide: BlogService, useValue: blogs },
			{ provide: QueryClient, useValue: { invalidateQueries: vi.fn() } },
			{ provide: NotificationService, useValue: toasts },
			{ provide: TranslocoService, useValue: translate },
		]);
		return { node, router, service, blogs, toasts };
	};

	it('names a category in the language on screen, or falls back', () => {
		const label = (node: unknown, locale: string) => {
			const fixture = TestBed.createComponent(TreeNode);
			fixture.componentRef.setInput('node', node);
			fixture.componentRef.setInput('locale', locale);
			return fixture.componentInstance.label();
		};
		render();
		const row = { name: { en: 'Sarees', bn: 'শাড়ি' } };
		expect(label({ name: 'Sarees', row }, 'bn')).toBe('শাড়ি');
		expect(label({ name: 'Sarees', row: { name: { en: 'Sarees' } } }, 'bn')).toBe('Sarees');
		expect(label({ name: 'Blog' }, 'bn')).toBe('Blog');
		expect(label({ name: 'Guides', blog: { name: { en: 'Guides', bn: 'গাইড' } } }, 'bn')).toBe('গাইড');
	});

	it('reads the selected id, and deletes through the API', () => {
		const { node, router, service } = render();
		expect(node.id).toBe('c4');
		node.delete('delete', { id: 'c1', type: 'product' } as never);
		expect(service.deleteCategory).toHaveBeenCalledWith('c1');
		expect(router.navigateByUrl).toHaveBeenLastCalledWith('/category');
	});

	it('deletes blog categories through the blog API, and says when a delete is refused', () => {
		const blog = render();
		blog.node.delete('delete', { id: 'b', type: 'post' } as never);
		expect(blog.service.deleteCategory).not.toHaveBeenCalled();
		expect(blog.blogs.deleteTerm).toHaveBeenCalledWith('categories', 'b');
		expect(blog.router.navigateByUrl).toHaveBeenCalledWith('/blog/category');
		const refused = render(() => throwError(() => new Error('no')) as never);
		refused.node.delete('delete', { id: 'c', type: 'product' } as never);
		expect(refused.toasts.showError).toHaveBeenCalledWith('category_rejected');
	});
});

describe('Attribute list', () => {
	const render = (remove = () => of(undefined) as never) => {
		const service = { deleteAttribute: vi.fn(remove) };
		const router = { navigateByUrl: vi.fn() };
		const toasts = { showError: vi.fn() };
		const page = mount(Attribute, [
			{ provide: Router, useValue: router },
			{ provide: AttributeService, useValue: service },
			{ provide: NotificationService, useValue: toasts },
			{ provide: TranslocoService, useValue: translate },
		]);
		return { page, service, router, toasts };
	};

	beforeEach(() => empty.set(undefined));

	it('fills the table', () => {
		const { page } = render();
		expect(page.tableConfig()).toMatchObject({ data: [], total: 0 });
		empty.set({ data: [{ id: 'color' }], total: 1 });
		TestBed.tick();
		expect(page.tableConfig().total).toBe(1);
		empty.set(undefined);
		page.onTableChange({ page: 2 });
	});

	it('edits, deletes and bulk deletes', () => {
		const { page, service, router } = render();
		page.onActionClicked({ actionToPerform: 'edit', data: { id: 'color' } } as never);
		expect(router.navigateByUrl).toHaveBeenCalledWith('/attribute/edit/color');
		page.onActionClicked({ actionToPerform: 'delete', data: { id: 'color' } } as never);
		page.onActionClicked({ actionToPerform: 'deleteAll', data: ['a', 'b'] } as never);
		page.onActionClicked({ actionToPerform: 'other', data: {} } as never);
		expect(service.deleteAttribute).toHaveBeenCalledTimes(3);
		expect(refetch).toHaveBeenCalled();
	});

	it('says when a delete is refused', () => {
		const { page, toasts } = render(() => throwError(() => new Error('used')) as never);
		page.delete({ id: 'color' } as never);
		expect(toasts.showError).toHaveBeenCalledWith('attribute_rejected');
	});
});

describe('FormAttribute', () => {
	const render = (id?: string, save = () => of({}) as never) => {
		const service = { getDefinitions: () => of([definition()]), saveAttribute: vi.fn(save) };
		const router = { navigateByUrl: vi.fn() };
		const toasts = { showError: vi.fn() };
		const client = { invalidateQueries: vi.fn() };
		const page = mount(
			FormAttribute,
			[
				{ provide: AttributeService, useValue: service },
				{ provide: Router, useValue: router },
				{ provide: ActivatedRoute, useValue: { params: new BehaviorSubject(id ? { id } : {}) } },
				{ provide: QueryClient, useValue: client },
				{ provide: NotificationService, useValue: toasts },
				{ provide: TranslocoService, useValue: translate },
				{
					provide: MediaGateway,
					useValue: { get: (assetId: string) => of({ id: assetId, original_url: 'a.webp' }) },
				},
			],
			{ type: id ? 'edit' : 'create' },
		);
		return { page, service, router, toasts };
	};

	it('gives each value a default picture in the picture styles only', () => {
		const { page } = render('color');
		expect(page.isPicture).toBe(false);
		expect(page.picture(page.terms()[0]!)).toMatchObject({ id: 'a1', original_url: 'a.webp' });
		page.form.patchValue({ style: 'image_tile' });
		expect(page.isPicture).toBe(true);
		page.setPicture(0, [{ id: 'b2', original_url: 'b.webp', versionId: 'square_1x1.crop' }] as never);
		expect(page.terms()[0]).toMatchObject({ swatchAssetId: 'b2', swatchVersionId: 'square_1x1.crop' });
		expect(page.picture(page.terms()[0]!)?.original_url).toBe('b.webp');
		page.setPicture(0, null);
		expect(page.terms()[0]).not.toHaveProperty('swatchAssetId');
		expect(page.terms()[0]).not.toHaveProperty('swatchVersionId');
		expect(page.picture(page.terms()[0]!)).toBeNull();
	});

	it('fills from the API, keeping the code', () => {
		const { page } = render('color');
		expect(page.code()).toBe('color');
		expect(page.form.value).toMatchObject({ name: 'Red', style: 'color_swatch', default_role: 'variation_axis' });
		expect(page.isColour).toBe(true);
		expect(page.gaps()['bn']?.length).toBe(1);
		expect(render('nope').page.code()).toBeNull();
	});

	it('reads filter settings, with defaults', () => {
		const service = {
			getDefinitions: () =>
				of([
					definition({ filterConfig: { visible: false, sortOrder: 0, defaultFacetDisplayStyle: 'swatch' } }),
				]),
		};
		const page = mount(
			FormAttribute,
			[
				{ provide: AttributeService, useValue: service },
				{ provide: Router, useValue: {} },
				{ provide: ActivatedRoute, useValue: { params: of({ id: 'color' }) } },
				{ provide: QueryClient, useValue: {} },
				{ provide: NotificationService, useValue: {} },
				{ provide: TranslocoService, useValue: translate },
			],
			{ type: 'edit' },
		);
		expect(page.form.value).toMatchObject({ use_as_filter: false, facet_style: 'swatch' });
	});

	it('lists each missing value, and jumps to it', () => {
		vi.useFakeTimers();
		const { page } = render();
		const input = document.createElement('input');
		input.id = 'value_0';
		document.body.appendChild(input);
		page.openLanguageGap({ key: 'value_0', locale: 'bn' });
		vi.runAllTimers();
		expect(page.fields.locale()).toBe('bn');
		expect(document.activeElement).toBe(input);
		input.remove();
		vi.useRealTimers();
		page.add();
		const last = page.gaps()['en']?.at(-1);
		expect(last).toMatchObject({ label: 'value', name: String(page.terms().length) });
		expect(page.roleOptions()[0]?.label).toBe('role_name_filter_only');
	});

	it('edits values, naming a new one from English only', () => {
		const { page } = render();
		expect(page.onSourceLanguage).toBe(true);
		page.setName(0, page.terms()[0] as never, 'Royal Blue');
		expect(page.terms()[0]).toMatchObject({ label: { en: 'Royal Blue' }, slug: 'royal-blue' });
		page.setSlug(0, 'Blue One');
		page.setHex(0, '#112233');
		page.setAliases(0, 'neel, , blue');
		expect(page.terms()[0]).toMatchObject({ slug: 'blue-one', hex: '#112233', aliases: ['neel', 'blue'] });
		page.switchLanguage('bn');
		expect(page.onSourceLanguage).toBe(false);
		page.setName(0, page.terms()[0] as never, 'নীল');
		expect(page.terms()[0]).toMatchObject({ label: { bn: 'নীল' }, slug: 'blue-one' });
		expect(page.guide(page.terms()[0] as never)).toBe('Royal Blue');
		expect(page.guide({ label: {} } as never)).toBe('');
		page.toggleHidden(0, page.terms()[0] as never);
		expect(page.terms()[0]?.hidden).toBe(true);
		page.add();
		page.setSlug(1, 'second');
		expect(page.terms()[0]?.slug).toBe('blue-one');
		page.remove(1);
		expect(page.terms()).toHaveLength(1);
		page.nameGaps.set({});
		expect(page.gaps()['en']?.length).toBe(0);
	});

	it('refuses no English name', () => {
		const { page, service } = render();
		page.switchLanguage('bn');
		page.submit();
		expect(page.fields.locale()).toBe('en');
		expect(service.saveAttribute).not.toHaveBeenCalled();
	});

	it('saves, dropping blank rows and filling codes', () => {
		const { page, service, router } = render();
		page.form.patchValue({ name: 'Colour Family', style: 'color_swatch' });
		page.setName(0, page.terms()[0] as never, 'Red');
		page.add();
		page.submit();
		expect(service.saveAttribute.mock.calls[0]).toMatchObject([
			{ code: 'colour-family', valueType: 'color', terms: [{ code: 'red', slug: 'red' }] },
		]);
		expect(router.navigateByUrl).toHaveBeenCalledWith('/attribute');
	});

	it('keeps a saved code, a term with no slug, and a plain value type', () => {
		const { page, service } = render('color');
		page.form.patchValue({ style: 'rectangle' });
		page.terms.update((rows) => rows.map((row) => ({ ...row, slug: '' })));
		page.submit();
		expect(service.saveAttribute.mock.calls[0]).toMatchObject([
			{ code: 'color', valueType: 'term', terms: [{ code: 'red', slug: 'red' }, {}, {}] },
		]);
	});

	it('says when a save is refused', () => {
		const { page, toasts } = render(undefined, () => throwError(() => new Error('no')) as never);
		page.form.patchValue({ name: 'New' });
		page.submit();
		expect(toasts.showError).toHaveBeenCalledWith('attribute_rejected');
	});
});

describe('Product list Go Live', () => {
	it('uses the same check and toast, and refreshes when live', () => {
		const service = { goLive: vi.fn(() => of({ live: true, gaps: [] })) };
		const toasts = { showSuccess: vi.fn(), showError: vi.fn() };
		const page = mount(Product, [
			{ provide: Router, useValue: {} },
			{ provide: ProductService, useValue: service },
			{ provide: NotificationService, useValue: toasts },
			{
				provide: TranslocoService,
				useValue: { ...translate, langChanges$: of('en'), getActiveLang: () => 'en' },
			},
			{ provide: ProductDraftService, useValue: { list: () => of({ items: [], mine: 0 }) } },
		]);
		page.onActionClicked({ actionToPerform: 'go_live', data: { id: 'p1' } } as never);
		expect(service.goLive).toHaveBeenCalledWith('p1');
		expect(toasts.showSuccess).toHaveBeenCalledOnce();
		expect(refetch).toHaveBeenCalledOnce();
		service.goLive.mockReturnValueOnce(of({ live: false, gaps: [{ field: 'title', locale: 'bn' }] }) as never);
		page.goLive({ id: 'p1' } as never);
		expect(toasts.showError).toHaveBeenCalledOnce();
		expect(refetch).toHaveBeenCalledOnce();
	});
});

describe('Taxonomy services', () => {
	const http = () => ({ get: vi.fn(), post: vi.fn(() => of({})), delete: vi.fn(() => of(undefined)) });
	const inject = <T>(type: Type<T>, client: unknown) => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: client }] });
		return TestBed.inject(type);
	};

	it('nests categories, keeping an orphan at the top', async () => {
		const client = http();
		const row = (id: string, parentId: string | null, over = {}) => ({
			id,
			name: { en: id },
			description: { en: 'text' },
			slug: id,
			parentId,
			...over,
		});
		client.get.mockReturnValue(
			of([row('a', null), row('b', 'a'), row('c', 'missing'), row('d', 'a', { name: {}, description: {} })]),
		);
		const model = await firstValueFrom(inject(CategoryService, client).getCategories());
		expect(model.total).toBe(4);
		expect(model.data.map((item) => item.id)).toEqual(['a', 'c']);
		expect(model.data[0]?.subcategories?.map((item) => item.name)).toEqual(['b', 'd']);
	});

	it('reads, saves and deletes categories at the right addresses', async () => {
		const client = http();
		const service = inject(CategoryService, client);
		client.get.mockReturnValue(of([]));
		await firstValueFrom(service.getCategoryRows());
		await firstValueFrom(service.saveCategory(null, {} as never));
		await firstValueFrom(service.saveCategory('a b', {} as never));
		await firstValueFrom(service.deleteCategory('a b'));
		expect((client.post.mock.calls as unknown as string[][]).map((call) => call[0])).toEqual([
			expect.stringMatching(/admin\/catalog\/categories$/),
			expect.stringMatching(/categories\/a%20b$/),
		]);
		expect(client.delete).toHaveBeenCalledOnce();
	});

	it('maps attributes and writes them', async () => {
		const client = http();
		client.get.mockReturnValue(of([definition()]));
		const service = inject(AttributeService, client);
		const model = await firstValueFrom(service.getAttributes());
		expect(model.data[0]).toMatchObject({ id: 'color', name: 'Red' });
		await firstValueFrom(service.saveAttribute({} as never));
		await firstValueFrom(service.deleteAttribute('a b'));
		expect((client.delete.mock.calls as unknown as string[][])[0]?.[0]).toMatch(/attributes\/a%20b$/);
	});

	it('calls the product builder routes', async () => {
		const client = http();
		client.get.mockReturnValue(of(null));
		const service = inject(ProductService, client);
		await firstValueFrom(service.createCatalogProduct({} as never));
		await firstValueFrom(service.goLive('p 1'));
		await firstValueFrom(service.getBundle('p 1'));
		await firstValueFrom(service.saveBundle('p 1', {} as never));
		const posted = (client.post.mock.calls as unknown as string[][]).map((call) => call[0]);
		expect(posted[1]).toMatch(/products\/p%201\/go-live$/);
		expect(posted[2]).toMatch(/products\/p%201\/bundle$/);
	});
});

describe('swatch pictures', () => {
	const picture = (id: string) => ({ id, original_url: `${id}.webp` });
	const gateway = { get: vi.fn((id: string) => of(picture(id))), details: vi.fn() };
	const pickerStart = vi.fn();
	const swatchModals = {
		open: vi.fn(() => ({
			componentInstance: { start: pickerStart },
			result: Promise.resolve([
				{ assetId: 'fabric', versionId: 'square_1x1.as_is', name: 'fabric.jpg', thumbnailUrl: 'fabric.webp' },
			]),
		})),
	};
	const providers = [
		{ provide: TranslocoService, useValue: translate },
		{ provide: MediaGateway, useValue: gateway },
		{ provide: NgbModal, useValue: swatchModals },
	];
	const swatchGroup = (terms: Record<string, unknown>[]) =>
		group({
			displayStyle: 'image_swatch',
			terms: terms.map((term, index) => ({
				code: `v${index}`,
				label: both,
				isBase: false,
				addonTemplateIds: [],
				requiresMeasurements: false,
				sortOrder: index,
				...term,
			})),
		});
	const render = (terms: Record<string, unknown>[], tiles = new Map<string, string>()) =>
		mount(OptionGroups, providers, {
			groups: [swatchGroup(terms)],
			definitions: [],
			locale: 'en',
			photos: ['p1', 'p2'],
			tiles,
		});

	afterEach(() => gateway.get.mockClear());

	it('offers the product photos in order, then a library picture already chosen', () => {
		const page = render([{}, { swatchAssetId: 'lib' }], new Map([['p1', 'p1.webp']]));
		const [plain, chosen] = page.groups()[0]!.terms;
		expect(page.swatchTiles(plain!).map((tile) => tile.id)).toEqual(['p1', 'p2']);
		expect(page.swatchTiles(plain!)[1]?.url).toBe('assets/images/product.png');
		expect(page.swatchTiles(chosen!).map((tile) => tile.id)).toEqual(['p1', 'p2', 'lib']);
	});

	it('fetches a preview it does not know, once', () => {
		const page = render([{ swatchAssetId: 'lib' }, { swatchAssetId: 'lib' }]);
		expect(gateway.get).toHaveBeenCalledTimes(1);
		expect(page.tiles().get('lib')).toBe('lib.webp');
	});

	it('chooses a photo on tap and clears it on a second tap', () => {
		const page = render([{}]);
		page.chooseSwatch(0, page.groups()[0]!, 'v0', 'p2');
		expect(page.groups()[0]?.terms[0]?.swatchAssetId).toBe('p2');
		page.chooseSwatch(0, page.groups()[0]!, 'v0', 'p1');
		expect(page.groups()[0]?.terms[0]?.swatchAssetId).toBe('p1');
		page.chooseSwatch(0, page.groups()[0]!, 'v0', 'p1');
		expect(page.groups()[0]?.terms[0]).not.toHaveProperty('swatchAssetId');
	});

	it('the library opens the Media picker for any photo, and its choice goes to the value that asked (step 4d)', async () => {
		const page = render([{}, {}]);
		await page.openLibrary(0, 'v0');
		expect(pickerStart).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'fm_pick_title_swatch', max: 1, profile: null }),
		);
		expect(page.groups()[0]?.terms[0]?.swatchAssetId).toBe('fabric');
		// The version chosen in the picker is kept with the swatch (media brief: a place stores photo + version).
		expect(page.groups()[0]?.terms[0]?.swatchVersionId).toBe('square_1x1.as_is');
		expect(page.tiles().get('fabric')).toBe('fabric.webp');
		// One of the product's own photos stores no version: the shop draws the one its gallery stores.
		page.chooseSwatch(0, page.groups()[0]!, 'v0', 'p1');
		expect(page.groups()[0]?.terms[0]).toMatchObject({ swatchAssetId: 'p1' });
		expect(page.groups()[0]?.terms[0]).not.toHaveProperty('swatchVersionId');
	});

	it('takes a picture from the library for the value that asked', () => {
		const page = render([{}, {}]);
		page.fromLibrary(picture('nothing') as never);
		expect(page.groups()[0]?.terms.every((term) => !term.swatchAssetId)).toBe(true);
		void page.openLibrary(0, 'v1');
		page.fromLibrary([picture('close-up')] as never);
		expect(page.groups()[0]?.terms[1]?.swatchAssetId).toBe('close-up');
		expect(page.tiles().get('close-up')).toBe('close-up.webp');
		expect(page.termLabel(page.groups()[0]!.terms[0]!)).toBe('Red');
	});
});
