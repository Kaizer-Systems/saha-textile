import type { BundlePriceRule, BundleRuleAction, BundleRuleCondition } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import {
	combinations,
	includedKeys,
	priceRange,
	quoteBundle,
	type QuoteBundle,
	type QuoteItem,
	type QuoteLevel,
	type QuoteMethod,
} from '../src/bundle/price';
import {
	actionsFor,
	amountOf,
	bundleConditionHolds,
	conditionIsComplete,
	ruleMatches,
	type BundleFacts,
} from '../src/bundle/rules';

const cond = (fact: unknown, op: unknown, value: unknown, level: string | null = null) =>
	({ fact, op, value, level }) as BundleRuleCondition;
const action = (kind: BundleRuleAction['kind'], over: Partial<BundleRuleAction> = {}): BundleRuleAction => ({
	kind,
	amount: null,
	level: null,
	items: [],
	...over,
});
const rule = (
	id: string,
	conditions: BundleRuleCondition[],
	then: BundleRuleAction[],
	over: Partial<BundlePriceRule> = {},
): BundlePriceRule => ({
	id,
	name: null,
	enabled: true,
	when: { match: 'all', conditions },
	then,
	otherwise: [],
	...over,
});
const facts: BundleFacts = {
	piecesCount: 3,
	piecesSubtotal: 3000,
	piecesSeparately: 3600,
	picks: { saree: ['a'] },
	extras: ['fall'],
	anyPieceOnSale: true,
	today: '2026-11-22',
};
const holds = (c: BundleRuleCondition) => bundleConditionHolds(c, facts);

describe('bundle rule conditions: when one is complete', () => {
	it('needs a fact, an operator the fact takes, a value, and a level for a pick', () => {
		expect(conditionIsComplete(cond(null, 'is', 1))).toBe(false);
		expect(conditionIsComplete(cond('pieces.count', null, 1))).toBe(false);
		expect(conditionIsComplete(cond('pieces.count', 'is', null))).toBe(false);
		expect(conditionIsComplete(cond('pieces.count', 'isOneOf', ['a']))).toBe(false);
		expect(conditionIsComplete(cond('level.pick', 'isOneOf', ['a']))).toBe(false);
		expect(conditionIsComplete(cond('level.pick', 'isOneOf', ['a'], 'saree'))).toBe(true);
	});

	it('takes a number, or a low-to-high pair of numbers for between', () => {
		expect(conditionIsComplete(cond('pieces.count', 'is', 'x'))).toBe(false);
		expect(conditionIsComplete(cond('pieces.count', 'is', 2))).toBe(true);
		expect(conditionIsComplete(cond('pieces.count', 'between', [1, 5]))).toBe(true);
		expect(conditionIsComplete(cond('pieces.subtotal', 'between', [5, 1]))).toBe(false);
		expect(conditionIsComplete(cond('pieces.count', 'between', [1]))).toBe(false);
		expect(conditionIsComplete(cond('pieces.count', 'between', ['a', 'b']))).toBe(false);
		expect(conditionIsComplete(cond('pieces.count', 'between', 5))).toBe(false);
	});

	it('takes a list of keys, a yes or no, and dates in order', () => {
		expect(conditionIsComplete(cond('extras.has', 'isOneOf', []))).toBe(false);
		expect(conditionIsComplete(cond('extras.has', 'isOneOf', ['fall']))).toBe(true);
		expect(conditionIsComplete(cond('pieces.onSale', 'is', 'yes'))).toBe(false);
		expect(conditionIsComplete(cond('pieces.onSale', 'is', true))).toBe(true);
		expect(conditionIsComplete(cond('date', 'between', ['2026-11-01', '2026-11-30']))).toBe(true);
		expect(conditionIsComplete(cond('date', 'between', ['2026-11-30', '2026-11-01']))).toBe(false);
		expect(conditionIsComplete(cond('date', 'between', ['2026-11-01']))).toBe(false);
		expect(conditionIsComplete(cond('date', 'between', '2026-11-01'))).toBe(false);
		expect(conditionIsComplete(cond('date', 'before', 'soon'))).toBe(false);
		expect(conditionIsComplete(cond('date', 'before', '2026-11-01'))).toBe(true);
	});
});

describe('bundle rule conditions: whether one holds', () => {
	it('never holds while unfinished', () => {
		expect(holds(cond('pieces.count', 'is', null))).toBe(false);
	});

	it('compares the piece count every way', () => {
		const count = (op: string, value: unknown) => holds(cond('pieces.count', op, value));
		expect([
			count('is', 3),
			count('isNot', 3),
			count('moreThan', 2),
			count('atLeast', 3),
			count('lessThan', 3),
			count('atMost', 3),
			count('between', [1, 3]),
			count('between', [4, 9]),
			count('between', [1, 2]),
		]).toEqual([true, false, true, true, false, true, true, false, false]);
	});

	it('reads the subtotal, the separate price, the extras count and the sale flag', () => {
		expect(holds(cond('pieces.subtotal', 'atLeast', 3000))).toBe(true);
		expect(holds(cond('pieces.separately', 'moreThan', 3500))).toBe(true);
		expect(holds(cond('extras.count', 'is', 1))).toBe(true);
		expect(holds(cond('pieces.onSale', 'is', true))).toBe(true);
		expect(holds(cond('pieces.onSale', 'is', false))).toBe(false);
	});

	it('looks for keys in a level’s picks or the extras', () => {
		expect(holds(cond('level.pick', 'isOneOf', ['a'], 'saree'))).toBe(true);
		expect(holds(cond('level.pick', 'isNotOneOf', ['a'], 'saree'))).toBe(false);
		expect(holds(cond('level.pick', 'isOneOf', ['a'], 'blouse'))).toBe(false);
		expect(holds(cond('extras.has', 'isOneOf', ['fall']))).toBe(true);
		expect(holds(cond('extras.has', 'isNotOneOf', ['pico']))).toBe(true);
	});

	it('compares today with a date or a span of dates', () => {
		expect(holds(cond('date', 'before', '2026-12-01'))).toBe(true);
		expect(holds(cond('date', 'after', '2026-12-01'))).toBe(false);
		expect(holds(cond('date', 'between', ['2026-11-01', '2026-11-30']))).toBe(true);
		expect(holds(cond('date', 'between', ['2026-12-01', '2026-12-31']))).toBe(false);
	});
});

describe('bundle rules: matching, running and amounts', () => {
	it('matches “any” when one condition holds, and skips a switched-off rule', () => {
		const any = rule(
			'r',
			[cond('pieces.count', 'is', 9), cond('pieces.count', 'is', 3)],
			[action('priceIsPieces')],
			{
				when: { match: 'any', conditions: [cond('pieces.count', 'is', 9), cond('pieces.count', 'is', 3)] },
			},
		);
		expect(ruleMatches(any, facts)).toBe(true);
		expect(actionsFor([{ ...any, enabled: false }], 'all', facts)).toEqual({ actions: [], applied: [] });
	});

	it('reads a typed amount or a bundle input, and nothing for a missing or broken input', () => {
		expect(amountOf(null, {})).toBeNull();
		expect(amountOf(5, {})).toBe(5);
		expect(amountOf({ input: 'percent' }, { percent: 10 })).toBe(10);
		expect(amountOf({ input: 'percent' }, {})).toBeNull();
		expect(amountOf({ input: 'percent' }, { percent: Number.NaN })).toBeNull();
	});
});

const FIXED: QuoteMethod = {
	base: { kind: 'fixed', input: 'setPrice' },
	inputs: [],
	rules: [],
	combine: 'all',
} as unknown as QuoteMethod;
const PIECES: QuoteMethod = {
	base: { kind: 'pieces' },
	inputs: [],
	rules: [],
	combine: 'all',
} as unknown as QuoteMethod;
const item = (key: string, price: number, over: Partial<QuoteItem> = {}): QuoteItem => ({
	key,
	quantity: 1,
	priceInSetINR: price,
	todayINR: price,
	onSale: false,
	...over,
});
const level = (code: string, items: QuoteItem[], over: Partial<QuoteLevel> = {}): QuoteLevel => ({
	code,
	take: 1,
	priceMode: 'difference',
	items,
	...over,
});
const bundle = (over: Partial<QuoteBundle>): QuoteBundle => ({
	levels: [],
	extras: [],
	method: PIECES,
	params: {},
	rules: [],
	combine: 'all',
	capAtSeparately: false,
	roundTo: 'none',
	...over,
});
const NOW = new Date('2026-11-22T06:00:00Z');

describe('bundle quotes: the remaining cases', () => {
	it('prices cloth by the metre and counts each cloth line as one piece', () => {
		const cloth = item('cloth', 400, { quantity: 25, perTenth: true });
		const quote = quoteBundle(
			bundle({
				levels: [level('cloth', [cloth])],
				rules: [rule('one', [cond('pieces.count', 'is', 1)], [action('amountOff', { amount: 100 })])],
			}),
			{},
			NOW,
		);
		expect(quote.pieces[0]).toMatchObject({ priceInSetINR: 1000, todayINR: 1000 });
		expect(quote.setPriceINR).toBe(900);
	});

	it('hides and limits what a level offers, and skips offer rules for a level that is not there', () => {
		const quote = quoteBundle(
			bundle({
				levels: [level('saree', [item('a', 100), item('b', 200), item('c', 300)])],
				rules: [
					rule('hide', [], [action('hideItem', { level: 'saree', items: ['b'] })]),
					rule('limit', [], [action('limitLevel', { level: 'saree', items: ['a', 'b'] })]),
					rule('elsewhere', [], [action('hideItem', { level: 'blouse', items: ['x'] })]),
				],
			}),
			{ picks: { saree: ['c'] } },
			NOW,
		);
		expect(quote.offered).toEqual({ saree: ['a'] });
		expect(quote.problems).toEqual([{ kind: 'pick_not_offered', level: 'saree', key: 'c' }]);
	});

	it('flags a level with nothing in it', () => {
		const quote = quoteBundle(bundle({ levels: [level('empty', [])] }), {}, NOW);
		expect(quote.problems).toEqual([{ kind: 'level_empty', level: 'empty' }]);
	});

	it('adds a dearer pick’s difference and an own-price level to a fixed price, with a free pick costing nothing', () => {
		const quote = quoteBundle(
			bundle({
				method: FIXED,
				params: { setPrice: 1000 },
				levels: [
					level('saree', [item('p', 1000), item('q', 1500)]),
					level('blouse', [item('x', 300), item('y', 500)], { priceMode: 'own' }),
				],
				rules: [rule('free', [], [action('makePickFree', { items: ['y'] })])],
			}),
			{ picks: { saree: ['q'], blouse: ['y'] } },
			NOW,
		);
		expect(quote.setPriceINR).toBe(1500);
		expect(quote.pieces.map((piece) => [piece.key, piece.priceInSetINR, piece.free])).toEqual([
			['q', 1500, false],
			['y', 0, true],
		]);
	});

	it('leaves the price alone for blank amounts, and sets it outright or back to the pieces', () => {
		const price = (actions: BundleRuleAction[]) =>
			quoteBundle(
				bundle({ levels: [level('saree', [item('p', 1000)])], rules: [rule('r', [], actions)] }),
				{},
				NOW,
			).setPriceINR;
		expect(
			price([action('percentOff', { amount: { input: 'none' } }), action('amountOff'), action('priceIs')]),
		).toBe(1000);
		expect(price([action('priceIs', { amount: 800 })])).toBe(800);
		expect(price([action('priceIs', { amount: 800 }), action('priceIsPieces')])).toBe(1000);
	});
});

describe('bundle combinations and price ranges: the remaining cases', () => {
	const two = (code: string) => level(code, [item(`${code}1`, 100), item(`${code}2`, 200)]);

	it('stops at the limit, and has no combinations without levels', () => {
		expect(combinations([level('a', [item('a1', 1), item('a2', 2), item('a3', 3)])], 2)).toEqual([
			{ a: ['a1'] },
			{ a: ['a2'] },
		]);
		expect(combinations([two('a'), two('b')], 3)).toHaveLength(3);
		expect(combinations([])).toEqual([]);
	});

	it('takes a level’s first items as included when nothing narrows the offer', () => {
		expect(includedKeys(two('a'))).toEqual(['a1']);
	});

	it('has no range when no combination can be priced', () => {
		expect(priceRange(bundle({ method: FIXED, levels: [two('a')] }), NOW)).toEqual({ low: 0, high: 0, count: 0 });
	});
});
