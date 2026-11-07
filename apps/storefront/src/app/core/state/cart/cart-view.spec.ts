import { describe, expect, it } from 'vitest';

import { ApiCartLine, cartItem, lineChoice } from './cart-view';

const line = (over: Partial<ApiCartLine> = {}): ApiCartLine => ({
	id: 'line_1',
	productId: 'p1',
	slug: 'silk',
	title: 'Silk',
	image: null,
	sku: 'S1',
	variationId: null,
	variantLabel: null,
	quantity: 2,
	available: 5,
	basePriceINR: 1000,
	unitPriceINR: 1000,
	mrpINR: null,
	lineTotalINR: 2000,
	options: [],
	measurements: [],
	components: [],
	problem: null,
	...over,
});

describe('cartItem', () => {
	it('maps a plain line, with nothing to configure', () => {
		const item = cartItem(line());
		expect(item).toMatchObject({ id: 'line_1', quantity: 2, unit_price: 1000, sub_total: 2000, variation: null });
		expect(item.product).toMatchObject({ slug: 'silk', name: 'Silk', price: 1000, sale_price: 1000, discount: 0 });
		expect(item.product.product_thumbnail).toBeUndefined();
		expect(item.line_config).toBeUndefined();
	});

	it('shows a saving, and a photo', () => {
		const image = { roles: { gallery: [{ url: 'u', width: 900 }] } } as never;
		const item = cartItem(line({ mrpINR: 1500, image }));
		expect(item.product).toMatchObject({ price: 1500, discount: 33 });
		expect(item.product.product_thumbnail?.original_url).toBe('u');
	});

	it('carries a variant, falling back when it has no label or limit', () => {
		const item = cartItem(line({ variationId: 'v1', variantLabel: 'Red', mrpINR: 900 }));
		expect(item.product.discount).toBe(0);
		expect(item.variation).toMatchObject({ id: 'v1', name: 'Red', selected_variation: 'Red', quantity: 5 });
		expect(item.line_config?.variation_label).toBe('Red');
		const made = cartItem(line({ variationId: 'v1', available: null }));
		expect(made.variation).toMatchObject({ name: '', selected_variation: '', quantity: 2 });
		expect(made.variation_id).toBe('v1');
		expect(made.line_config).toBeUndefined();
	});

	it('splits options, and keeps the raw choice for editing', () => {
		const option = (code: string, role: 'named_add_on' | 'bundle_component_option') => ({
			code,
			termCode: `${code}_term`,
			group: code,
			value: 'V',
			role,
			priceDeltaINR: 50,
		});
		const config = cartItem(
			line({
				unitPriceINR: 1100,
				options: [option('fall', 'named_add_on'), option('kit', 'bundle_component_option')],
				measurements: [{ code: 'bust', label: 'Bust', value: 34, unit: 'in' }],
				components: [{ title: 'Blouse', sku: 'B', priceINR: 300 }],
			}),
		).line_config;
		expect(config).toMatchObject({
			addon_options: [{ group: 'fall', value: 'V', price_delta: 50 }],
			bundle_options: [{ group: 'kit' }],
			bundle_components: [{ name: 'Blouse', sku: 'B', price: 300 }],
			measurements: [{ label: 'Bust', value: 34, unit: 'in' }],
			base_price: 1000,
			delta_total: 100,
			raw: {
				variation_id: null,
				addon_selections: { fall: 'fall_term' },
				bundle_selections: { kit: 'kit_term' },
				measurements: { bust: 34 },
			},
		});
	});

	it('shows a config for measurements or components alone', () => {
		const measured = line({ measurements: [{ code: 'b', label: 'B', value: 1, unit: 'in' }] });
		expect(cartItem(measured).line_config).toBeDefined();
		expect(cartItem(line({ components: [{ title: 'T', sku: 'S', priceINR: 1 }] })).line_config).toBeDefined();
	});
});

describe('lineChoice', () => {
	it('sends nothing for a plain product', () => {
		expect(lineChoice({ variation_id: null } as never)).toEqual({ variationId: null, addons: [] });
		expect(lineChoice({ variation_id: undefined, line_config: {} } as never)).toEqual({
			variationId: null,
			addons: [],
		});
	});

	it('flattens every selection, and sends no price', () => {
		const choice = lineChoice({
			variation_id: 12,
			unit_price: 1,
			line_config: {
				raw: {
					addon_selections: { fall: 'yes' },
					bundle_selections: { kit: 'a' },
					measurements: { bust: 34 },
				},
			},
		} as never);
		expect(choice).toEqual({
			variationId: '12',
			addons: [
				{ code: 'fall', value: 'yes' },
				{ code: 'kit', value: 'a' },
				{ code: 'bust', value: 34 },
			],
		});
	});
});
