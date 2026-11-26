import type { ShippingCartSnapshot, ShippingRuleSetBody, ShippingSnapshotLine } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { evaluateShippingRuleSet } from '../src/shipping/engine';

const CHARGES = { domestic: 100, internationalFirst: 2000, internationalFurther: 900 };
const line = (id: string, over: Partial<ShippingSnapshotLine> = {}): ShippingSnapshotLine => ({
	lineId: id,
	productId: `p-${id}`,
	categoryIds: [],
	mainCategoryId: null,
	mainCategoryAncestorIds: [],
	freeShipping: false,
	units: 1,
	sellingPriceINR: 1000,
	mrpINR: 1000,
	onSaleEvent: false,
	soldBy: 'piece',
	madeToOrder: false,
	chargeableWeightGrams: 500,
	charges: CHARGES,
	...over,
});
const cart = (lines: ShippingSnapshotLine[]): ShippingCartSnapshot => ({
	lines,
	delivery: { country: 'IN', state: null, pincode: '700045' },
	shopper: { signedIn: true, groups: [], firstOrder: false },
});
const node = (result: unknown, id = 'r') => ({ kind: 'result', id, result });
const step = (scope: string, n: unknown, combine = 'sum', id = 's') => ({ id, scope, combine, node: n });
const body = (steps: unknown[], adjust: unknown[] = []) => ({ steps, adjust }) as unknown as ShippingRuleSetBody;
const run = (b: ShippingRuleSetBody, lines: ShippingSnapshotLine[], lineIds?: string[]) =>
	evaluateShippingRuleSet({ body: b, snapshot: cart(lines), zone: 'domestic', ...(lineIds ? { lineIds } : {}) });
const priced = (outcome: ReturnType<typeof run>): number => {
	if (outcome.status !== 'priced') throw new Error(`expected priced, got ${outcome.status}`);
	return outcome.amountINR;
};
const amount = (value: number | null, per: 'once' | 'unit' | 'kg' = 'once') => ({ kind: 'amount', amount: value, per });

describe('the shipping engine: nodes', () => {
	it('falls to “otherwise” for a band with no field, a non-number fact, or no matching band', () => {
		const bands = (field: string | null) => ({
			kind: 'bands',
			id: 'b',
			field,
			bands: [{ id: 'b1', from: 5000, to: null, then: node(amount(10), 'r1') }],
			otherwise: node(amount(99), 'r2'),
		});
		expect(priced(run(body([step('wholeCart', bands(null))]), [line('a')]))).toBe(99);
		expect(priced(run(body([step('wholeCart', bands('delivery.country'))]), [line('a')]))).toBe(99);
		expect(priced(run(body([step('wholeCart', bands('cart.subtotal'))]), [line('a')]))).toBe(99);
		expect(priced(run(body([step('wholeCart', bands('cart.subtotal'))]), [line('a', { units: 6 })]))).toBe(10);
	});

	it('reports an empty block as no result, and an empty rule-set line list prices nothing', () => {
		expect(run(body([step('eachLine', null)]), [line('a')])).toMatchObject({ status: 'noResult' });
		expect(priced(run(body([step('wholeCart', node(amount(50)))]), [line('a')], []))).toBe(0);
	});
});

describe('the shipping engine: results', () => {
	it('prices per unit and per started kilogram, a weightless parcel at no kilograms', () => {
		expect(priced(run(body([step('wholeCart', node(amount(40, 'unit')))]), [line('a', { units: 3 })]))).toBe(120);
		expect(
			priced(
				run(body([step('wholeCart', node(amount(60, 'kg')))]), [line('a', { chargeableWeightGrams: 1200 })]),
			),
		).toBe(120);
		expect(
			priced(
				run(body([step('wholeCart', node(amount(60, 'kg')))]), [line('a', { chargeableWeightGrams: null })]),
			),
		).toBe(0);
		expect(
			priced(run(body([step('eachLine', node(amount(60, 'kg')))]), [line('a', { chargeableWeightGrams: null })])),
		).toBe(0);
		expect(
			priced(run(body([step('eachUnit', node(amount(60, 'kg')))]), [line('a', { chargeableWeightGrams: null })])),
		).toBe(0);
	});

	it('leaves a blank amount or percent as no result', () => {
		expect(run(body([step('wholeCart', node(amount(null)))]), [line('a')])).toMatchObject({ status: 'noResult' });
		expect(
			run(body([step('wholeCart', node({ kind: 'percent', percent: null, of: 'line' }))]), [line('a')]),
		).toMatchObject({
			status: 'noResult',
		});
	});

	it('takes a percent of the line, of the whole cart’s goods, or of the cart subtotal from a line step', () => {
		const lines = [line('a'), line('b', { sellingPriceINR: 3000 })];
		const pct = (of: string, scope: string) =>
			run(body([step(scope, node({ kind: 'percent', percent: 10, of }))]), lines, ['a']);
		expect(priced(pct('line', 'eachLine'))).toBe(100);
		expect(priced(pct('cart', 'wholeCart'))).toBe(100);
		expect(priced(pct('cart', 'eachLine'))).toBe(400);
	});

	it('charges a product’s own charge once or per unit on a line step', () => {
		const charge = (per: string) => node({ kind: 'productCharge', charge: 'domestic', per });
		expect(priced(run(body([step('eachLine', charge('once'))]), [line('a', { units: 3 })]))).toBe(100);
		expect(priced(run(body([step('eachLine', charge('unit'))]), [line('a', { units: 3 })]))).toBe(300);
	});

	it('prices first and further units per product, from fixed amounts or the product charge, and blanks a missing amount', () => {
		const ff = (count: string, first: unknown = { from: 'fixed', amount: 200 }) =>
			node({ kind: 'firstAndFurther', first, further: { from: 'charge', charge: 'domestic' }, count });
		const lines = [line('a', { units: 2 }), line('b', { units: 3 })];
		expect(priced(run(body([step('wholeCart', ff('perProduct'))]), lines))).toBe(200 + 100 + 200 + 200);
		expect(priced(run(body([step('eachLine', ff('perCart'))]), lines))).toBe(200 + 100 + 200 + 200);
		expect(run(body([step('wholeCart', ff('perCart', { from: 'fixed', amount: null }))]), lines)).toMatchObject({
			status: 'noResult',
		});
		expect(priced(run(body([step('eachLine', ff('perProduct'))]), [line('a', { units: 0 })]))).toBe(0);
	});
});

describe('the shipping engine: combining and adjusting', () => {
	it('keeps the lowest of a step’s line prices when asked', () => {
		const lines = [line('a', { charges: { ...CHARGES, domestic: 300 } }), line('b')];
		const charge = node({ kind: 'productCharge', charge: 'domestic', per: 'once' });
		expect(priced(run(body([step('eachLine', charge, 'lowest')]), lines))).toBe(100);
	});

	it('names each line it can’t ship once, however many units refused', () => {
		const out = run(body([step('eachUnit', node({ kind: 'cantShip', message: { en: 'No' } }))]), [
			line('a', { units: 3 }),
		]);
		expect(out).toMatchObject({ status: 'cantShip', lines: [{ lineId: 'a' }] });
		expect(out.status === 'cantShip' && out.lines).toHaveLength(1);
	});

	it('stops at a blank minimum, maximum, round-up or free-above, and skips a round-up to nothing', () => {
		const base = [step('wholeCart', node(amount(130)))];
		for (const adjust of [
			{ id: 'm', kind: 'minimum', amount: null },
			{ id: 'x', kind: 'maximum', amount: null },
			{ id: 'u', kind: 'roundUp', to: null },
			{ id: 'f', kind: 'freeAbove', subtotal: null },
		]) {
			expect(run(body(base, [adjust]), [line('a')])).toMatchObject({
				status: 'noResult',
				where: [{ stepId: 'adjust', lineIds: ['a'], blockId: adjust.id }],
			});
		}
		expect(priced(run(body(base, [{ id: 'u', kind: 'roundUp', to: 0 }]), [line('a')]))).toBe(130);
	});
});
