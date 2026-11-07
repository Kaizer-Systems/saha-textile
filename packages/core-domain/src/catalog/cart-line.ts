import type { CartAddonValue, CatalogProductPage } from '@saha-textile/contracts';

/** What a shopper chose on one cart line. */
export interface CartLineChoice {
	variationId: string | null;
	addons: readonly CartAddonValue[];
}

export interface PricedCartOption {
	code: string;
	termCode: string;
	group: string;
	value: string;
	role: 'named_add_on' | 'bundle_component_option';
	priceDeltaINR: number;
}

export interface PricedCartLine {
	sku: string;
	variationId: string | null;
	variantLabel: string | null;
	galleryIndex: number | null;
	/** The variant or bundle price, before add-ons. */
	basePriceINR: number;
	unitPriceINR: number;
	mrpINR: number | null;
	/** Units that can be bought now. Null means no limit: made to order, or a bundle. */
	available: number | null;
	buyable: boolean;
	options: PricedCartOption[];
	measurements: { code: string; label: string; value: number; unit: 'in' | 'cm' }[];
	components: { title: string; sku: string; priceINR: number }[];
}

export type CartLineRefusal = 'unknown_variant' | 'unknown_option' | 'measurements_required' | 'measurement_out_of_range';

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
	if (page.bundle) {
		const required = page.bundle.groups.flatMap((group) => group.components.filter((row) => row.required));
		return {
			sku: page.selected?.sku ?? page.slug,
			variationId: null,
			variantLabel: null,
			galleryIndex: null,
			basePriceINR: page.bundle.priceINR,
			mrpINR: null,
			available: null,
			buyable: required.every((row) => row.inStock),
		};
	}
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
	const base = baseRow(page, choice.variationId);
	if (!base) return { ok: false, reason: 'unknown_variant' };

	const groups = page.optionGroups.filter(
		(group) => group.role === 'named_add_on' || group.role === 'bundle_component_option',
	);
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
			role: group.role as PricedCartOption['role'],
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
			unitPriceINR: options.reduce((sum, option) => sum + option.priceDeltaINR, basePriceINR),
			options,
			measurements,
			components: (page.bundle?.groups ?? []).flatMap((group) =>
				group.components.map((row) => ({ title: row.title, sku: row.sku, priceINR: row.sellingINR })),
			),
		},
	};
}
