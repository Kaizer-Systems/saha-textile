import type { CatalogVariantView } from '@data-access/interfaces/catalog-product.interface';

/**
 * F01 and the metre fields (shop brief A01): pure helpers the product form's Inventory tab
 * uses, kept apart so they are tested on their own.
 */

export type SoldBy = 'piece' | 'metre';

/** A typed length in metres → whole tenths, or null when it is not a 0.1 m step above 0 (P11). */
export function metresToTenths(text: string | number | null | undefined): number | null {
	const value = Number(
		String(text ?? '')
			.trim()
			.replace(',', '.'),
	);
	if (String(text ?? '').trim() === '' || !Number.isFinite(value) || value <= 0) return null;
	const tenths = Math.round(value * 10);
	return Math.abs(value * 10 - tenths) > 1e-9 ? null : tenths;
}

/** Tenths → "2.5" for a box that shows metres. */
export function tenthsToMetres(tenths: number | null | undefined): string {
	return tenths === null || tenths === undefined ? '' : (tenths / 10).toFixed(1);
}

/** On hand, held, in orders and free to sell, summed over the variants given (F01). */
export function stockFigures(
	variants: ReadonlyArray<Pick<CatalogVariantView, 'quantity' | 'held' | 'inOrders' | 'freeToSell'>>,
) {
	return variants.reduce(
		(sum, row) => ({
			onHand: sum.onHand + row.quantity,
			held: sum.held + (row.held ?? 0),
			inOrders: sum.inOrders + (row.inOrders ?? 0),
			free: sum.free + (row.freeToSell ?? row.quantity - (row.held ?? 0)),
		}),
		{ onHand: 0, held: 0, inOrders: 0, free: 0 },
	);
}

/** The shop's own low-stock level when a product sets none (core-domain SHOP_LOW_STOCK_THRESHOLD). */
export const SHOP_LOW_STOCK_LEVEL = 2;

/** Stock status as the shop works it out from free to sell (F01): made to order keeps selling. */
export function stockStatusKey(free: number, lowLevel: number | null, madeToOrder: boolean): string {
	if (madeToOrder) return 'stock_status_made_to_order';
	if (free <= 0) return 'stock_status_out';
	if (free <= (lowLevel ?? SHOP_LOW_STOCK_LEVEL)) return 'stock_status_low';
	return 'stock_status_in';
}

/** One category row as the form knows it: its HSN and returnability. */
export interface CategoryDefaults {
	id: string;
	name: string;
	hsnCode: string | null;
	returnable: boolean;
	/** The parent category, for charges a sub-category inherits (shipping brief prd01). */
	parentId?: string | null;
	/** The category's own shipping values (shipping brief prd01); null when it sets none. */
	shipping?: {
		domesticINR: number | null;
		internationalFirstINR: number | null;
		internationalFurtherINR: number | null;
	} | null;
}

/**
 * F02: what happens when the main (first) category changes. The HSN refills from the new
 * category; the popup opens only when that replaces a different code the product had. The
 * "Can be returned" choice goes back to following the new category (P13).
 */
export function categoryRefill(input: {
	previousMain: string | null;
	nextMain: string | null;
	currentHsn: string | null;
	categories: ReadonlyMap<string, CategoryDefaults>;
}): {
	hsn: string | null;
	popup: { category: string; oldCategory: string | null; oldHsn: string | null; newHsn: string } | null;
	followCategory: boolean;
} {
	const { previousMain, nextMain, currentHsn } = input;
	if (!nextMain || nextMain === previousMain) return { hsn: currentHsn, popup: null, followCategory: false };
	const next = input.categories.get(nextMain);
	const followCategory = previousMain !== null;
	if (!next?.hsnCode) return { hsn: currentHsn, popup: null, followCategory };
	if (!currentHsn || currentHsn === next.hsnCode) return { hsn: next.hsnCode, popup: null, followCategory };
	return {
		hsn: next.hsnCode,
		popup: {
			category: next.name,
			oldCategory: previousMain ? (input.categories.get(previousMain)?.name ?? null) : null,
			oldHsn: currentHsn,
			newHsn: next.hsnCode,
		},
		followCategory,
	};
}

/** What the metre fields need before a save (A01): a problem key, or null. */
export function metreProblem(input: {
	shortestCut: string;
	weightPerMetre: string;
	width: string;
	quickLengths: ReadonlyArray<{ length: string; label: Record<string, string> }>;
}): string | null {
	const cut = metresToTenths(input.shortestCut);
	if (cut === null) return 'metre_cut_invalid';
	const weight = Number(input.weightPerMetre);
	if (!input.weightPerMetre.trim() || !Number.isInteger(weight) || weight <= 0) return 'metre_weight_invalid';
	if (input.width.trim() && !(Number(input.width) > 0 && Number(input.width) <= 200)) return 'metre_width_invalid';
	if (input.quickLengths.length > 4) return 'metre_quick_too_many';
	for (const row of input.quickLengths) {
		const tenths = metresToTenths(row.length);
		if (tenths === null) return 'metre_quick_invalid';
		if (tenths < cut) return 'metre_quick_below_cut';
		if (!row.label['en']?.trim()) return 'metre_quick_label_missing';
	}
	return null;
}
