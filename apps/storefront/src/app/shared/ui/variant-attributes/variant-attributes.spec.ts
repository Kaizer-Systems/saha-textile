import { TestBed } from '@angular/core/testing';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { IProduct, IVariation } from '@data-access/interfaces/product.interface';

import { VariantAttributes } from './variant-attributes';

const red = { id: 11, value: 'Red', attribute_id: 1 };
const blue = { id: 12, value: 'Blue', attribute_id: 1 };
const small = { id: 21, value: 'S', attribute_id: 2 };
const large = { id: 22, value: 'L', attribute_id: 2 };

const variation = (sku: string, values: unknown[], overrides: Record<string, unknown> = {}) =>
	({
		id: sku,
		sku,
		quantity: 5,
		stock_status: 'in_stock',
		attribute_values: values,
		...overrides,
	}) as unknown as IVariation;

const product = (overrides: Record<string, unknown> = {}) =>
	({
		sku: 'none',
		quantity: 1,
		attributes: [
			{ id: 1, style: 'color', attribute_values: [{ ...red }, { ...blue }] },
			{ id: 2, style: 'rectangle', attribute_values: [{ ...small }, { ...large }] },
		],
		variations: [variation('RS', [red, small]), variation('RL', [red, large]), variation('BS', [blue, small])],
		...overrides,
	}) as unknown as IProduct;

const build = () => {
	TestBed.resetTestingModule();
	TestBed.overrideComponent(VariantAttributes, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(VariantAttributes);
	return { fixture, component: fixture.componentInstance };
};

afterEach(() => {
	vi.useRealTimers();
});

describe('opening selection', () => {
	it('does nothing with no product', () => {
		const { component } = build();
		component.checkVariantAvailability(undefined);
		expect(component.selectedOptions).toEqual([]);
	});

	it('opens on the SKU the server chose', () => {
		const { component } = build();
		const item = product({ sku: 'RL' });
		component.product = item;
		component.checkVariantAvailability(item);
		expect(component.selectedVariation?.sku).toBe('RL');
		expect(item.quantity).toBe(5);
	});

	it('opens on the first value of each axis otherwise', () => {
		const { component } = build();
		const item = product();
		component.product = item;
		component.checkVariantAvailability(item);
		expect(component.selectedVariation?.sku).toBe('RS');
	});

	it('skips an axis with no values, and a product with no variations', () => {
		const { component } = build();
		const item = product({ attributes: [{ id: 1, style: 'color', attribute_values: [] }] });
		component.product = item;
		component.checkVariantAvailability(item);
		expect(component.selectedVariation).toBeNull();
		const bare = product({ attributes: undefined, variations: undefined });
		component.product = bare;
		expect(() => component.checkVariantAvailability(bare)).not.toThrow();
	});

	it('passes over a value no variation uses', () => {
		const { component } = build();
		const item = product({
			attributes: [
				{ id: 1, style: 'color', attribute_values: [{ id: 99, value: 'Unused', attribute_id: 1 }, { ...red }] },
			],
			variations: [variation('R', [red])],
		});
		component.product = item;
		component.checkVariantAvailability(item);
		expect(component.selectedVariation?.sku).toBe('R');
	});

	it('copes with variations on a product with no axes', () => {
		const { component } = build();
		const item = product({ attributes: undefined });
		component.checkVariantAvailability(item);
		expect(component.selectedOptions).toEqual([]);
	});

	it('copes with an opening variation that has no values', () => {
		const { component } = build();
		const item = product({ sku: 'X', variations: [variation('X', undefined as never)], attributes: [] });
		component.product = item;
		expect(() => component.checkVariantAvailability(item)).not.toThrow();
	});
});

describe('variation images', () => {
	it('gives an image term the variant photo, keeping its own swatch', () => {
		const { component } = build();
		const photo = { id: 3 };
		const swatch = { id: 9 };
		const item = product({
			attributes: [
				{
					id: 1,
					style: 'image',
					attribute_values: [
						{ ...red },
						{ ...blue, variation_image: swatch },
						{ id: 13, value: 'Unused', attribute_id: 1 },
					],
				},
			],
			variations: [
				variation('R', [red], { variation_image: photo }),
				variation('B', [blue], { variation_image: photo }),
			],
		});
		component.product = item;
		component.checkVariantAvailability(item);
		const values = item.attributes?.[0]?.attribute_values ?? [];
		expect(values[0]?.variation_image).toBe(photo);
		expect(values[1]?.variation_image).toBe(swatch);
		expect(values[2]?.variation_image).toBeUndefined();
	});
});

describe('choosing a value', () => {
	it('swaps the value on its axis and tells the host', () => {
		const { component } = build();
		const item = product();
		component.product = item;
		const seen: unknown[] = [];
		component.selectVariation.subscribe((row) => seen.push(row));
		component.checkVariantAvailability(item);
		component.setVariant(item.variations ?? [], large as never);
		expect(component.selectedVariation?.sku).toBe('RL');
		expect(seen.length).toBeGreaterThan(1);
		expect(item.attributes?.[1]?.selected_value).toBe('L');
		expect(item.sku).toBe('RL');
	});

	it('marks sold-out values', () => {
		const { component } = build();
		const item = product({
			variations: [
				variation('RS', [red, small]),
				variation('RL', [red, large], { stock_status: 'out_of_stock' }),
				variation('BL', [blue, large], { stock_status: 'out_of_stock' }),
			],
		});
		component.product = item;
		component.setVariant(item.variations ?? [], red as never);
		expect(component.soldOutAttributesIds).toContain(22);
		component.setVariant(item.variations ?? [], large as never);
		expect(component.soldOutAttributesIds.length).toBeGreaterThan(0);
	});

	it('marks a fully chosen combination that really has none left', () => {
		const { component } = build();
		const item = product({
			variations: [
				variation('RS', [red, small]),
				variation('RL', [red, large], { stock_status: 'out_of_stock', quantity: 0 }),
			],
		});
		component.product = item;
		component.setVariant(item.variations ?? [], red as never);
		component.setVariant(item.variations ?? [], large as never);
		expect(component.soldOutAttributesIds).toEqual(expect.arrayContaining([11, 22]));
	});

	it('marks a sold-out single value that was not chosen', () => {
		const { component } = build();
		const item = product({
			attributes: [{ id: 1, style: 'color', attribute_values: [{ ...red }, { ...blue }] }],
			variations: [variation('R', [red]), variation('B', [blue], { stock_status: 'out_of_stock' })],
		});
		component.product = item;
		component.setVariant(item.variations ?? [], red as never);
		expect(component.soldOutAttributesIds).toEqual([12]);
	});

	it('moves the gallery to the variant photo', () => {
		const { component, fixture } = build();
		const to = vi.fn();
		fixture.componentRef.setInput('owlCar', { to });
		const item = product({
			variations: [variation('R', [red], { variation_image: { id: 3 } }), variation('B', [blue])],
		});
		component.product = item;
		component.setVariant(item.variations ?? [], red as never);
		expect(to).toHaveBeenCalledWith('3');
		to.mockClear();
		component.setVariant(item.variations ?? [], blue as never);
		expect(to).not.toHaveBeenCalled();
	});
});

describe('stock', () => {
	it('compares the quantity with what is wanted', () => {
		const { component } = build();
		const chosen = variation('R', [red], { quantity: 1 });
		component.selectedVariation = chosen;
		component.productQty = 2;
		component.checkStockAvailable();
		expect(chosen.stock_status).toBe('out_of_stock');
		component.productQty = 1;
		component.checkStockAvailable();
		expect(chosen.stock_status).toBe('in_stock');
		component.selectedVariation = null;
		component.product = product({ quantity: 0 });
		component.checkStockAvailable();
		expect(component.product.stock_status).toBe('out_of_stock');
		component.product = product({ quantity: 3 });
		component.checkStockAvailable();
		expect(component.product.stock_status).toBe('in_stock');
	});
});

describe('input changes', () => {
	it('applies new inputs on the next tick, ignoring empty ones', () => {
		vi.useFakeTimers();
		const { component } = build();
		const item = product();
		const attributes = item.attributes ?? [];
		component.ngOnChanges({
			product: { currentValue: item },
			attributes: { currentValue: attributes },
		} as never);
		vi.runAllTimers();
		expect(component.product).toBe(item);
		expect(component.attributes).toBe(attributes);
		component.ngOnChanges({ product: { currentValue: null }, attributes: { currentValue: null } } as never);
		vi.runAllTimers();
		expect(component.product).toBe(item);
		component.ngOnChanges({} as never);
		vi.runAllTimers();
		expect(component.selectedVariation?.sku).toBe('RS');
	});
});
