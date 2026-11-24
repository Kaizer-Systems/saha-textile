import type { BundlePriceRule, BundleRuleAction, FreeWith, SaleRule } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { blocksGoLive, bundleChecks, type CheckInput, type CheckItem } from '../src/bundle/checks';
import { checkFreePicks, freeRange, startingFreePicks } from '../src/bundle/free-with';
import type { QuoteBundle, QuoteItem, QuoteMethod } from '../src/bundle/price';
import { applySaleRule } from '../src/bundle/sale-rule';
import { splitShares } from '../src/bundle/shares';
import { anyCombinationInStock, bundleStockSummary, levelSets, setsPossible } from '../src/bundle/stock';

const PIECES = { base: { kind: 'pieces' }, inputs: [], rules: [], combine: 'all' } as unknown as QuoteMethod;
const item = (key: string, price: number): QuoteItem => ({
	key,
	quantity: 1,
	priceInSetINR: price,
	todayINR: price,
	onSale: false,
});
const action = (kind: BundleRuleAction['kind'], over: Partial<BundleRuleAction> = {}): BundleRuleAction => ({
	kind,
	amount: null,
	level: null,
	items: [],
	...over,
});
const always = (id: string, then: BundleRuleAction[]): BundlePriceRule => ({
	id,
	name: null,
	enabled: true,
	when: { match: 'all', conditions: [] },
	then,
	otherwise: [],
});
const bundle = (over: Partial<QuoteBundle> = {}): QuoteBundle => ({
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
const check = (key: string, over: Partial<CheckItem> = {}): CheckItem => ({
	key,
	live: true,
	isBundle: false,
	inStock: true,
	...over,
});
const input = (over: Partial<CheckInput>): CheckInput => ({
	bundle: bundle(),
	levels: [],
	extras: [],
	methodActive: true,
	dearerReason: null,
	...over,
});
const codes = (i: CheckInput) => bundleChecks(i, NOW).map((c) => c.code);

describe('bundle checks: the remaining cases', () => {
	it('stops a set with no levels or a switched-off method', () => {
		const checks = bundleChecks(input({ methodActive: false }), NOW);
		expect(checks.map((c) => c.code)).toEqual(['no_levels', 'method_inactive']);
		expect(blocksGoLive(checks)).toBe(true);
	});

	it('flags a level that takes more than it has, and sets or unlisted products used as pieces or extras', () => {
		expect(
			codes(
				input({
					levels: [{ code: 'a', take: 3, items: [check('x', { isBundle: true })] }],
					extras: [check('set', { isBundle: true }), check('off', { live: false }), check('fall')],
				}),
			),
		).toEqual(['level_takes_too_many', 'item_is_bundle', 'item_is_bundle', 'item_not_live']);
	});

	it('skips combinations the offer rules rule out, for the dearer and the garment checks', () => {
		const levels = [
			{ code: 'a', take: 1, priceMode: 'difference' as const, items: [item('a1', 1000), item('a2', 900)] },
		];
		const checks = bundleChecks(
			input({
				bundle: bundle({
					levels,
					rules: [always('hide', [action('hideItem', { level: 'a', items: ['a2'] })])],
				}),
				levels: [{ code: 'a', take: 1, items: [check('a1', { garment: true }), check('a2')] }],
			}),
			NOW,
		);
		expect(checks).toEqual([{ severity: 'ok', code: 'all_good' }]);
		expect(blocksGoLive(checks)).toBe(false);
	});
});

describe('bundle shares, sale rules and stock: the remaining cases', () => {
	it('splits nothing for no pieces', () => {
		expect(splitShares(100, [])).toEqual(new Map());
	});

	it('gives no sale price for a broken normal price or an out-of-range percent or amount', () => {
		const percent = (value: number) => ({ kind: 'percent', value, skuPrices: {} }) as unknown as SaleRule;
		const amount = (value: number) => ({ kind: 'amount', value, skuPrices: {} }) as unknown as SaleRule;
		expect(applySaleRule(percent(10), Number.NaN, '')).toBeNull();
		expect(applySaleRule(percent(10), 0, '')).toBeNull();
		expect(applySaleRule(percent(0), 1000, '')).toBeNull();
		expect(applySaleRule(percent(100), 1000, '')).toBeNull();
		expect(applySaleRule(amount(0), 1000, '')).toBeNull();
		expect(applySaleRule(amount(1000), 1000, '')).toBeNull();
		expect(applySaleRule(amount(100), 1000, '')).toBe(900);
	});

	it('counts sets for a level with too few made-to-order items to fill it alone', () => {
		expect(
			levelSets({
				code: 'a',
				take: 2,
				items: [
					{ key: 'x', capacity: Infinity },
					{ key: 'y', capacity: 3 },
				],
			}),
		).toBe(3);
		expect(setsPossible([])).toBe(0);
	});

	it('needs a required extra in stock as well as the pieces', () => {
		const withExtra = bundle({
			levels: [{ code: 'a', take: 1, priceMode: 'difference', items: [item('a1', 1000)] }],
			extras: [item('fall', 100)],
			rules: [always('need', [action('requireExtra', { items: ['fall'] })])],
		});
		expect(anyCombinationInStock(withExtra, new Map([['a1', 5]]), NOW)).toBe(false);
		expect(
			anyCombinationInStock(
				withExtra,
				new Map([
					['a1', 5],
					['fall', 1],
				]),
				NOW,
			),
		).toBe(true);
	});

	it('marks a set out of stock when the offer rules leave nothing, and low or plentiful otherwise', () => {
		const unlimited = [{ code: 'a', take: 1, items: [{ key: 'x', capacity: Infinity }] }];
		const three = [{ code: 'a', take: 1, items: [{ key: 'x', capacity: 3 }] }];
		const summary = (levels: typeof three, anyCombination: () => boolean) =>
			bundleStockSummary(levels, { lowStockThreshold: 5, hasOfferRules: true, anyCombination });
		expect(summary(unlimited, () => false)).toMatchObject({ setsPossible: 0, state: 'out_of_stock' });
		expect(summary(unlimited, () => true)).toMatchObject({ setsPossible: 9999, state: 'in_stock' });
		expect(summary(three, () => true)).toMatchObject({ setsPossible: 3, state: 'low_stock' });
	});
});

const freeWith = (over: Partial<FreeWith>): FreeWith => ({
	items: [
		{ productId: 'p1', variantId: null, quantity: 1 },
		{ productId: 'p2', variantId: 'v1', quantity: 1 },
		{ productId: 'p3', variantId: null, quantity: 1 },
	],
	take: 'exactly',
	count: 2,
	from: null,
	required: true,
	...over,
});
const yes = () => true;
const no = () => false;

describe('free items: ranges and picks, the remaining cases', () => {
	it('works out how many a shopper may take for each kind of rule', () => {
		expect(freeRange(freeWith({ required: true }))).toEqual({ given: false, min: 2, max: 2, noneOrExactly: false });
		expect(freeRange(freeWith({ required: false }))).toEqual({ given: false, min: 0, max: 2, noneOrExactly: true });
		expect(freeRange(freeWith({ take: 'upto', required: true }))).toMatchObject({ min: 1, max: 2 });
		expect(freeRange(freeWith({ take: 'upto', required: false }))).toMatchObject({ min: 0, max: 2 });
		expect(freeRange(freeWith({ take: 'between', from: null }))).toMatchObject({ min: 0, max: 2 });
		expect(freeRange(freeWith({ take: 'between', from: 3, count: null }))).toMatchObject({ min: 3, max: 3 });
	});

	it('takes the size the shopper chose for a given item that needs one', () => {
		const given = freeWith({ take: 'all', items: [{ productId: 'p1', variantId: null, quantity: 1 }] });
		expect(checkFreePicks(given, [{ productId: 'p1', variantId: 'm' }], yes, yes)).toEqual({
			ok: true,
			picks: [{ productId: 'p1', variantId: 'm' }],
		});
		expect(startingFreePicks(given, yes)).toEqual(['p1']);
	});

	it('refuses an item not offered, picked twice, in another size, or without a size it needs', () => {
		const rule = freeWith({});
		expect(checkFreePicks(rule, [{ productId: 'p9', variantId: null }], yes, no)).toEqual({
			ok: false,
			problem: 'not_offered',
		});
		expect(
			checkFreePicks(
				rule,
				[
					{ productId: 'p1', variantId: null },
					{ productId: 'p1', variantId: null },
				],
				yes,
				no,
			),
		).toEqual({ ok: false, problem: 'not_offered' });
		expect(checkFreePicks(rule, [{ productId: 'p2', variantId: 'v2' }], yes, no)).toEqual({
			ok: false,
			problem: 'not_offered',
		});
		expect(checkFreePicks(rule, [{ productId: 'p1', variantId: null }], yes, yes)).toEqual({
			ok: false,
			problem: 'size_needed',
		});
	});

	it('allows none or exactly the count on an optional “exactly” rule, and no more than “up to”', () => {
		const optional = freeWith({ required: false });
		const pick = (id: string) => ({ productId: id, variantId: null });
		expect(checkFreePicks(optional, [], yes, no)).toEqual({ ok: true, picks: [] });
		expect(checkFreePicks(optional, [pick('p1')], yes, no)).toEqual({ ok: false, problem: 'too_few' });
		expect(checkFreePicks(optional, [pick('p1'), pick('p2'), pick('p3')], yes, no)).toEqual({
			ok: false,
			problem: 'too_many',
		});
		expect(checkFreePicks(freeWith({ take: 'upto', count: 1 }), [pick('p1'), pick('p3')], yes, no)).toEqual({
			ok: false,
			problem: 'too_many',
		});
	});
});
