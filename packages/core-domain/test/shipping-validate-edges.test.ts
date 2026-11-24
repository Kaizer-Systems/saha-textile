import type { ShippingRuleSetBody } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { validateShippingRuleSet } from '../src/shipping/validate';

const result = (r: unknown, id = 'r') => ({ kind: 'result', id, result: r });
const amount = (value: number | null = 100) => ({ kind: 'amount', amount: value, per: 'once' });
const step = (node: unknown, scope = 'wholeCart', id = 's') => ({ id, scope, combine: 'sum', node });
const body = (steps: unknown[], adjust: unknown[] = []) => ({ steps, adjust }) as unknown as ShippingRuleSetBody;
const codes = (b: ShippingRuleSetBody, use: 'both' | 'domestic' | 'international' = 'both', languages?: string[]) =>
	validateShippingRuleSet(b, use, languages ? { languages } : {}).issues.map((issue) => issue.code);
const cond = (id: string, field: string | null, op: string | null, value: unknown) => ({
	kind: 'condition',
	id,
	field,
	op,
	value,
});
const ifNode = (items: unknown[]) => ({
	kind: 'if',
	id: 'i',
	when: { kind: 'group', id: 'g', join: 'all', items },
	then: result(amount(), 'rt'),
	otherwise: result(amount(), 'ro'),
});

describe('shipping rule set checks: steps and adjustments', () => {
	it('flags an empty step and a blank or zero adjustment', () => {
		expect(codes(body([step(null)]))).toContain('step_empty');
		expect(
			codes(
				body(
					[step(result(amount()))],
					[
						{ id: 'm', kind: 'minimum', amount: null },
						{ id: 'u', kind: 'roundUp', to: 0 },
						{ id: 'f', kind: 'freeAbove', subtotal: 500 },
					],
				),
			),
		).toEqual(expect.arrayContaining(['adjust_amount_missing', 'round_up_zero']));
	});

	it('asks for a can’t-ship message in every shop language, English by default', () => {
		const refuse = body([step(result({ kind: 'cantShip', message: { en: 'No' } }))]);
		expect(codes(refuse)).not.toContain('cant_ship_message_missing');
		expect(codes(refuse, 'both', ['en', 'bn'])).toContain('cant_ship_message_missing');
	});
});

describe('shipping rule set checks: bands', () => {
	const bands = (field: string | null, list: unknown[], otherwise: unknown = null, scope = 'wholeCart') =>
		body([step({ kind: 'bands', id: 'b', field, bands: list, otherwise }, scope)]);
	const band = (id: string, from: number | null, to: number | null) => ({
		id,
		from,
		to,
		then: result(amount(), `r${id}`),
	});

	it('needs a field, a loop for a line field, and at least one band', () => {
		expect(codes(bands(null, [band('1', null, null)]))).toContain('bands_field_missing');
		expect(codes(bands('line.mrp', [band('1', null, null)]))).toContain('line_fact_needs_loop');
		expect(codes(bands('line.mrp', [band('1', null, null)], null, 'eachLine'))).not.toContain(
			'line_fact_needs_loop',
		);
		expect(codes(bands('cart.subtotal', []))).toContain('bands_empty');
	});

	it('finds a backwards band, gaps, overlaps and uncovered ends', () => {
		expect(codes(bands('cart.subtotal', [band('1', 500, 100)], result(amount(), 'o')))).toContain('band_range');
		expect(codes(bands('cart.subtotal', [band('1', null, 100), band('2', 200, null)]))).toContain('bands_gap');
		expect(codes(bands('cart.subtotal', [band('1', null, 300), band('2', 200, null)]))).toContain('bands_overlap');
		const open = validateShippingRuleSet(bands('cart.subtotal', [band('1', 100, 500)])).issues.find(
			(issue) => issue.code === 'bands_uncovered',
		);
		expect(open?.params).toEqual({ below: 100, above: 500 });
		const onlyHigh = validateShippingRuleSet(bands('cart.subtotal', [band('1', null, 500)])).issues.find(
			(issue) => issue.code === 'bands_uncovered',
		);
		expect(onlyHigh?.params).toEqual({ below: -1, above: 500 });
		expect(codes(bands('cart.subtotal', [band('1', 0, null)]))).not.toContain('bands_uncovered');
		expect(codes(bands('cart.subtotal', [band('1', 100, null)], result(amount(), 'o')))).not.toContain(
			'bands_uncovered',
		);
	});
});

describe('shipping rule set checks: conditions', () => {
	it('flags an empty group, nested ones too', () => {
		const nested = ifNode([{ kind: 'group', id: 'g2', join: 'any', items: [] }]);
		const issues = validateShippingRuleSet(body([step(nested)])).issues.filter((i) => i.code === 'group_empty');
		expect(issues.map((i) => i.params)).toEqual([{ top: 0 }]);
		expect(codes(body([step(ifNode([]))]))).toContain('group_empty');
	});

	it('flags unfinished, line-only, wrong-operator, wrong-value and impossible conditions', () => {
		const one = (c: unknown, scope = 'wholeCart') => codes(body([step(ifNode([c]), scope)]));
		expect(one(cond('c', null, 'is', 1))).toContain('condition_incomplete');
		expect(one(cond('c', 'line.quantity', 'is', 2))).toContain('line_fact_needs_loop');
		expect(one(cond('c', 'delivery.country', 'moreThan', 2))).toContain('condition_operator');
		expect(one(cond('c', 'cart.units', 'is', 'two'))).toContain('condition_value');
		expect(one(cond('c', 'cart.units', 'is', 2))).toEqual([]);
	});

	it('knows which conditions can never hold', () => {
		const impossible = (field: string, op: string, value: unknown, scope = 'eachLine') =>
			codes(body([step(ifNode([cond('c', field, op, value)]), scope)])).includes('condition_impossible');
		expect(impossible('cart.subtotal', 'between', [500, 100])).toBe(true);
		expect(impossible('line.discountPercent', 'between', [150, 200])).toBe(true);
		expect(impossible('cart.subtotal', 'between', [-50, -1])).toBe(true);
		expect(impossible('delivery.pincode', 'between', [-50, -1])).toBe(false);
		expect(impossible('cart.subtotal', 'between', [1, 2])).toBe(false);
		expect(impossible('line.discountPercent', 'moreThan', 100)).toBe(true);
		expect(impossible('line.discountPercent', 'atLeast', 101)).toBe(true);
		expect(impossible('line.discountPercent', 'is', 101)).toBe(true);
		expect(impossible('line.discountPercent', 'lessThan', 0)).toBe(true);
		expect(impossible('line.discountPercent', 'atMost', -1)).toBe(true);
		expect(impossible('line.discountPercent', 'atMost', 50)).toBe(false);
		expect(impossible('cart.subtotal', 'lessThan', 0)).toBe(true);
		expect(impossible('cart.subtotal', 'atMost', -1)).toBe(true);
		expect(impossible('cart.subtotal', 'is', -1)).toBe(true);
		expect(impossible('cart.units', 'lessThan', 1)).toBe(true);
		expect(impossible('line.quantity', 'lessThan', 1)).toBe(true);
		expect(impossible('cart.lines', 'lessThan', 1)).toBe(true);
		expect(impossible('cart.subtotal', 'lessThan', 1)).toBe(false);
		expect(impossible('cart.units', 'lessThan', 5)).toBe(false);
		expect(impossible('line.product', 'is', 'p-1')).toBe(false);
	});
});

describe('shipping rule set checks: results', () => {
	const one = (r: unknown, scope = 'wholeCart', use: 'both' | 'domestic' | 'international' = 'both') =>
		codes(body([step(result(r), scope)]), use);

	it('needs an amount or a percent, and a loop for a percent of the line', () => {
		expect(one(amount(null))).toContain('amount_missing');
		expect(one({ kind: 'percent', percent: null, of: 'cart' })).toContain('percent_missing');
		expect(one({ kind: 'percent', percent: 5, of: 'line' })).toContain('percent_of_line_needs_loop');
		expect(one({ kind: 'percent', percent: 5, of: 'line' }, 'eachLine')).toEqual([]);
	});

	it('warns when a product charge belongs to the other zone', () => {
		expect(
			one({ kind: 'productCharge', charge: 'internationalFirst', per: 'once' }, 'eachLine', 'domestic'),
		).toContain('charge_zone_mismatch');
		expect(one({ kind: 'productCharge', charge: 'domestic', per: 'once' }, 'eachLine', 'domestic')).toEqual([]);
	});

	it('checks first-and-further prices: not per unit, amounts filled, charges of the right zone', () => {
		const ff = {
			kind: 'firstAndFurther',
			first: { from: 'fixed', amount: null },
			further: { from: 'product', charge: 'domestic' },
			count: 'perCart',
		};
		expect(one(ff, 'eachUnit', 'international')).toEqual(
			expect.arrayContaining(['first_further_needs_line_or_cart', 'amount_missing', 'charge_zone_mismatch']),
		);
		expect(one({ ...ff, first: { from: 'fixed', amount: 100 } }, 'wholeCart', 'domestic')).toEqual([]);
	});

	it('warns that a courier quote needs a courier, and accepts free and can’t-ship results', () => {
		expect(one({ kind: 'courierQuote' })).toContain('courier_needed');
		expect(one({ kind: 'free' })).toEqual([]);
	});
});
