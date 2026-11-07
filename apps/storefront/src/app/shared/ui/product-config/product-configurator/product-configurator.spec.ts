import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { IProduct, IVariation } from '@data-access/interfaces/product.interface';

import { ProductConfigurator } from './product-configurator';

const product = (overrides: Record<string, unknown> = {}) =>
	({ id: 'p1', price: 1000, sale_price: 800, stock_status: 'in_stock', ...overrides }) as unknown as IProduct;

const variation = (overrides: Record<string, unknown> = {}) =>
	({
		id: 'v1',
		sku: 'V1',
		name: 'Red',
		price: 900,
		sale_price: 700,
		stock_status: 'in_stock',
		...overrides,
	}) as unknown as IVariation;

const withVariants = (overrides: Record<string, unknown> = {}) =>
	product({ attributes: [{ id: 1 }], variations: [variation(), variation({ id: 'v2', sku: 'V2' })], ...overrides });

const addonGroups = [
	{
		code: 'blouse',
		label: 'Blouse',
		default_term_code: 'none',
		terms: [
			{ code: 'none', label: 'None', price_delta: 0 },
			{ code: 'one', label: 'One', price_delta: 500 },
		],
	},
	{ code: 'fall', label: 'Fall', terms: [{ code: 'yes', label: 'Yes', price_delta: 100 }] },
	{ code: 'empty', label: 'Empty', terms: [] },
];

const bundle = (overrides: Record<string, unknown> = {}) => ({
	bundle_price: 2000,
	components: [{ name: 'A', sku: 'A', price: 100 }],
	option_groups: [
		{ code: 'size', label: 'Size', default_term_code: 's', terms: [{ code: 's', label: 'S', price_delta: 0 }] },
		{ code: 'cut', label: 'Cut', terms: [{ code: 'x', label: 'X', price_delta: 50 }] },
		{ code: 'none', label: 'None', terms: [] },
	],
	...overrides,
});

const render = (item: IProduct, initialConfig?: unknown, platform = 'browser') => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: platform }] });
	TestBed.overrideComponent(ProductConfigurator, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(ProductConfigurator);
	fixture.componentRef.setInput('product', item);
	if (initialConfig) fixture.componentRef.setInput('initialConfig', initialConfig);
	fixture.detectChanges();
	return { fixture, component: fixture.componentInstance };
};

afterEach(() => {
	vi.useRealTimers();
});

describe('what a product shows', () => {
	it('gates each section on the data', () => {
		const { component } = render(
			withVariants({ semantic_attributes: [{}], addon_groups: addonGroups, bundle: bundle() }),
		);
		expect(component.hasFilterAttrs()).toBe(true);
		expect(component.hasVariation()).toBe(true);
		expect(component.hasAddon()).toBe(true);
		expect(component.hasBundle()).toBe(true);
		const plain = render(product()).component;
		expect([plain.hasFilterAttrs(), plain.hasVariation(), plain.hasAddon(), plain.hasBundle()]).toEqual([
			false,
			false,
			false,
			false,
		]);
		expect(render(product({ attributes: [{}], variations: [] })).component.hasVariation()).toBe(false);
	});

	it('reads the seeds for an edit', () => {
		const raw = { addon_selections: { a: 'b' }, bundle_selections: { c: 'd' }, measurements: { chest: 30 } };
		const { component } = render(product(), { raw });
		expect(component.addonSeed()).toEqual(raw.addon_selections);
		expect(component.bundleSeed()).toEqual(raw.bundle_selections);
		expect(component.measurementSeed()).toEqual(raw.measurements);
		expect(render(product()).component.addonSeed()).toBeUndefined();
	});
});

describe('prices', () => {
	it('takes the variant, then the bundle, then the product', () => {
		const chosen = render(withVariants()).component;
		chosen.selectVariation(variation());
		expect(chosen.effectiveBase()).toBe(700);
		expect(chosen.comparePrice()).toBe(900);
		expect(render(product({ bundle: bundle() })).component.effectiveBase()).toBe(2000);
		const plain = render(product()).component;
		expect(plain.effectiveBase()).toBe(800);
		expect(plain.comparePrice()).toBe(1000);
	});

	it('works out the discount', () => {
		expect(render(product()).component.discount()).toBe(20);
		expect(render(product({ price: 800 })).component.discount()).toBe(0);
		expect(render(product({ price: 0 })).component.discount()).toBe(0);
	});

	it('stacks add-on and bundle deltas', () => {
		const { component } = render(product());
		expect(component.unitPrice()).toBe(800);
		component.onAddonChange({ delta: 100, valid: true } as never);
		component.onBundleChange({ delta: 50, valid: true } as never);
		expect(component.unitPrice()).toBe(950);
	});
});

describe('can it be bought', () => {
	it('needs a variant in stock when there are variants', () => {
		const { component } = render(withVariants());
		expect(component.purchasable()).toBe(false);
		component.selectVariation(variation());
		expect(component.purchasable()).toBe(true);
	});

	it('never sells a bundle yet, and follows the stock otherwise', () => {
		const kit = render(product({ bundle: bundle() })).component;
		kit.onBundleChange({ delta: 0, valid: true } as never);
		expect(kit.purchasable()).toBe(false);
		expect(render(product({ stock_status: 'out_of_stock' })).component.purchasable()).toBe(false);
	});

	it('needs a valid add-on when there are add-ons', () => {
		const { component } = render(product({ addon_groups: addonGroups }));
		expect(component.purchasable()).toBe(false);
		component.onAddonChange({ delta: 0, valid: true } as never);
		expect(component.purchasable()).toBe(true);
	});

	it('says sold out only when it really is', () => {
		const chosen = render(withVariants({ stock_status: 'in_stock' })).component;
		expect(chosen.soldOut()).toBe(false);
		chosen.selectVariation(variation({ stock_status: 'out_of_stock' }));
		expect(chosen.soldOut()).toBe(true);
		expect(render(withVariants({ stock_status: 'out_of_stock' })).component.soldOut()).toBe(true);
		expect(render(product({ bundle: bundle(), stock_status: 'out_of_stock' })).component.soldOut()).toBe(false);
		expect(render(product({ stock_status: 'out_of_stock' })).component.soldOut()).toBe(true);
	});

	it('reports a summary to its host', () => {
		const { component, fixture } = render(product());
		const seen: unknown[] = [];
		component.summaryChange.subscribe((summary) => seen.push(summary));
		component.onAddonChange({ delta: 10, valid: true } as never);
		fixture.detectChanges();
		expect(seen.at(-1)).toMatchObject({ unitPrice: 810, purchasable: true, discount: expect.any(Number) });
	});
});

describe('choosing a variant', () => {
	it('seeds from a saved line, and ignores an unknown id', () => {
		expect(render(withVariants(), { raw: { variation_id: 'v2' } }).component.selectedVariation()?.id).toBe('v2');
		expect(render(withVariants(), { raw: { variation_id: 'gone' } }).component.selectedVariation()).toBeNull();
		expect(render(product(), { raw: { variation_id: 'v2' } }).component.selectedVariation()).toBeNull();
	});

	it('ignores a late empty choice over a seeded variant, but accepts one otherwise', () => {
		const seeded = render(withVariants(), { raw: { variation_id: 'v2' } }).component;
		seeded.selectVariation(null);
		expect(seeded.selectedVariation()?.id).toBe('v2');
		const free = render(withVariants()).component;
		free.selectVariation(variation());
		free.selectVariation(null);
		expect(free.selectedVariation()).toBeNull();
	});

	it('writes the address only after the first choice has settled, and only in a browser', () => {
		vi.useFakeTimers();
		const replace = vi.spyOn(history, 'replaceState');
		const { component } = render(withVariants());
		component.selectVariation(variation());
		component.selectVariation(variation({ id: 'v2', sku: 'V2' }));
		expect(replace).not.toHaveBeenCalled();
		vi.runAllTimers();
		component.selectVariation(variation({ id: 'v3', sku: 'V3' }));
		expect(String(replace.mock.calls.at(-1)?.[2])).toContain('variant=V3');
		vi.runAllTimers();
		replace.mockClear();
		component.selectVariation(variation({ sku: '' }));
		component.selectVariation(null);
		expect(replace).not.toHaveBeenCalled();
		const server = render(withVariants(), undefined, 'server').component;
		server.selectVariation(variation());
		vi.runAllTimers();
		server.selectVariation(variation());
		expect(replace).not.toHaveBeenCalled();
		replace.mockRestore();
	});
});

describe('the cart line', () => {
	it('builds a plain line', () => {
		const params = render(product()).component.buildParams(2, null);
		expect(params).toMatchObject({
			id: null,
			product_id: 'p1',
			variation: null,
			variation_id: null,
			quantity: 2,
			unit_price: 800,
		});
		expect(params.line_config).toMatchObject({ base_price: 800, delta_total: 0, variation_label: undefined });
		expect(params.line_config?.raw).toMatchObject({
			variation_id: null,
			addon_selections: undefined,
			bundle_selections: undefined,
			measurements: undefined,
		});
		expect(params.line_config?.addon_options).toBeUndefined();
	});

	it('names the variant', () => {
		const { component } = render(withVariants());
		component.selectVariation(variation());
		const params = component.buildParams(1, 'l7');
		expect(params).toMatchObject({ id: 'l7', variation_id: 'v1' });
		expect(params.line_config).toMatchObject({ variation_label: 'Red', raw: { variation_id: 'v1' } });
		component.selectVariation(variation({ name: '' }));
		expect(component.buildParams(1, 'l7').line_config?.variation_label).toBeUndefined();
	});

	it('resolves add-on choices through the default and the first term', () => {
		const { component } = render(product({ addon_groups: addonGroups }));
		component.onAddonChange({ delta: 500, valid: true, selections: { blouse: 'one' } } as never);
		expect(component.buildParams(1, null).line_config?.addon_options).toEqual([
			{ group: 'Blouse', value: 'One', price_delta: 500 },
			{ group: 'Fall', value: 'Yes', price_delta: 100 },
			{ group: 'Empty', value: '', price_delta: 0 },
		]);
		component.onAddonChange({ delta: 0, valid: true } as never);
		expect(component.buildParams(1, null).line_config?.addon_options?.[0]).toEqual({
			group: 'Blouse',
			value: 'None',
			price_delta: 0,
		});
		expect(
			render(product({ addon_groups: [] })).component.buildParams(1, null).line_config?.addon_options,
		).toBeUndefined();
	});

	it('resolves bundle choices and lists the components', () => {
		const { component } = render(product({ bundle: bundle() }));
		component.onBundleChange({ delta: 50, valid: true, selections: { cut: 'x' } } as never);
		const config = component.buildParams(1, null).line_config;
		expect(config?.bundle_options).toEqual([
			{ group: 'Size', value: 'S', price_delta: 0 },
			{ group: 'Cut', value: 'X', price_delta: 50 },
			{ group: 'None', value: '', price_delta: 0 },
		]);
		expect(config?.bundle_components).toEqual([{ name: 'A', sku: 'A', price: 100 }]);
		component.onBundleChange({ delta: 0, valid: true } as never);
		expect(component.buildParams(1, null).line_config?.bundle_options?.[0]?.value).toBe('S');
		const none = render(product({ bundle: bundle({ option_groups: undefined }) })).component;
		expect(none.buildParams(1, null).line_config?.bundle_options).toEqual([]);
	});

	it('records measurements from either source, skipping blanks', () => {
		const fields = [
			{ code: 'chest', label: 'Chest', unit: 'in' },
			{ code: 'hip', label: 'Hip', unit: 'in' },
		];
		const own = render(product({ measurement_fields: fields })).component;
		own.onAddonChange({ delta: 0, valid: true, measurements: { chest: 30 } } as never);
		expect(own.buildParams(1, null).line_config).toMatchObject({
			measurements: [{ label: 'Chest', value: 30, unit: 'in' }],
			raw: { measurements: { chest: 30 } },
		});
		const kit = render(product({ bundle: bundle({ measurement_fields: fields }) })).component;
		kit.onBundleChange({ delta: 0, valid: true, measurements: { hip: 40 } } as never);
		expect(kit.buildParams(1, null).line_config?.measurements).toEqual([{ label: 'Hip', value: 40, unit: 'in' }]);
		const empty = render(product({ measurement_fields: fields })).component;
		empty.onAddonChange({ delta: 0, valid: true, measurements: {} } as never);
		expect(empty.buildParams(1, null).line_config?.measurements).toBeUndefined();
		const noFields = render(product()).component;
		noFields.onAddonChange({ delta: 0, valid: true, measurements: { chest: 30 } } as never);
		expect(noFields.buildParams(1, null).line_config?.measurements).toBeUndefined();
	});
});
