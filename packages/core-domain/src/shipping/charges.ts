import type {
	CategoryShipping,
	ProductShippingCharges,
	ShippingChargeKind,
	ShippingCharges,
} from '@saha-textile/contracts';

/** Volumetric divisor (cm³ per kg) most couriers use: L × W × H ÷ 5,000. */
export const VOLUMETRIC_DIVISOR_CM3_PER_KG = 5000;

/**
 * Where a rule set's "product's own charge" comes from (owner, 2026-11-19): the product's own
 * value if set → its main category → the main category's parents, nearest first → the shop-wide
 * default. Weight and box follow the same chain when the product (or its variant) has none.
 */

export type ShippingChargeSource = 'product' | 'mainCategory' | 'parentCategory' | 'shopDefault';

export interface ResolvedShippingCharges {
	charges: ShippingCharges;
	/** Where each charge came from, for the product form's "From Sarees" hint and the overview checks. */
	sources: Record<ShippingChargeKind, { from: ShippingChargeSource; categoryId: string | null }>;
}

const PRODUCT_KEY: Record<ShippingChargeKind, keyof ProductShippingCharges> = {
	domestic: 'domesticINR',
	internationalFirst: 'internationalFirstINR',
	internationalFurther: 'internationalFurtherINR',
};

export interface CategoryShippingNode {
	id: string;
	shipping: CategoryShipping | null;
}

/**
 * @param categoryChain the main category first, then its parents nearest first (empty when the
 *   product has no main category).
 */
export function resolveShippingCharges(
	product: ProductShippingCharges | null,
	categoryChain: readonly CategoryShippingNode[],
	shopDefault: ShippingCharges,
): ResolvedShippingCharges {
	const kinds: ShippingChargeKind[] = ['domestic', 'internationalFirst', 'internationalFurther'];
	const charges = { ...shopDefault };
	const sources = {} as ResolvedShippingCharges['sources'];
	for (const kind of kinds) {
		const key = PRODUCT_KEY[kind];
		const own = product?.[key] ?? null;
		if (own !== null) {
			charges[kind] = own;
			sources[kind] = { from: 'product', categoryId: null };
			continue;
		}
		const index = categoryChain.findIndex((c) => (c.shipping?.[key] ?? null) !== null);
		const node = index >= 0 ? categoryChain[index] : undefined;
		if (node) {
			// findIndex picked this category because it sets this charge.
			charges[kind] = node.shipping?.[key] as number;
			sources[kind] = { from: index === 0 ? 'mainCategory' : 'parentCategory', categoryId: node.id };
			continue;
		}
		sources[kind] = { from: 'shopDefault', categoryId: null };
	}
	return { charges, sources };
}

export interface ShippingBox {
	weightGrams: number | null;
	lengthCm: number | null;
	widthCm: number | null;
	heightCm: number | null;
}

/** Volumetric weight in grams: L × W × H ÷ 5,000 kg; null unless all three sides are known. */
export function volumetricGrams(box: ShippingBox): number | null {
	const { lengthCm, widthCm, heightCm } = box;
	if (lengthCm === null || widthCm === null || heightCm === null) return null;
	if (lengthCm <= 0 || widthCm <= 0 || heightCm <= 0) return null;
	return Math.round(((lengthCm * widthCm * heightCm) / VOLUMETRIC_DIVISOR_CM3_PER_KG) * 1000);
}

/** Chargeable weight per unit: the larger of actual and volumetric; null when neither is known. */
export function chargeableGrams(box: ShippingBox): number | null {
	const volumetric = volumetricGrams(box);
	const actual = box.weightGrams !== null && box.weightGrams > 0 ? box.weightGrams : null;
	if (actual === null) return volumetric;
	if (volumetric === null) return actual;
	return Math.max(actual, volumetric);
}

/**
 * The first box that says anything, field by field: variant → product → main category → parents.
 * A field left empty at one level is taken from the next.
 */
export function resolveShippingBox(levels: ReadonlyArray<Partial<ShippingBox> | null | undefined>): ShippingBox {
	const pick = (key: keyof ShippingBox): number | null => {
		for (const level of levels) {
			const value = level?.[key];
			if (value !== null && value !== undefined && value > 0) return value;
		}
		return null;
	};
	return {
		weightGrams: pick('weightGrams'),
		lengthCm: pick('lengthCm'),
		widthCm: pick('widthCm'),
		heightCm: pick('heightCm'),
	};
}
