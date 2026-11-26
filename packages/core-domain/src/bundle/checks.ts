import { combinations, quoteBundle, type QuoteBundle } from './price';
import { splitShares } from './shares';

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
		| 'garment_band'
		| 'all_good';
	level?: string;
	key?: string;
	input?: string;
	/** For set_dearer: the picks, the set total and what the pieces cost separately. For garment_band: a piece's share
	 * of the set price (per piece) as the total, and its own price (per piece) as separately. */
	picks?: Record<string, string[]>;
	totalINR?: number;
	separatelyINR?: number;
}

export interface CheckItem {
	key: string;
	live: boolean;
	isBundle: boolean;
	inStock: boolean;
	/** A ready-made garment (HSN chapters 61 and 62), whose GST rate changes at ₹2,500 a piece. */
	garment?: boolean;
}

/** The ₹2,500-a-piece line where ready-made garments change GST rate (CA round 2, B2.9). */
export const GARMENT_BAND_INR = 2500;

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
	out.push(...garmentBand(input, now));
	if (!out.some((check) => check.severity === 'error')) out.push({ severity: 'ok', code: 'all_good' });
	return out;
}

/**
 * A garment piece whose share of the set price sits on the other side of ₹2,500 from its own price: billed at its
 * share (owner-final, 22 Nov 2026), its GST rate would differ from the piece sold alone. A warning only, until the CA
 * answers B2.9; each piece is named once, from the first combination that shows it.
 */
function garmentBand(input: CheckInput, now: Date): BundleCheck[] {
	const garments = new Set(
		[...input.levels.flatMap((level) => level.items), ...input.extras].filter((i) => i.garment).map((i) => i.key),
	);
	if (garments.size === 0) return [];
	const out: BundleCheck[] = [];
	const named = new Set<string>();
	for (const picks of combinations(input.bundle.levels, 500)) {
		const quote = quoteBundle(input.bundle, { picks }, now);
		if (!quote.ok) continue;
		const shares = splitShares(
			quote.setPriceINR,
			quote.pieces.map((piece) => ({ key: piece.key, weightINR: piece.priceInSetINR })),
		);
		for (const piece of quote.pieces) {
			if (!garments.has(piece.key) || named.has(piece.key)) continue;
			const quantity = Math.max(1, piece.quantity);
			// splitShares gives every piece it was handed a share.
			const share = (shares.get(piece.key) as number) / quantity;
			const own = piece.todayINR / quantity;
			if (share <= GARMENT_BAND_INR !== own <= GARMENT_BAND_INR) {
				named.add(piece.key);
				out.push({
					severity: 'warn',
					code: 'garment_band',
					key: piece.key,
					totalINR: Math.round(share * 100) / 100,
					separatelyINR: Math.round(own * 100) / 100,
				});
			}
		}
	}
	return out;
}

export const blocksGoLive = (checks: readonly BundleCheck[]): boolean =>
	checks.some((check) => check.severity === 'error');
