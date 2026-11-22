import { combinations, quoteBundle, type QuoteBundle } from './price';

/**
 * Checks before a bundle goes live (rev 1 S6/S7, rev 3 C09). Errors hold Go Live; warnings only inform. Words are
 * the admin's job (translated keys by `code`); this returns codes and numbers.
 */
export interface BundleCheck {
	severity: 'error' | 'warn' | 'ok';
	code:
		| 'no_levels'
		| 'level_empty'
		| 'level_takes_too_many'
		| 'level_sold_out'
		| 'item_not_live'
		| 'item_is_bundle'
		| 'input_missing'
		| 'method_inactive'
		| 'set_dearer'
		| 'set_dearer_kept'
		| 'all_good';
	level?: string;
	key?: string;
	input?: string;
	/** For set_dearer: the picks, the set total and what the pieces cost separately. */
	picks?: Record<string, string[]>;
	totalINR?: number;
	separatelyINR?: number;
}

export interface CheckItem {
	key: string;
	live: boolean;
	isBundle: boolean;
	inStock: boolean;
}

export interface CheckInput {
	bundle: QuoteBundle;
	levels: readonly { code: string; take: number; items: readonly CheckItem[] }[];
	extras: readonly CheckItem[];
	methodActive: boolean;
	/** The bundle priced with today's sale prices as "today" (Bought separately), to find dearer combinations. */
	dearerReason: string | null;
}

export function bundleChecks(input: CheckInput, now: Date = new Date()): BundleCheck[] {
	const out: BundleCheck[] = [];
	if (input.levels.length === 0) out.push({ severity: 'error', code: 'no_levels' });
	if (!input.methodActive) out.push({ severity: 'error', code: 'method_inactive' });
	for (const level of input.levels) {
		if (level.items.length === 0) out.push({ severity: 'error', code: 'level_empty', level: level.code });
		else if (level.take > level.items.length)
			out.push({ severity: 'error', code: 'level_takes_too_many', level: level.code });
		else if (level.items.filter((item) => item.inStock && item.live).length < level.take) {
			out.push({ severity: 'error', code: 'level_sold_out', level: level.code });
		}
		for (const item of level.items) {
			if (item.isBundle)
				out.push({ severity: 'error', code: 'item_is_bundle', level: level.code, key: item.key });
			else if (!item.live)
				out.push({ severity: 'error', code: 'item_not_live', level: level.code, key: item.key });
		}
	}
	for (const extra of input.extras) {
		if (extra.isBundle) out.push({ severity: 'error', code: 'item_is_bundle', key: extra.key });
		else if (!extra.live) out.push({ severity: 'error', code: 'item_not_live', key: extra.key });
	}
	const { method, params } = input.bundle;
	for (const field of method.inputs) {
		if (typeof params[field.code] !== 'number')
			out.push({ severity: 'error', code: 'input_missing', input: field.code });
	}
	if (out.length === 0) {
		// Every combination: the set must not cost more than its pieces bought separately today (sales included).
		for (const picks of combinations(input.bundle.levels, 2000)) {
			const quote = quoteBundle(input.bundle, { picks }, now);
			if (!quote.ok) continue;
			const piecesToday = quote.pieces.reduce((sum, piece) => sum + piece.todayINR, 0);
			if (quote.setPriceINR > piecesToday + 0.005) {
				out.push({
					severity: input.dearerReason ? 'warn' : 'error',
					code: input.dearerReason ? 'set_dearer_kept' : 'set_dearer',
					picks,
					totalINR: quote.setPriceINR,
					separatelyINR: piecesToday,
				});
				break;
			}
		}
	}
	if (!out.some((check) => check.severity === 'error')) out.push({ severity: 'ok', code: 'all_good' });
	return out;
}

export const blocksGoLive = (checks: readonly BundleCheck[]): boolean =>
	checks.some((check) => check.severity === 'error');
