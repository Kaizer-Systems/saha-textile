import type { BundleChoice, CartAddonValue, CatalogProductPage, FreePick } from '@saha-textile/contracts';

import { priceBundleLine, productFreeChildren, type ChildRefusal, type PricedChild } from './cart-bundle';

/** What a shopper chose on one cart line. */
export interface CartLineChoice {
	variationId: string | null;
	addons: readonly CartAddonValue[];
	/** A set's choices (bundle builder brief). */
	bundle?: BundleChoice | null;
	/** A product's own free items picked (P8). */
	free?: readonly FreePick[];
}

export interface PricedCartOption {
	code: string;
	termCode: string;
	group: string;
	value: string;
	priceDeltaINR: number;
}

export interface PricedCartLine {
	sku: string;
	variationId: string | null;
	variantLabel: string | null;
	galleryIndex: number | null;
	/** The variant price, before add-ons. */
	basePriceINR: number;
	unitPriceINR: number;
	mrpINR: number | null;
	/** Units that can be bought now. Null means no limit, as for made to order. */
	available: number | null;
	buyable: boolean;
	/** Pieces, or fabric by the metre: then quantities are tenths and `basePriceINR` is per metre. */
	soldBy: 'piece' | 'metre';
	shortestCutTenths: number | null;
	options: PricedCartOption[];
	measurements: { code: string; label: string; value: number; unit: 'in' | 'cm' }[];
	/** A set's pieces, their free items and extras, or a product's own free items. */
	children: PricedChild[];
}

export type CartLineRefusal =
	ChildRefusal | 'unknown_variant' | 'unknown_option' | 'measurements_required' | 'measurement_out_of_range';

const NO_CHOICE: BundleChoice = { picks: {}, variants: {}, extras: [], free: {} };

export type CartLinePricing = { ok: true; line: PricedCartLine } | { ok: false; reason: CartLineRefusal };

interface BaseRow {
	sku: string;
	variationId: string | null;
	variantLabel: string | null;
	galleryIndex: number | null;
	basePriceINR: number;
	mrpINR: number | null;
	available: number | null;
	buyable: boolean;
}

function variantLabel(page: CatalogProductPage, selections: Readonly<Record<string, string>>): string {
	return page.optionGroups
		.filter((group) => group.role === 'variation_axis')
		.flatMap((group) => group.terms.find((term) => term.code === selections[group.code])?.label ?? [])
		.join(' / ');
}

function baseRow(page: CatalogProductPage, variationId: string | null): BaseRow | null {
	if (page.variants.length > 0) {
		const row = page.variants.find((variant) => variant.id === variationId);
		if (!row) return null;
		return {
			sku: row.sku,
			variationId: row.id,
			variantLabel: variantLabel(page, row.selections),
			galleryIndex: row.galleryIndex,
			basePriceINR: row.sellingINR,
			mrpINR: row.mrpINR,
			available: page.madeToOrder ? null : row.quantity,
			buyable: row.buyable,
		};
	}
	if (!page.selected) return null;
	return {
		sku: page.selected.sku,
		variationId: null,
		variantLabel: null,
		galleryIndex: null,
		basePriceINR: page.selected.sellingINR,
		mrpINR: page.selected.mrpINR,
		available: page.madeToOrder ? null : page.selected.quantity,
		buyable: page.selected.buyable,
	};
}

/**
 * The one place a cart line gets its price. It reads the same page model the product page shows,
 * so a shopper is charged what they saw, and nothing the browser sends can change it.
 */
export function priceCartLine(page: CatalogProductPage, choice: CartLineChoice): CartLinePricing {
	// A set (bundle builder brief, approved 2026-11-22): priced by core's engine; its pieces become children.
	if (page.bundle) {
		const set = priceBundleLine(page.bundle, choice.bundle ?? NO_CHOICE);
		if (!set.ok) return { ok: false, reason: set.reason };
		return {
			ok: true,
			line: {
				sku: page.selected?.sku ?? page.slug,
				variationId: null,
				variantLabel: null,
				galleryIndex: null,
				basePriceINR: set.totalINR,
				unitPriceINR: set.totalINR,
				mrpINR: set.separatelyINR > set.totalINR ? set.separatelyINR : null,
				available: page.bundle.stock.setsPossible,
				buyable: page.bundle.buyable,
				soldBy: 'piece',
				shortestCutTenths: null,
				options: [],
				measurements: [],
				children: set.children,
			},
		};
	}
	const free = productFreeChildren(page.freeWith ?? null, choice.free ?? []);
	if (!free.ok) return { ok: false, reason: free.reason };
	const base = baseRow(page, choice.variationId);
	if (!base) return { ok: false, reason: 'unknown_variant' };

	const groups = page.optionGroups.filter((group) => group.role === 'named_add_on');
	const fields = page.measurements?.fields ?? [];
	const picked = new Map(choice.addons.map((addon) => [addon.code, addon.value]));
	for (const code of picked.keys()) {
		if (!groups.some((group) => group.code === code) && !fields.some((field) => field.code === code)) {
			return { ok: false, reason: 'unknown_option' };
		}
	}

	const options: PricedCartOption[] = [];
	let measured = false;
	for (const group of groups) {
		const termCode = picked.get(group.code) ?? group.defaultTermCode ?? group.terms[0]?.code;
		const term = group.terms.find((row) => row.code === termCode);
		if (!term) return { ok: false, reason: 'unknown_option' };
		measured ||= term.requiresMeasurements;
		options.push({
			code: group.code,
			termCode: term.code,
			group: group.label,
			value: term.label,
			priceDeltaINR: term.priceDeltaINR ?? 0,
		});
	}

	const measurements: PricedCartLine['measurements'] = [];
	for (const field of measured ? fields : []) {
		const value = picked.get(field.code);
		if (typeof value !== 'number') return { ok: false, reason: 'measurements_required' };
		if ((field.min !== null && value < field.min) || (field.max !== null && value > field.max)) {
			return { ok: false, reason: 'measurement_out_of_range' };
		}
		measurements.push({ code: field.code, label: field.label, value, unit: field.unit });
	}

	const { basePriceINR } = base;
	return {
		ok: true,
		line: {
			...base,
			soldBy: page.soldBy ?? 'piece',
			shortestCutTenths: page.metre?.shortestCutTenths ?? null,
			unitPriceINR: options.reduce((sum, option) => sum + option.priceDeltaINR, basePriceINR),
			options,
			measurements,
			children: free.children,
		},
	};
}

/** The most pieces one shop line may hold (a boutique, not wholesale). */
export const MAX_PIECES_PER_LINE = 99;

/**
 * A line's total. Pieces: unit price (variant plus add-ons) × pieces. Metres: price per metre ×
 * length, rounded to the paisa, plus add-ons once (shop brief: "charged once per line, not per
 * metre", as blouse stitching on a fabric line).
 */
export function cartLineTotalINR(line: PricedCartLine, quantity: number): number {
	if (line.soldBy !== 'metre') return line.unitPriceINR * quantity;
	const addOns = line.options.reduce((sum, option) => sum + option.priceDeltaINR, 0);
	// Whole paise first, so 2.3 m of ₹175.50 a metre is ₹403.65, never a float like 403.6499.
	const paise = Math.round((Math.round(line.basePriceINR * 100) * quantity) / 10);
	return paise / 100 + addOns;
}

/** Why a quantity cannot go on the line: too many pieces, or a cut below the shortest (M04). */
export function cartQuantityProblem(
	line: Pick<PricedCartLine, 'soldBy' | 'shortestCutTenths'>,
	quantity: number,
): 'too_many_pieces' | 'below_shortest_cut' | null {
	if (line.soldBy !== 'metre') return quantity > MAX_PIECES_PER_LINE ? 'too_many_pieces' : null;
	return line.shortestCutTenths !== null && quantity < line.shortestCutTenths ? 'below_shortest_cut' : null;
}
