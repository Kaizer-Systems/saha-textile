import type { BundlePriceRule, FreeWith } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import {
	SEEDED_PRICE_METHODS,
	anyCombinationInStock,
	bundleChecks,
	bundleStockSummary,
	checkFreePicks,
	combinations,
	freeRange,
	levelSets,
	priceRange,
	quoteBundle,
	setsPossible,
	splitShares,
	startingFreePicks,
	type QuoteBundle,
	type QuoteItem,
	type QuoteMethod,
} from '../src/bundle';

const method = (code: string): QuoteMethod => {
	const found = SEEDED_PRICE_METHODS.find((m) => m.code === code);
	if (!found) throw new Error(code);
	return { base: found.base, inputs: found.inputs, rules: found.rules, combine: found.combine };
};
const item = (key: string, price: number, today = price, quantity = 1): QuoteItem => ({
	key,
	quantity,
	priceInSetINR: price,
	todayINR: today,
	onSale: today < price,
});
const bundle = (over: Partial<QuoteBundle>): QuoteBundle => ({
	levels: [],
	extras: [],
	method: method('pieces_added_up'),
	params: {},
	rules: [],
	combine: 'all',
	capAtSeparately: false,
	roundTo: 'one',
	...over,
});
const NOW = new Date('2026-11-22T06:00:00Z');

// Sarees used in brief revision 2/3 (selling prices).
const k1010 = item('k1010', 26700);
const a1096 = item('a1096', 30000);
const b1082 = item('b1082', 16400);
const b906 = item('b906', 19200);
const a1091 = item('a1091', 28600);

describe('quoteBundle: the seeded methods', () => {
	it('P2: one saree, pieces 10% off → ₹14,760, you save ₹1,640', () => {
		const quote = quoteBundle(
			bundle({
				method: method('pieces_percent_off'),
				params: { percent: 10 },
				levels: [{ code: 'saree', take: 1, priceMode: 'difference', items: [b1082] }],
			}),
			{},
			NOW,
		);
		expect(quote.ok).toBe(true);
		expect(quote.setPriceINR).toBe(14760);
		expect(quote.separatelyINR).toBe(16400);
		expect(quote.saveINR).toBe(1640);
	});

	it('a fixed pair at ₹44,900 against ₹56,700 bought separately', () => {
		const quote = quoteBundle(
			bundle({
				method: method('fixed_price'),
				params: { setPrice: 44900 },
				levels: [
					{ code: 'one', take: 1, priceMode: 'difference', items: [k1010] },
					{ code: 'two', take: 1, priceMode: 'difference', items: [a1096] },
				],
			}),
			{},
			NOW,
		);
		expect(quote.totalINR).toBe(44900);
		expect(quote.separatelyINR).toBe(56700);
		expect(quote.saveINR).toBe(11800);
	});

	it('fixed price: a dearer pick adds the difference, a cheaper one is included (owner, 21 Nov)', () => {
		const b = bundle({
			method: method('fixed_price'),
			params: { setPrice: 18500 },
			levels: [{ code: 'saree', take: 1, priceMode: 'difference', items: [b906, b1082, a1091] }],
		});
		expect(quoteBundle(b, {}, NOW).totalINR).toBe(18500);
		expect(quoteBundle(b, { picks: { saree: ['b1082'] } }, NOW).totalINR).toBe(18500);
		expect(quoteBundle(b, { picks: { saree: ['a1091'] } }, NOW).totalINR).toBe(18500 + 28600 - 19200);
	});

	it('fixed price: "included" levels never change the price; "own" levels add each pick', () => {
		const levels = (mode: 'included' | 'own') => [
			{ code: 'saree', take: 1, priceMode: mode, items: [b906, a1091] } as const,
		];
		const included = bundle({
			method: method('fixed_price'),
			params: { setPrice: 20000 },
			levels: levels('included'),
		});
		const own = bundle({ method: method('fixed_price'), params: { setPrice: 20000 }, levels: levels('own') });
		expect(quoteBundle(included, { picks: { saree: ['a1091'] } }, NOW).totalINR).toBe(20000);
		expect(quoteBundle(own, { picks: { saree: ['a1091'] } }, NOW).totalINR).toBe(48600);
	});

	it('₹ off and buy more, save more (first rule that matches)', () => {
		const amount = bundle({
			method: method('pieces_amount_off'),
			params: { amount: 1500 },
			levels: [{ code: 'saree', take: 1, priceMode: 'difference', items: [b1082] }],
		});
		expect(quoteBundle(amount, {}, NOW).setPriceINR).toBe(14900);

		const sarees = [item('r1', 4400), item('r2', 4800), item('r3', 5600), item('r4', 3900)];
		const tiers = (take: number) =>
			bundle({
				method: method('buy_more_save_more'),
				params: { twoPercent: 5, threePercent: 10 },
				levels: [{ code: 'any', take, priceMode: 'difference', items: sarees }],
			});
		expect(quoteBundle(tiers(2), { picks: { any: ['r1', 'r2'] } }, NOW).setPriceINR).toBe(Math.round(9200 * 0.95));
		expect(quoteBundle(tiers(3), { picks: { any: ['r1', 'r2', 'r3'] } }, NOW).setPriceINR).toBe(
			Math.round(14800 * 0.9),
		);
	});

	it('reports a missing input and a wrong pick count', () => {
		const quote = quoteBundle(
			bundle({
				method: method('fixed_price'),
				params: {},
				levels: [{ code: 'any', take: 2, priceMode: 'difference', items: [b906, b1082, a1091] }],
			}),
			{ picks: { any: ['b906'] } },
			NOW,
		);
		expect(quote.ok).toBe(false);
		expect(quote.problems).toEqual(
			expect.arrayContaining([
				{ kind: 'input_missing', input: 'setPrice' },
				{ kind: 'pick_count', level: 'any', take: 2 },
			]),
		);
	});
});

describe("quoteBundle: extras and the set's own rules", () => {
	const pair = (rules: BundlePriceRule[] = []) =>
		bundle({
			method: method('fixed_price'),
			params: { setPrice: 52900 },
			levels: [
				{ code: 'one', take: 1, priceMode: 'difference', items: [k1010] },
				{ code: 'two', take: 1, priceMode: 'difference', items: [a1096] },
			],
			extras: [item('pc', 0, 450), item('blouse', 1200)],
			rules,
		});

	it('A4: a free petticoat joins at ₹0, a blouse piece adds ₹1,200', () => {
		expect(quoteBundle(pair(), { extras: ['pc'] }, NOW).totalINR).toBe(52900);
		expect(quoteBundle(pair(), { extras: ['pc', 'blouse'] }, NOW).totalINR).toBe(54100);
		expect(quoteBundle(pair(), { extras: ['pc'] }, NOW).extras[0]).toMatchObject({
			key: 'pc',
			free: true,
			priceINR: 0,
		});
	});

	it('a rule makes an extra free and another requires one', () => {
		const rules: BundlePriceRule[] = [
			{
				id: 'free-blouse',
				name: null,
				enabled: true,
				when: {
					match: 'all',
					conditions: [{ fact: 'pieces.subtotal', level: null, op: 'atLeast', value: 50000 }],
				},
				then: [{ kind: 'makeExtraFree', amount: null, level: null, items: ['blouse'] }],
				otherwise: [],
			},
			{
				id: 'need-pc',
				name: null,
				enabled: true,
				when: { match: 'all', conditions: [] },
				then: [{ kind: 'requireExtra', amount: null, level: null, items: ['pc'] }],
				otherwise: [],
			},
		];
		const withBlouse = quoteBundle(pair(rules), { extras: ['blouse'] }, NOW);
		expect(withBlouse.ok).toBe(false);
		expect(withBlouse.problems).toContainEqual({ kind: 'extra_required', key: 'pc' });
		const both = quoteBundle(pair(rules), { extras: ['blouse', 'pc'] }, NOW);
		expect(both.ok).toBe(true);
		expect(both.totalINR).toBe(52900);
	});

	it('S5: "if the saree is Kanchipuram, the blouse level offers only silk"', () => {
		const rules: BundlePriceRule[] = [
			{
				id: 'silk-only',
				name: null,
				enabled: true,
				when: {
					match: 'all',
					conditions: [{ fact: 'level.pick', level: 'saree', op: 'isOneOf', value: ['k1010'] }],
				},
				then: [{ kind: 'limitLevel', amount: null, level: 'blouse', items: ['silk'] }],
				otherwise: [],
			},
		];
		const b = bundle({
			levels: [
				{ code: 'saree', take: 1, priceMode: 'difference', items: [b906, k1010] },
				{ code: 'blouse', take: 1, priceMode: 'difference', items: [item('cotton', 900), item('silk', 1800)] },
			],
			rules,
		});
		expect(quoteBundle(b, { picks: { saree: ['b906'], blouse: ['cotton'] } }, NOW).ok).toBe(true);
		const bad = quoteBundle(b, { picks: { saree: ['k1010'], blouse: ['cotton'] } }, NOW);
		expect(bad.problems).toContainEqual({ kind: 'pick_not_offered', level: 'blouse', key: 'cotton' });
		// Without a pick, the level's first offered item is included.
		expect(quoteBundle(b, { picks: { saree: ['k1010'] } }, NOW).pieces.map((p) => p.key)).toEqual([
			'k1010',
			'silk',
		]);
	});

	it('dates, sales, the cap and rounding', () => {
		const festival: BundlePriceRule = {
			id: 'puja',
			name: null,
			enabled: true,
			when: {
				match: 'all',
				conditions: [{ fact: 'date', level: null, op: 'between', value: ['2026-11-01', '2026-11-30'] }],
			},
			then: [{ kind: 'amountOff', amount: 999, level: null, items: [] }],
			otherwise: [],
		};
		const b = bundle({
			levels: [{ code: 's', take: 1, priceMode: 'difference', items: [b1082] }],
			rules: [festival],
			roundTo: 'ten',
		});
		expect(quoteBundle(b, {}, NOW).setPriceINR).toBe(15400);
		expect(quoteBundle(b, {}, new Date('2026-12-02T06:00:00Z')).setPriceINR).toBe(16400);

		const onSale = bundle({
			method: method('fixed_price'),
			params: { setPrice: 19700 },
			levels: [{ code: 's', take: 1, priceMode: 'difference', items: [item('b906', 19200, 16320)] }],
			capAtSeparately: true,
		});
		expect(quoteBundle(onSale, {}, NOW).totalINR).toBe(16320);
	});
});

describe('splitShares', () => {
	it("shares follow each piece's Price in this set and add up exactly", () => {
		const shares = splitShares(14850, [
			{ key: 'saree', weightINR: 16400 },
			{ key: 'blouse', weightINR: 3400 },
		]);
		expect(shares.get('blouse')).toBe(2550);
		expect(shares.get('saree')).toBe(12300);
		const odd = splitShares(100, [
			{ key: 'a', weightINR: 1 },
			{ key: 'b', weightINR: 1 },
			{ key: 'c', weightINR: 1 },
		]);
		expect([...odd.values()].reduce((s, v) => s + v, 0)).toBeCloseTo(100, 10);
		expect(
			splitShares(90, [
				{ key: 'x', weightINR: 0 },
				{ key: 'y', weightINR: 0 },
			]).get('x'),
		).toBe(45);
	});
});

describe('worked-out stock (V3)', () => {
	it('fixed levels: the smallest piece decides; one sold-out piece stops the set', () => {
		expect(
			setsPossible([
				{ code: 'a', take: 1, items: [{ key: 'x', capacity: 5 }] },
				{ code: 'b', take: 1, items: [{ key: 'y', capacity: 2 }] },
			]),
		).toBe(2);
		const out = bundleStockSummary(
			[
				{ code: 'a', take: 1, items: [{ key: 'x', capacity: 5 }] },
				{ code: 'b', take: 1, items: [{ key: 'y', capacity: 0 }] },
			],
			{ lowStockThreshold: 2 },
		);
		expect(out).toMatchObject({ setsPossible: 0, state: 'out_of_stock', soldOutPieces: ['y'], totalPieces: 2 });
	});

	it('choices: in stock while one full combination remains; sold-out choices are named', () => {
		const level = {
			code: 'saree',
			take: 1,
			items: [
				{ key: 'a', capacity: 0 },
				{ key: 'b', capacity: 3 },
				{ key: 'c', capacity: 0 },
			],
		};
		const summary = bundleStockSummary([level], { lowStockThreshold: 2 });
		expect(summary).toMatchObject({
			setsPossible: 3,
			state: 'in_stock',
			soldOutChoices: ['a', 'c'],
			totalChoices: 3,
		});
	});

	it('take 2 needs two different pieces per set', () => {
		expect(
			levelSets({
				code: 'x',
				take: 2,
				items: [
					{ key: 'a', capacity: 10 },
					{ key: 'b', capacity: 1 },
				],
			}),
		).toBe(1);
		expect(
			levelSets({
				code: 'x',
				take: 2,
				items: [
					{ key: 'a', capacity: 3 },
					{ key: 'b', capacity: 3 },
					{ key: 'c', capacity: 2 },
				],
			}),
		).toBe(4);
		expect(levelSets({ code: 'x', take: 2, items: [{ key: 'a', capacity: 9 }] })).toBe(0);
		expect(levelSets({ code: 'x', take: 1, items: [{ key: 'a', capacity: Number.POSITIVE_INFINITY }] })).toBe(
			Number.POSITIVE_INFINITY,
		);
	});

	it('with rules, out of stock when no allowed combination is in stock', () => {
		const rules: BundlePriceRule[] = [
			{
				id: 'silk-only',
				name: null,
				enabled: true,
				when: {
					match: 'all',
					conditions: [{ fact: 'level.pick', level: 'saree', op: 'isOneOf', value: ['k'] }],
				},
				then: [{ kind: 'limitLevel', amount: null, level: 'blouse', items: ['silk'] }],
				otherwise: [],
			},
		];
		const b = bundle({
			levels: [
				{ code: 'saree', take: 1, priceMode: 'difference', items: [item('k', 100)] },
				{ code: 'blouse', take: 1, priceMode: 'difference', items: [item('cotton', 10), item('silk', 20)] },
			],
			rules,
		});
		expect(
			anyCombinationInStock(
				b,
				new Map([
					['k', 1],
					['cotton', 5],
					['silk', 0],
				]),
				NOW,
			),
		).toBe(false);
		expect(
			anyCombinationInStock(
				b,
				new Map([
					['k', 1],
					['cotton', 5],
					['silk', 1],
				]),
				NOW,
			),
		).toBe(true);
	});

	it('combinations and the "From ₹" range', () => {
		const b = bundle({
			levels: [
				{ code: 'saree', take: 1, priceMode: 'difference', items: [b906, b1082] },
				{ code: 'pc', take: 1, priceMode: 'difference', items: [item('cream', 450)] },
			],
		});
		expect(combinations(b.levels)).toHaveLength(2);
		expect(priceRange(b, NOW)).toEqual({ low: 16850, high: 19650, count: 2 });
	});
});

describe('free with this product', () => {
	const items = (n: number): FreeWith['items'] =>
		Array.from({ length: n }, (_, at) => ({ productId: `p${at + 1}`, variantId: null, quantity: 1 }));
	const rule = (over: Partial<FreeWith>): FreeWith => ({
		items: items(3),
		take: 'all',
		count: null,
		from: null,
		required: true,
		...over,
	});

	it("turns the admin's words into a range (P8.1–P8.8)", () => {
		expect(freeRange(rule({ items: items(1) }))).toMatchObject({ given: true, min: 1, max: 1 });
		expect(freeRange(rule({ items: items(1), required: false }))).toMatchObject({ given: false, min: 0, max: 1 });
		expect(freeRange(rule({ take: 'exactly', count: 1 }))).toMatchObject({ min: 1, max: 1 });
		expect(freeRange(rule({ items: items(4), take: 'upto', count: 2, required: false }))).toMatchObject({
			min: 0,
			max: 2,
		});
		expect(freeRange(rule({ items: items(5), take: 'between', from: 1, count: 3 }))).toMatchObject({
			min: 1,
			max: 3,
		});
	});

	it("checks a shopper's picks", () => {
		const yes = () => true;
		const noSizes = () => false;
		expect(
			checkFreePicks(rule({ take: 'exactly', count: 2 }), [{ productId: 'p1', variantId: null }], yes, noSizes),
		).toEqual({
			ok: false,
			problem: 'too_few',
		});
		expect(
			checkFreePicks(
				rule({ take: 'exactly', count: 1 }),
				[{ productId: 'p2', variantId: null }],
				(id) => id !== 'p2',
				noSizes,
			),
		).toEqual({ ok: false, problem: 'sold_out' });
		expect(checkFreePicks(rule({ take: 'upto', count: 2, required: false }), [], yes, noSizes)).toEqual({
			ok: true,
			picks: [],
		});
		expect(checkFreePicks(rule({ items: items(1) }), [], yes, (id) => id === 'p1')).toEqual({
			ok: false,
			problem: 'size_needed',
		});
		const given = checkFreePicks(rule({ items: items(2) }), [], (id) => id !== 'p2', noSizes);
		expect(given).toEqual({ ok: true, picks: [{ productId: 'p1', variantId: null }] });
		expect(startingFreePicks(rule({ take: 'exactly', count: 1 }), (id) => id !== 'p1')).toEqual(['p2']);
	});
});

describe('checks before Go Live', () => {
	it('a set dearer than its pieces during a sale holds Go Live unless kept with a reason (C09)', () => {
		const b = bundle({
			method: method('fixed_price'),
			params: { setPrice: 19700 },
			levels: [{ code: 's', take: 1, priceMode: 'difference', items: [item('b906', 19200, 16320), b1082] }],
		});
		const levels = [
			{
				code: 's',
				take: 1,
				items: [
					{ key: 'b906', live: true, isBundle: false, inStock: true },
					{ key: 'b1082', live: true, isBundle: false, inStock: true },
				],
			},
		];
		const checks = bundleChecks({ bundle: b, levels, extras: [], methodActive: true, dearerReason: null }, NOW);
		expect(checks[0]).toMatchObject({
			severity: 'error',
			code: 'set_dearer',
			totalINR: 19700,
			separatelyINR: 16320,
		});
		const kept = bundleChecks(
			{ bundle: b, levels, extras: [], methodActive: true, dearerReason: 'Puja pricing' },
			NOW,
		);
		expect(kept.map((c) => c.code)).toEqual(['set_dearer_kept', 'all_good']);
	});

	it('names empty, sold-out and not-live levels', () => {
		const b = bundle({ method: method('pieces_percent_off'), params: {}, levels: [] });
		const checks = bundleChecks(
			{
				bundle: b,
				levels: [
					{ code: 'a', take: 1, items: [] },
					{ code: 'b', take: 1, items: [{ key: 'x', live: true, isBundle: false, inStock: false }] },
					{ code: 'c', take: 1, items: [{ key: 'y', live: false, isBundle: false, inStock: true }] },
				],
				extras: [],
				methodActive: true,
				dearerReason: null,
			},
			NOW,
		);
		expect(checks.map((c) => c.code)).toEqual([
			'level_empty',
			'level_sold_out',
			'level_sold_out',
			'item_not_live',
			'input_missing',
		]);
	});
});
