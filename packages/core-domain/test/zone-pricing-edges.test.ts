import type { ZoneCondition, ZoneConditionGroup, ZonePriceFormula, ZoneRule } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import {
	evaluateZoneFormula,
	zoneConditionHolds,
	zoneFormulaCanPriceAddOns,
	zoneGroupHolds,
	zoneRuleProblems,
	zoneRulesReadCost,
	type ZoneLineFacts,
} from '../src/orders/zone-pricing';

const facts = (over: Partial<ZoneLineFacts> = {}): ZoneLineFacts => ({
	productId: 'prd_1',
	sku: 'S1',
	categoryPaths: [['cat_silk_kanjivaram', 'cat_silk']],
	regularSellingINR: 10_000,
	currentSaleINR: 8_000,
	mrpINR: 12_000,
	purchaseCostINR: 6_000,
	quantity: 3,
	metres: 2.5,
	orderGoodsINR: 25_000,
	...over,
});
const cond = (field: ZoneCondition['field'], op: ZoneCondition['op'], value: unknown = null): ZoneCondition =>
	({ kind: 'condition', field, op, value }) as ZoneCondition;
const group = (join: 'all' | 'any', items: ZoneConditionGroup['items']): ZoneConditionGroup =>
	({ kind: 'group', join, items }) as ZoneConditionGroup;
const rule = (over: Partial<ZoneRule>): ZoneRule =>
	({
		id: 'r1',
		name: 'r1',
		enabled: true,
		scope: { tier: 'allProducts' },
		when: null,
		price: { kind: 'noPrice' },
		rounding: 'none',
		floorINR: null,
		ceilingINR: null,
		minQuantityPerLine: null,
		validFrom: null,
		validUntil: null,
		addOns: false,
		...over,
	}) as ZoneRule;
const flat = (amountINR: number): ZonePriceFormula =>
	({ kind: 'flatPrice', amountINR, skuPrices: {} }) as ZonePriceFormula;

describe('zone conditions', () => {
	const f = facts();

	it('reads every field', () => {
		expect(zoneConditionHolds(cond('line.regularSellingINR', 'is', 10_000), f)).toBe(true);
		expect(zoneConditionHolds(cond('line.currentSaleINR', 'is', 8_000), f)).toBe(true);
		expect(zoneConditionHolds(cond('line.mrpINR', 'is', 12_000), f)).toBe(true);
		expect(zoneConditionHolds(cond('line.purchaseCostINR', 'is', 6_000), f)).toBe(true);
		expect(zoneConditionHolds(cond('line.quantity', 'is', 3), f)).toBe(true);
		expect(zoneConditionHolds(cond('line.metres', 'is', 2.5), f)).toBe(true);
		expect(zoneConditionHolds(cond('line.productId', 'is', 'prd_1'), f)).toBe(true);
		expect(zoneConditionHolds(cond('order.goodsINR', 'is', 25_000), f)).toBe(true);
		expect(zoneConditionHolds(cond('line.categoryIds', 'is', 'cat_silk'), f)).toBe(true);
	});

	it('tests emptiness on single values and lists', () => {
		expect(zoneConditionHolds(cond('line.purchaseCostINR', 'isEmpty'), facts({ purchaseCostINR: null }))).toBe(
			true,
		);
		expect(zoneConditionHolds(cond('line.categoryIds', 'isEmpty'), facts({ categoryPaths: [] }))).toBe(true);
		expect(zoneConditionHolds(cond('line.metres', 'isEmpty'), f)).toBe(false);
		expect(zoneConditionHolds(cond('line.metres', 'isNotEmpty'), f)).toBe(true);
		expect(zoneConditionHolds(cond('line.categoryIds', 'isNotEmpty'), facts({ categoryPaths: [] }))).toBe(false);
		expect(zoneConditionHolds(cond('line.purchaseCostINR', 'isNotEmpty'), facts({ purchaseCostINR: null }))).toBe(
			false,
		);
	});

	it('compares with is, is not and is one of, on values and lists', () => {
		expect(zoneConditionHolds(cond('line.categoryIds', 'is', 5), f)).toBe(false);
		expect(zoneConditionHolds(cond('line.categoryIds', 'isNot', 'cat_silk'), f)).toBe(false);
		expect(zoneConditionHolds(cond('line.categoryIds', 'isNot', 7), f)).toBe(true);
		expect(zoneConditionHolds(cond('line.productId', 'isNot', 'prd_2'), f)).toBe(true);
		expect(zoneConditionHolds(cond('line.categoryIds', 'isOneOf', ['cat_cotton', 'cat_silk']), f)).toBe(true);
		expect(zoneConditionHolds(cond('line.productId', 'isOneOf', ['prd_1']), f)).toBe(true);
		expect(zoneConditionHolds(cond('line.productId', 'isOneOf', 'prd_1'), f)).toBe(false);
	});

	it('checks ranges and the four comparisons, and refuses them on non-numbers', () => {
		expect(zoneConditionHolds(cond('line.quantity', 'between', [2, 4]), f)).toBe(true);
		expect(zoneConditionHolds(cond('line.quantity', 'between', [4, 9]), f)).toBe(false);
		expect(zoneConditionHolds(cond('line.quantity', 'between', [1, 2]), f)).toBe(false);
		expect(zoneConditionHolds(cond('line.quantity', 'between', [1]), f)).toBe(false);
		expect(zoneConditionHolds(cond('line.quantity', 'between', 3), f)).toBe(false);
		expect(zoneConditionHolds(cond('line.productId', 'between', [1, 2]), f)).toBe(false);
		expect(zoneConditionHolds(cond('line.quantity', 'moreThan', 2), f)).toBe(true);
		expect(zoneConditionHolds(cond('line.quantity', 'atLeast', 3), f)).toBe(true);
		expect(zoneConditionHolds(cond('line.quantity', 'lessThan', 3), f)).toBe(false);
		expect(zoneConditionHolds(cond('line.quantity', 'atMost', 3), f)).toBe(true);
		expect(zoneConditionHolds(cond('line.productId', 'moreThan', 1), f)).toBe(false);
		expect(zoneConditionHolds(cond('line.quantity', 'moreThan', '1'), f)).toBe(false);
	});

	it('joins groups with all or any, nested, and lets an empty group pass', () => {
		const yes = cond('line.quantity', 'atLeast', 1);
		const no = cond('line.quantity', 'atLeast', 9);
		expect(zoneGroupHolds(group('all', []), f)).toBe(true);
		expect(zoneGroupHolds(group('any', [no, group('all', [yes])]), f)).toBe(true);
		expect(zoneGroupHolds(group('any', [no]), f)).toBe(false);
	});
});

describe('zone formulas', () => {
	it('falls back to the regular price when there is no sale price or MRP', () => {
		const sale = { kind: 'percentOffBase', base: 'currentSaleOrRegular', percent: 10 } as ZonePriceFormula;
		const mrp = { kind: 'amountOffBase', base: 'mrp', amountINR: 100 } as ZonePriceFormula;
		expect(evaluateZoneFormula(sale, facts({ currentSaleINR: null }))).toMatchObject({ amount: 9_000 });
		expect(evaluateZoneFormula(mrp, facts({ mrpINR: null }))).toMatchObject({ amount: 9_900 });
	});

	it('takes the order-value step reached, or skips below the first', () => {
		const steps = {
			kind: 'orderValueBreaks',
			breaks: [
				{ minGoodsINR: 10_000, formula: flat(900) },
				{ minGoodsINR: 20_000, formula: flat(800) },
			],
		} as ZonePriceFormula;
		expect(evaluateZoneFormula(steps, facts())).toMatchObject({ amount: 800 });
		expect(evaluateZoneFormula(steps, facts({ orderGoodsINR: 100 }))).toEqual({ kind: 'skip' });
		const quantity = {
			kind: 'quantityBreaks',
			breaks: [{ minQuantity: 5, formula: flat(700) }],
		} as ZonePriceFormula;
		expect(evaluateZoneFormula(quantity, facts())).toEqual({ kind: 'skip' });
	});

	it('passes on why none of a lower-of or higher-of priced, and says no price when it holds nothing', () => {
		const cost = { kind: 'percentAboveCost', percent: 20 } as ZonePriceFormula;
		const lower = { kind: 'lowerOf', formulas: [cost] } as ZonePriceFormula;
		expect(evaluateZoneFormula(lower, facts({ purchaseCostINR: null }))).toEqual({ kind: 'costUnknown' });
		expect(evaluateZoneFormula({ kind: 'higherOf', formulas: [] } as ZonePriceFormula, facts())).toEqual({
			kind: 'noPrice',
		});
		const higher = { kind: 'higherOf', formulas: [flat(500), flat(700)] } as ZonePriceFormula;
		expect(evaluateZoneFormula(higher, facts())).toMatchObject({ amount: 700 });
	});

	it('lets add-ons follow a lower-of or higher-of only when one of its formulas is a discount', () => {
		expect(zoneFormulaCanPriceAddOns({ kind: 'lowerOf', formulas: [flat(1)] } as ZonePriceFormula)).toBe(false);
		expect(
			zoneFormulaCanPriceAddOns({
				kind: 'higherOf',
				formulas: [flat(1), { kind: 'percentOffBase', base: 'mrp', percent: 5 }],
			} as ZonePriceFormula),
		).toBe(true);
	});
});

describe('zone rule checks', () => {
	it('finds missing values and impossible ranges in nested groups, and breaks out of order', () => {
		const when = group('all', [
			group('any', [cond('line.quantity', 'is', '')]),
			cond('line.quantity', 'between', [5, 2]),
		]);
		const repeated = (kind: 'quantityBreaks' | 'orderValueBreaks', key: 'minQuantity' | 'minGoodsINR') =>
			({
				kind,
				breaks: [
					{ [key]: 2, formula: flat(1) },
					{ [key]: 2, formula: flat(2) },
				],
			}) as ZonePriceFormula;
		const problems = zoneRuleProblems([
			rule({ id: 'a', when, price: repeated('orderValueBreaks', 'minGoodsINR') }),
			rule({
				id: 'b',
				price: { kind: 'lowerOf', formulas: [repeated('quantityBreaks', 'minQuantity')] } as ZonePriceFormula,
			}),
			rule({
				id: 'c',
				price: { kind: 'higherOf', formulas: [flat(1)] } as ZonePriceFormula,
				when: group('all', [cond('line.quantity', 'between', [1, 2])]),
			}),
		]);
		expect(problems).toEqual([
			{ ruleId: 'a', problem: 'value_missing' },
			{ ruleId: 'a', problem: 'impossible_condition' },
			{ ruleId: 'a', problem: 'breaks_out_of_order' },
			{ ruleId: 'b', problem: 'breaks_out_of_order' },
		]);
	});

	it('accepts steps in good order, nested ones too', () => {
		const ordered = {
			kind: 'orderValueBreaks',
			breaks: [
				{
					minGoodsINR: 1,
					formula: {
						kind: 'quantityBreaks',
						breaks: [
							{ minQuantity: 1, formula: flat(1) },
							{ minQuantity: 2, formula: flat(2) },
						],
					},
				},
				{ minGoodsINR: 2, formula: flat(3) },
			],
		} as ZonePriceFormula;
		expect(zoneRuleProblems([rule({ price: ordered })])).toEqual([]);
	});

	it('knows when a rule reads the purchase cost: in a step, a lower-of, or a nested condition', () => {
		const steps = (formula: ZonePriceFormula) =>
			({ kind: 'orderValueBreaks', breaks: [{ minGoodsINR: 1, formula }] }) as ZonePriceFormula;
		expect(
			zoneRulesReadCost([rule({ price: steps({ kind: 'percentAboveCost', percent: 5 } as ZonePriceFormula) })]),
		).toBe(true);
		expect(zoneRulesReadCost([rule({ price: { kind: 'lowerOf', formulas: [flat(1)] } as ZonePriceFormula })])).toBe(
			false,
		);
		expect(
			zoneRulesReadCost([
				rule({ when: group('all', [group('any', [cond('line.purchaseCostINR', 'isEmpty')])]) }),
			]),
		).toBe(true);
		expect(zoneRulesReadCost([rule({ when: group('all', [cond('line.quantity', 'isEmpty')]) })])).toBe(false);
	});
});
