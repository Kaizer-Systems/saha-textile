import type {
	ShippingCartSnapshot,
	ShippingCondition,
	ShippingConditionGroup,
	ShippingSnapshotLine,
} from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { conditionHolds, groupHolds, valueMatchesShape, valueShape } from '../src/shipping/conditions';
import { cartFacts, discountPercent, factValue, type ShippingEvalScope } from '../src/shipping/facts';

const line = (over: Partial<ShippingSnapshotLine> = {}): ShippingSnapshotLine => ({
	lineId: 'a',
	productId: 'p-a',
	categoryIds: ['sarees', 'silk'],
	mainCategoryId: 'sarees',
	mainCategoryAncestorIds: [],
	freeShipping: false,
	units: 2,
	sellingPriceINR: 900,
	mrpINR: 1000,
	onSaleEvent: true,
	soldBy: 'piece',
	madeToOrder: false,
	chargeableWeightGrams: 600,
	charges: { domestic: 100, internationalFirst: 2000, internationalFurther: 900 },
	...over,
});
const snapshot = (lines: ShippingSnapshotLine[], pincode = '700 045'): ShippingCartSnapshot => ({
	lines,
	delivery: { country: 'in', state: 'West Bengal', pincode },
	shopper: { signedIn: true, groups: ['wholesale'], firstOrder: true },
});
const scope = (over: Partial<ShippingEvalScope> = {}, lines = [line(), line({ lineId: 'b', chargeableWeightGrams: null })]): ShippingEvalScope => {
	const snap = snapshot(lines);
	return { snapshot: snap, cart: cartFacts(snap), zone: 'domestic', line: lines[0] ?? null, lineUnits: 2, ...over };
};
const cond = (field: ShippingCondition['field'], op: ShippingCondition['op'], value: unknown): ShippingCondition =>
	({ kind: 'condition', field, op, value }) as ShippingCondition;

describe('shipping facts', () => {
	it('counts lines without a weight and reads every cart, delivery and shopper field', () => {
		const s = scope();
		expect(s.cart).toMatchObject({ units: 4, lines: 2, linesWithoutWeight: ['b'] });
		expect(factValue('cart.units', s)).toBe(4);
		expect(factValue('cart.lines', s)).toBe(2);
		expect(factValue('delivery.country', s)).toBe('IN');
		expect(factValue('delivery.pincode', s)).toBe('700 045');
		expect(factValue('shopper.signedIn', s)).toBe(true);
		expect(factValue('shopper.firstOrder', s)).toBe(true);
	});

	it('reads every line field, and none without a line', () => {
		const s = scope();
		expect(factValue('line.quantity', s)).toBe(2);
		expect(factValue('line.sellingPrice', s)).toBe(900);
		expect(factValue('line.mrp', s)).toBe(1000);
		expect(factValue('line.discountPercent', s)).toBeCloseTo(10);
		expect(factValue('line.onSaleEvent', s)).toBe(true);
		expect(factValue('line.category', s)).toEqual(['sarees', 'silk']);
		expect(factValue('line.mainCategory', s)).toBe('sarees');
		expect(factValue('line.product', s)).toBe('p-a');
		expect(factValue('line.soldBy', s)).toBe('piece');
		expect(factValue('line.madeToOrder', s)).toBe(false);
		expect(factValue('line.chargeableWeight', s)).toBe(1200);
		expect(factValue('line.chargeableWeight', scope({ line: line({ chargeableWeightGrams: null }) }))).toBe(0);
		expect(factValue('line.charge.domestic', s)).toBe(100);
		expect(factValue('line.charge.internationalFirst', s)).toBe(2000);
		expect(factValue('line.charge.internationalFurther', s)).toBe(900);
		expect(factValue('line.mrp', scope({ line: null }))).toBeNull();
	});

	it('gives no discount without an MRP, with a zero MRP, or at full price, and reads it from the base price', () => {
		expect(discountPercent({ sellingPriceINR: 900, mrpINR: null })).toBe(0);
		expect(discountPercent({ sellingPriceINR: 0, mrpINR: 0 })).toBe(0);
		expect(discountPercent({ sellingPriceINR: 1000, mrpINR: 1000 })).toBe(0);
		expect(discountPercent({ sellingPriceINR: 600, mrpINR: 1000, basePriceINR: 800 } as never)).toBeCloseTo(20);
	});
});

describe('shipping condition shapes', () => {
	it('names the shape each operator needs, and refuses an operator the field does not take', () => {
		expect(valueShape('pincode', 'between')).toBe('range');
		expect(valueShape('pincode', 'startsWith')).toBe('textOrList');
		expect(valueShape('text', 'moreThan')).toBeNull();
	});

	it('checks ranges and text-or-list values', () => {
		expect(valueMatchesShape([1, 2], 'range')).toBe(true);
		expect(valueMatchesShape([1], 'range')).toBe(false);
		expect(valueMatchesShape([1, Number.NaN], 'range')).toBe(false);
		expect(valueMatchesShape(['1', 2], 'range')).toBe(false);
		expect(valueMatchesShape('70', 'textOrList')).toBe(true);
		expect(valueMatchesShape(['70', '71'], 'textOrList')).toBe(true);
		expect(valueMatchesShape(5, 'textOrList')).toBe(false);
	});
});

describe('shipping conditions', () => {
	const s = scope();

	it('refuses an unfinished condition, a wrong value shape, and a line field without a line', () => {
		expect(conditionHolds(cond(null as never, 'is', 1), s)).toBe(false);
		expect(conditionHolds(cond('cart.units', 'is', 'four'), s)).toBe(false);
		expect(conditionHolds(cond('line.quantity', 'is', 2), scope({ line: null }))).toBe(false);
	});

	it('compares numbers every way', () => {
		const q = (op: ShippingCondition['op'], value: unknown) => conditionHolds(cond('cart.units', op, value), s);
		expect(q('is', 4)).toBe(true);
		expect(q('isNot', 4)).toBe(false);
		expect(q('moreThan', 3)).toBe(true);
		expect(q('atLeast', 5)).toBe(false);
		expect(q('lessThan', 5)).toBe(true);
		expect(q('atMost', 3)).toBe(false);
		expect(q('between', [1, 4])).toBe(true);
		expect(q('between', [5, 9])).toBe(false);
		expect(q('between', [1, 3])).toBe(false);
	});

	it('matches pincodes by value, list, prefix and range, ignoring spaces', () => {
		const p = (op: ShippingCondition['op'], value: unknown, pin = '700 045') =>
			conditionHolds(cond('delivery.pincode', op, value), { ...s, snapshot: snapshot([line()], pin) });
		expect(p('is', '700045')).toBe(true);
		expect(p('isOneOf', ['110001', '700 045'])).toBe(true);
		expect(p('isNotOneOf', ['110001'])).toBe(true);
		expect(p('startsWith', '70')).toBe(true);
		expect(p('startsWith', ['11', '70'])).toBe(true);
		expect(p('between', [700000, 700099])).toBe(true);
		expect(p('between', [100, 200])).toBe(false);
		expect(p('between', [700000, 700040])).toBe(false);
		expect(p('between', [1, 9], 'NW3 4DU')).toBe(false);
		expect(p('is', '700045', '  ')).toBe(false);
	});

	it('matches text and id fields, one or many, ignoring case', () => {
		const t = (field: ShippingCondition['field'], op: ShippingCondition['op'], value: unknown) =>
			conditionHolds(cond(field, op, value), s);
		expect(t('line.category', 'is', 'SILK')).toBe(true);
		expect(t('line.category', 'isNot', 'cotton')).toBe(true);
		expect(t('line.product', 'isOneOf', ['p-b', 'p-a'])).toBe(true);
		expect(t('line.product', 'isNotOneOf', ['p-a'])).toBe(false);
	});

	it('lets no empty group hold, and joins items with all or any', () => {
		const yes = cond('cart.units', 'atLeast', 1);
		const no = cond('cart.units', 'atLeast', 99);
		const group = (join: 'all' | 'any', items: ShippingConditionGroup['items']) =>
			({ kind: 'group', join, items }) as ShippingConditionGroup;
		expect(groupHolds(group('all', []), s)).toBe(false);
		expect(groupHolds(group('any', [no, group('all', [yes])]), s)).toBe(true);
		expect(groupHolds(group('all', [yes, no]), s)).toBe(false);
	});
});
