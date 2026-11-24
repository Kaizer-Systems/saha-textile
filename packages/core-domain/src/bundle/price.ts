import type {
	BundleMethodBase,
	BundleMethodInput,
	BundlePriceRule,
	BundleRuleAction,
	BundleRuleCombine,
	SaleRule,
} from '@saha-textile/contracts';

import { applySaleRule } from './sale-rule';
import { OFFER_ACTIONS, actionsFor, amountOf, type BundleFacts } from './rules';

/**
 * A set's price (owner decisions 21–22 Nov 2026). The set's price method (a record from the price method list)
 * says where the price starts and which rules adjust it; the set's own rules follow. Optional extras add their
 * own price after that. Everything the shop shows, the admin preview and checkout come from this one function.
 *
 * - `fixed` base: the amount typed on the set. A choice level then follows its price mode: `difference` (a pick
 *   dearer than the level's included pieces adds the difference, a cheaper one is "Included"), `included` (picks
 *   never change the price) or `own` (each pick adds its own price in the set).
 * - `pieces` base: the chosen pieces added up, each at its Price in this set.
 * - Actions run in order on the running price: priceIs, priceIsPieces, percentOff, amountOff. makePickFree and
 *   makeExtraFree take an item's price out; limitLevel, hideItem and requireExtra change what can be chosen.
 */

export interface QuoteItem {
	key: string;
	/** Pieces, or tenths of a metre. */
	quantity: number;
	/** Price in this set, per unit (its override, else its selling price). */
	priceInSetINR: number;
	/** What one unit costs bought on its own today: the sale price while a sale runs, else the selling price. */
	todayINR: number;
	onSale: boolean;
	/** Metre lines price per metre; quantity is then tenths. */
	perTenth?: boolean;
}

export interface QuoteLevel {
	code: string;
	take: number;
	priceMode: 'difference' | 'included' | 'own';
	items: readonly QuoteItem[];
}

export interface QuoteMethod {
	base: BundleMethodBase;
	inputs: readonly BundleMethodInput[];
	rules: readonly BundlePriceRule[];
	combine: BundleRuleCombine;
}

export interface QuoteBundle {
	levels: readonly QuoteLevel[];
	extras: readonly QuoteItem[];
	method: QuoteMethod;
	params: Readonly<Record<string, number>>;
	rules: readonly BundlePriceRule[];
	combine: BundleRuleCombine;
	capAtSeparately: boolean;
	roundTo: 'none' | 'one' | 'ten';
	/** Running sale events that include sets and reach this one; the lowest price they give wins. */
	eventSale?: readonly SaleRule[];
}

export interface QuoteChoice {
	picks?: Readonly<Record<string, readonly string[]>>;
	extras?: readonly string[];
}

export type QuoteProblem =
	| { kind: 'level_empty'; level: string }
	| { kind: 'pick_count'; level: string; take: number }
	| { kind: 'pick_not_offered'; level: string; key: string }
	| { kind: 'extra_required'; key: string }
	| { kind: 'input_missing'; input: string };

export interface QuotedPiece {
	level: string;
	key: string;
	quantity: number;
	/** Line totals. */
	priceInSetINR: number;
	todayINR: number;
	free: boolean;
}

export interface QuotedExtra {
	key: string;
	quantity: number;
	priceINR: number;
	todayINR: number;
	free: boolean;
}

export interface BundleQuote {
	ok: boolean;
	problems: QuoteProblem[];
	pieces: QuotedPiece[];
	extras: QuotedExtra[];
	/** What each level offers after the rules (limitLevel, hideItem), and the extras the rules require. */
	offered: Record<string, string[]>;
	requiredExtras: string[];
	/** Pieces at their Price in this set, added up. */
	subtotalINR: number;
	/** The set price for the pieces, after the method, the set's rules and a running sale event. */
	setPriceINR: number;
	/** The set price before a sale event lowered it; null when no event did. */
	beforeEventINR: number | null;
	extrasINR: number;
	/** What the shopper pays for one set. */
	totalINR: number;
	/** The chosen pieces and extras bought separately today. */
	separatelyINR: number;
	saveINR: number;
	/** Rule ids that ran, for "Try it". */
	applied: string[];
}

const lineOf = (item: QuoteItem, unit: number): number =>
	item.perTenth ? Math.round(unit * item.quantity * 10) / 100 : unit * item.quantity;

/** A record built from the bundle's levels has an entry for every level's code. */
const ofLevel = <T>(record: Readonly<Record<string, T>>, level: Pick<QuoteLevel, 'code'>): T => record[level.code] as T;

/** One of the level's own items: picks only ever hold the level's own keys (`picksOf`, `includedKeys`). */
const itemOf = (level: QuoteLevel, key: string): QuoteItem => level.items.find((row) => row.key === key) as QuoteItem;

export const isChoiceLevel = (level: Pick<QuoteLevel, 'take' | 'items'>): boolean => level.items.length > level.take;

/** A choice level's included pieces: its first `take` offered items. */
export function includedKeys(level: QuoteLevel, offered: readonly string[] = level.items.map((i) => i.key)): string[] {
	return level.items
		.map((item) => item.key)
		.filter((key) => offered.includes(key))
		.slice(0, level.take);
}

/** Today in India, for date rules. */
export function istToday(now: Date = new Date()): string {
	return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

function round(value: number, to: QuoteBundle['roundTo']): number {
	if (to === 'one') return Math.round(value);
	if (to === 'ten') return Math.round(value / 10) * 10;
	return Math.round(value * 100) / 100;
}

/** The picks a level takes for a choice: fixed levels take all; choice levels take the asked ones, else the included. */
function picksOf(level: QuoteLevel, asked: readonly string[] | undefined, offered: readonly string[]): string[] {
	if (!isChoiceLevel(level)) return level.items.map((item) => item.key);
	const own = new Set(level.items.map((item) => item.key));
	const wanted = [...new Set((asked ?? []).filter((key) => own.has(key)))];
	return wanted.length ? wanted : includedKeys(level, offered);
}

function factsFor(
	bundle: QuoteBundle,
	picks: Record<string, string[]>,
	extras: readonly string[],
	today: string,
): BundleFacts {
	let count = 0;
	let subtotal = 0;
	let separately = 0;
	let onSale = false;
	for (const level of bundle.levels) {
		for (const key of ofLevel(picks, level)) {
			const item = itemOf(level, key);
			count += item.perTenth ? 1 : item.quantity;
			subtotal += lineOf(item, item.priceInSetINR);
			separately += lineOf(item, item.todayINR);
			onSale ||= item.onSale;
		}
	}
	return {
		piecesCount: count,
		piecesSubtotal: subtotal,
		piecesSeparately: separately,
		picks,
		extras,
		anyPieceOnSale: onSale,
		today,
	};
}

/** The price of one set for a choice. Never throws: problems come back in `problems` with `ok: false`. */
export function quoteBundle(bundle: QuoteBundle, choice: QuoteChoice = {}, now: Date = new Date()): BundleQuote {
	const today = istToday(now);
	const problems: QuoteProblem[] = [];
	const askedExtras = [...new Set(choice.extras ?? [])].filter((key) => bundle.extras.some((e) => e.key === key));

	// 1. First picks with everything offered, then the offer rules (limitLevel, hideItem, requireExtra) on them.
	const allOffered: Record<string, string[]> = Object.fromEntries(
		bundle.levels.map((level) => [level.code, level.items.map((item) => item.key)]),
	);
	let picks: Record<string, string[]> = Object.fromEntries(
		bundle.levels.map((level) => [
			level.code,
			picksOf(level, choice.picks?.[level.code], ofLevel(allOffered, level)),
		]),
	);
	const firstFacts = factsFor(bundle, picks, askedExtras, today);
	const offerActions = [
		...actionsFor(bundle.method.rules, bundle.method.combine, firstFacts).actions,
		...actionsFor(bundle.rules, bundle.combine, firstFacts).actions,
	].filter((action) => OFFER_ACTIONS.has(action.kind));
	const offered: Record<string, string[]> = { ...allOffered };
	const requiredExtras = new Set<string>();
	for (const action of offerActions) {
		if (action.kind === 'requireExtra') action.items.forEach((key) => requiredExtras.add(key));
		const current = action.level ? offered[action.level] : undefined;
		if (!action.level || !current) continue;
		if (action.kind === 'limitLevel') offered[action.level] = current.filter((k) => action.items.includes(k));
		if (action.kind === 'hideItem') offered[action.level] = current.filter((k) => !action.items.includes(k));
	}
	picks = Object.fromEntries(
		bundle.levels.map((level) => [level.code, picksOf(level, choice.picks?.[level.code], ofLevel(offered, level))]),
	);
	for (const level of bundle.levels) {
		if (level.items.length === 0) problems.push({ kind: 'level_empty', level: level.code });
		const chosen = ofLevel(picks, level);
		if (isChoiceLevel(level) && chosen.length !== level.take) {
			problems.push({ kind: 'pick_count', level: level.code, take: level.take });
		}
		for (const key of chosen) {
			if (!ofLevel(offered, level).includes(key))
				problems.push({ kind: 'pick_not_offered', level: level.code, key });
		}
	}
	const extrasChosen = [...new Set([...askedExtras, ...requiredExtras])].filter((key) =>
		bundle.extras.some((extra) => extra.key === key),
	);
	for (const key of requiredExtras) {
		if (!askedExtras.includes(key)) problems.push({ kind: 'extra_required', key });
	}
	if (bundle.method.base.kind === 'fixed' && typeof bundle.params[bundle.method.base.input] !== 'number') {
		problems.push({ kind: 'input_missing', input: bundle.method.base.input });
	}

	// 2. Price actions from the method's rules, then the set's own rules, on the final picks.
	const facts = factsFor(bundle, picks, extrasChosen, today);
	const fromMethod = actionsFor(bundle.method.rules, bundle.method.combine, facts);
	const fromSet = actionsFor(bundle.rules, bundle.combine, facts);
	const priceActions: BundleRuleAction[] = [...fromMethod.actions, ...fromSet.actions].filter(
		(action) => !OFFER_ACTIONS.has(action.kind),
	);
	const freePicks = new Set(priceActions.filter((a) => a.kind === 'makePickFree').flatMap((a) => a.items));
	const freeExtras = new Set(priceActions.filter((a) => a.kind === 'makeExtraFree').flatMap((a) => a.items));

	const pieces: QuotedPiece[] = [];
	let subtotal = 0;
	let separately = 0;
	let running = 0;
	const fixed = bundle.method.base.kind === 'fixed';
	if (fixed) running = bundle.params[(bundle.method.base as { input: string }).input] ?? 0;
	for (const level of bundle.levels) {
		const chosen = ofLevel(picks, level);
		const priceOf = (keys: readonly string[]) =>
			keys.reduce((sum, key) => {
				const item = itemOf(level, key);
				return freePicks.has(key) ? sum : sum + lineOf(item, item.priceInSetINR);
			}, 0);
		for (const key of chosen) {
			const item = itemOf(level, key);
			const free = freePicks.has(key);
			const inSet = free ? 0 : lineOf(item, item.priceInSetINR);
			pieces.push({
				level: level.code,
				key,
				quantity: item.quantity,
				priceInSetINR: inSet,
				todayINR: lineOf(item, item.todayINR),
				free,
			});
			subtotal += inSet;
			separately += lineOf(item, item.todayINR);
		}
		if (!fixed) continue;
		if (!isChoiceLevel(level)) continue;
		if (level.priceMode === 'own') running += priceOf(chosen);
		else if (level.priceMode === 'difference') {
			running += Math.max(0, priceOf(chosen) - priceOf(includedKeys(level, ofLevel(offered, level))));
		}
	}
	const piecesPaid = subtotal;
	if (!fixed) running = piecesPaid;

	for (const action of priceActions) {
		const amount = amountOf(action.amount, bundle.params);
		switch (action.kind) {
			case 'priceIs':
				if (amount !== null) running = Math.max(0, amount);
				break;
			case 'priceIsPieces':
				running = piecesPaid;
				break;
			case 'percentOff':
				if (amount !== null) running = Math.max(0, running * (1 - Math.min(100, Math.max(0, amount)) / 100));
				break;
			case 'amountOff':
				if (amount !== null) running = Math.max(0, running - Math.max(0, amount));
				break;
			default:
				break;
		}
	}

	const extras: QuotedExtra[] = extrasChosen.map((key) => {
		// extrasChosen keeps only the bundle's own extras.
		const item = bundle.extras.find((row) => row.key === key) as QuoteItem;
		const free = freeExtras.has(key) || item.priceInSetINR === 0;
		return {
			key,
			quantity: item.quantity,
			priceINR: free ? 0 : lineOf(item, item.priceInSetINR),
			todayINR: lineOf(item, item.todayINR),
			free,
		};
	});
	const extrasINR = extras.reduce((sum, extra) => sum + extra.priceINR, 0);
	const extrasToday = extras.reduce((sum, extra) => sum + extra.todayINR, 0);

	if (bundle.capAtSeparately) running = Math.min(running, separately);
	const ownPriceINR = round(running, bundle.roundTo);
	// A sale event that includes sets works on the set's own price, after its rules (owner, 2026-11-23).
	const eventINR = lowestEventPrice(bundle.eventSale ?? [], ownPriceINR);
	const setPriceINR = eventINR ?? ownPriceINR;
	const totalINR = round(setPriceINR + extrasINR, 'none');
	const separatelyAll = round(separately + extrasToday, 'none');
	return {
		ok: problems.length === 0,
		problems,
		pieces,
		extras,
		offered,
		requiredExtras: [...requiredExtras],
		subtotalINR: round(subtotal, 'none'),
		setPriceINR,
		beforeEventINR: eventINR === null ? null : ownPriceINR,
		extrasINR: round(extrasINR, 'none'),
		totalINR,
		separatelyINR: separatelyAll,
		saveINR: Math.max(0, round(separatelyAll - totalINR, 'none')),
		applied: [...fromMethod.applied, ...fromSet.applied],
	};
}

/** The lowest price the running events give a set price, or null when none lowers it. */
function lowestEventPrice(rules: readonly SaleRule[], priceINR: number): number | null {
	let best: number | null = null;
	for (const rule of rules) {
		const price = applySaleRule(rule, priceINR, '');
		if (price !== null && (best === null || price < best)) best = price;
	}
	return best;
}

/** Every full combination of picks (each choice level's `take`-sized subsets), up to `limit`. */
export function combinations(
	levels: readonly Pick<QuoteLevel, 'code' | 'take' | 'items'>[],
	limit = 5000,
): Record<string, string[]>[] {
	const optionsOf = (level: Pick<QuoteLevel, 'code' | 'take' | 'items'>): string[][] => {
		const keys = level.items.map((item) => item.key);
		if (!isChoiceLevel(level)) return [keys];
		const out: string[][] = [];
		const walk = (start: number, acc: string[]) => {
			if (out.length >= limit) return;
			if (acc.length === level.take) {
				out.push([...acc]);
				return;
			}
			keys.slice(start).forEach((key, at) => walk(start + at + 1, [...acc, key]));
		};
		walk(0, []);
		return out;
	};
	let result: Record<string, string[]>[] = [{}];
	for (const level of levels) {
		const options = optionsOf(level);
		const next: Record<string, string[]>[] = [];
		for (const partial of result) {
			for (const pick of options) {
				if (next.length >= limit) break;
				next.push({ ...partial, [level.code]: pick });
			}
		}
		result = next;
	}
	return levels.length ? result : [];
}

/** The lowest and highest price a set can come to over its combinations (for "From ₹" and the Go Live checks). */
export function priceRange(bundle: QuoteBundle, now: Date = new Date()): { low: number; high: number; count: number } {
	const combos = combinations(bundle.levels, 2000);
	let low = Number.POSITIVE_INFINITY;
	let high = 0;
	let count = 0;
	for (const picks of combos) {
		const quote = quoteBundle(bundle, { picks }, now);
		if (!quote.ok) continue;
		count += 1;
		low = Math.min(low, quote.totalINR);
		high = Math.max(high, quote.totalINR);
	}
	return count ? { low, high, count } : { low: 0, high: 0, count: 0 };
}
