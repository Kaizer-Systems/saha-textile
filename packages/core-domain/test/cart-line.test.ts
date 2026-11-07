import { describe, expect, it } from 'vitest';

import type { CatalogProductPage } from '@saha-textile/contracts';

import { priceCartLine } from '../src/catalog/cart-line';

const term = (code: string, over: Record<string, unknown> = {}) => ({
	code,
	label: code.toUpperCase(),
	isBase: false,
	hex: null,
	image: null,
	priceDeltaINR: null,
	requiresMeasurements: false,
	...over,
});

const group = (code: string, role: string, terms: unknown[], over: Record<string, unknown> = {}) => ({
	code,
	label: code,
	role,
	displayStyle: 'rectangle',
	required: false,
	defaultTermCode: null,
	terms,
	...over,
});

const variant = (id: string, over: Record<string, unknown> = {}) => ({
	id,
	sku: `SKU-${id}`,
	selections: { color: 'red', size: 'm' },
	sellingINR: 1000,
	mrpINR: 1500,
	quantity: 4,
	buyable: true,
	galleryIndex: 2,
	...over,
});

const page = (over: Record<string, unknown> = {}) =>
	({
		slug: 'silk',
		madeToOrder: false,
		selected: { sku: 'BASE', sellingINR: 800, mrpINR: null, quantity: 3, buyable: true },
		optionGroups: [],
		variants: [],
		measurements: null,
		bundle: null,
		...over,
	}) as unknown as CatalogProductPage;

const line = (result: ReturnType<typeof priceCartLine>) => {
	if (!result.ok) throw new Error(result.reason);
	return result.line;
};

describe('priceCartLine', () => {
	it('prices a plain product from its own row', () => {
		expect(line(priceCartLine(page(), { variationId: null, addons: [] }))).toMatchObject({
			sku: 'BASE',
			variationId: null,
			unitPriceINR: 800,
			available: 3,
			buyable: true,
		});
		const made = priceCartLine(page({ madeToOrder: true }), { variationId: null, addons: [] });
		expect(line(made).available).toBeNull();
	});

	it('refuses a product with nothing to sell', () => {
		expect(priceCartLine(page({ selected: null }), { variationId: null, addons: [] })).toEqual({
			ok: false,
			reason: 'unknown_variant',
		});
	});

	it('prices the chosen variant and names it in axis order', () => {
		const axes = [
			group('color', 'variation_axis', [term('red')]),
			group('size', 'variation_axis', [term('m')]),
			group('fabric', 'filter_only', [term('silk')]),
			group('gone', 'variation_axis', [term('x')]),
		];
		const product = page({ optionGroups: axes, variants: [variant('v1')] });
		expect(line(priceCartLine(product, { variationId: 'v1', addons: [] }))).toMatchObject({
			sku: 'SKU-v1',
			variationId: 'v1',
			variantLabel: 'RED / M',
			galleryIndex: 2,
			mrpINR: 1500,
			available: 4,
		});
		expect(priceCartLine(product, { variationId: 'nope', addons: [] })).toEqual({
			ok: false,
			reason: 'unknown_variant',
		});
		expect(priceCartLine(product, { variationId: null, addons: [] }).ok).toBe(false);
		const made = page({ optionGroups: axes, variants: [variant('v1')], madeToOrder: true });
		expect(line(priceCartLine(made, { variationId: 'v1', addons: [] })).available).toBeNull();
	});

	it('adds option prices, using the default, then the first choice', () => {
		const product = page({
			optionGroups: [
				group('blouse', 'named_add_on', [term('plain'), term('design', { priceDeltaINR: 250 })], {
					defaultTermCode: 'design',
				}),
				group('fall', 'named_add_on', [term('none'), term('yes', { priceDeltaINR: 90 })]),
				group('kit', 'bundle_component_option', [term('a', { priceDeltaINR: 10 })]),
			],
		});
		const fallback = line(priceCartLine(product, { variationId: null, addons: [] }));
		expect(fallback.unitPriceINR).toBe(1060);
		expect(fallback.basePriceINR).toBe(800);
		expect(fallback.options.map((option) => option.termCode)).toEqual(['design', 'none', 'a']);
		const chosen = priceCartLine(product, {
			variationId: null,
			addons: [
				{ code: 'blouse', value: 'plain' },
				{ code: 'fall', value: 'yes' },
			],
		});
		expect(line(chosen).unitPriceINR).toBe(900);
		expect(line(chosen).options[2]).toMatchObject({ role: 'bundle_component_option', group: 'kit', value: 'A' });
	});

	it('refuses a choice the product does not offer', () => {
		const product = page({ optionGroups: [group('blouse', 'named_add_on', [term('plain')])] });
		const refused = { ok: false, reason: 'unknown_option' };
		expect(priceCartLine(product, { variationId: null, addons: [{ code: 'other', value: 'x' }] })).toEqual(refused);
		expect(priceCartLine(product, { variationId: null, addons: [{ code: 'blouse', value: 'x' }] })).toEqual(refused);
		const bare = page({ optionGroups: [group('blouse', 'named_add_on', [])] });
		expect(priceCartLine(bare, { variationId: null, addons: [] })).toEqual(refused);
	});

	describe('measurements', () => {
		const field = (code: string, over: Record<string, unknown> = {}) => ({
			code,
			label: code,
			unit: 'in',
			min: 20,
			max: 50,
			step: 0.5,
			...over,
		});
		const product = page({
			optionGroups: [
				group('stitch', 'named_add_on', [
					term('none'),
					term('tailored', { priceDeltaINR: 500, requiresMeasurements: true }),
				]),
			],
			measurements: { templateCode: 't', priceINR: 0, fields: [field('bust'), field('waist', { min: null, max: null })] },
		});
		const stitched = (bust: unknown, waist: unknown = 30) => ({
			variationId: null,
			addons: [
				{ code: 'stitch', value: 'tailored' },
				...(bust === undefined ? [] : [{ code: 'bust', value: bust as number }]),
				{ code: 'waist', value: waist as number },
			],
		});

		it('are needed only for a choice that asks for them', () => {
			const plain = line(priceCartLine(product, { variationId: null, addons: [] }));
			expect(plain.measurements).toEqual([]);
			const fitted = line(priceCartLine(product, stitched(34)));
			expect(fitted.unitPriceINR).toBe(1300);
			expect(fitted.measurements).toEqual([
				{ code: 'bust', label: 'bust', value: 34, unit: 'in' },
				{ code: 'waist', label: 'waist', value: 30, unit: 'in' },
			]);
		});

		it('refuses missing or out of range values', () => {
			expect(priceCartLine(product, stitched(undefined))).toEqual({ ok: false, reason: 'measurements_required' });
			expect(priceCartLine(product, stitched('34'))).toEqual({ ok: false, reason: 'measurements_required' });
			const range = { ok: false, reason: 'measurement_out_of_range' };
			expect(priceCartLine(product, stitched(19))).toEqual(range);
			expect(priceCartLine(product, stitched(51))).toEqual(range);
		});
	});

	it('prices a bundle from its kit price, sold out when a required piece is', () => {
		const piece = (over: Record<string, unknown> = {}) => ({
			title: 'Piece',
			sku: 'P1',
			sellingINR: 400,
			required: true,
			inStock: true,
			...over,
		});
		const bundle = (components: unknown[]) => ({ priceINR: 700, groups: [{ components }] });
		const kit = line(
			priceCartLine(page({ bundle: bundle([piece(), piece({ required: false, inStock: false })]) }), {
				variationId: null,
				addons: [],
			}),
		);
		expect(kit).toMatchObject({ sku: 'BASE', unitPriceINR: 700, available: null, buyable: true });
		expect(kit.components[0]).toEqual({ title: 'Piece', sku: 'P1', priceINR: 400 });
		const short = priceCartLine(page({ bundle: bundle([piece({ inStock: false })]), selected: null }), {
			variationId: null,
			addons: [],
		});
		expect(line(short)).toMatchObject({ sku: 'silk', buyable: false });
	});
});
