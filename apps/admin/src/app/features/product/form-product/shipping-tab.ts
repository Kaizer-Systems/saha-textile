import { resolveShippingCharges, routeShippingLine } from '@saha-textile/core-domain/shipping';

import type { CategoryDefaults } from './inventory-fields';
import type {
	CategoryShipping,
	ShippingChargeKind,
	ShippingCharges,
	ShippingException,
	ShippingExceptionChoice,
	ShippingSettings,
	ShippingZone,
} from '@saha-textile/contracts';

/**
 * Product › Shipping & tax (shipping brief prd01): what a product inherits when its charges follow
 * the category, and which exception (if any) decides each zone for it. The same resolution as the
 * engine (`resolveShippingCharges`, `routeShippingLine`), so the form never disagrees with checkout.
 */

/** Charges only: the box values don't take part in resolving a charge. */
const NO_BOX = { weightGrams: null, lengthCm: null, widthCm: null, heightCm: null };

/** The main category, then its parents nearest first; stops on a loop or a missing row. */
export function categoryChain(mainId: string | null, rows: ReadonlyMap<string, CategoryDefaults>): string[] {
	const chain: string[] = [];
	let id = mainId;
	while (id && !chain.includes(id)) {
		chain.push(id);
		id = rows.get(id)?.parentId ?? null;
	}
	return chain;
}

export interface InheritedCharge {
	amountINR: number | null;
	/** The category the value comes from; null when it is the shop-wide default (or not known yet). */
	fromCategory: string | null;
}

/** The value a product gets for one charge when its "use the category's value" switch is on. */
export function inheritedCharge(
	kind: ShippingChargeKind,
	chain: readonly string[],
	rows: ReadonlyMap<string, CategoryDefaults>,
	shopDefault: ShippingCharges | null,
): InheritedCharge {
	const nodes = chain.map((id) => {
		const own = rows.get(id)?.shipping ?? null;
		const shipping: CategoryShipping | null = own ? { ...NO_BOX, ...own } : null;
		return { id, shipping };
	});
	const fallback: ShippingCharges = shopDefault ?? { domestic: 0, internationalFirst: 0, internationalFurther: 0 };
	const resolved = resolveShippingCharges(null, nodes, fallback);
	const source = resolved.sources[kind];
	if (source.categoryId !== null) {
		return { amountINR: resolved.charges[kind], fromCategory: rows.get(source.categoryId)?.name ?? null };
	}
	return { amountINR: shopDefault ? resolved.charges[kind] : null, fromCategory: null };
}

export interface ProductZoneException {
	zone: ShippingZone;
	choice: ShippingExceptionChoice;
}

/**
 * The zones an exception decides for this product (its own, its main category's, or a parent's
 * that includes sub-categories). The Free shipping switch and "India only" are not exceptions.
 */
export function productExceptions(
	productId: string | null,
	chain: readonly string[],
	settings: Pick<ShippingSettings, 'domestic' | 'international' | 'abroadPolicy'> | null,
	exceptions: readonly ShippingException[],
): ProductZoneException[] {
	if (!settings || exceptions.length === 0) return [];
	const line = {
		productId: productId ?? '',
		mainCategoryId: chain[0] ?? null,
		mainCategoryAncestorIds: chain.slice(1),
		freeShipping: false,
	};
	const zones: ShippingZone[] = ['domestic', 'international'];
	return zones.flatMap((zone) => {
		// "India only" is a shop setting, not an exception: route as if abroad were allowed.
		const { via } = routeShippingLine(
			line,
			zone,
			{ ...settings, abroadPolicy: 'exportOffIndianInvoice' },
			exceptions,
		);
		if (via.kind !== 'productException' && via.kind !== 'categoryException') return [];
		const exception = exceptions.find((e) => e.id === via.exceptionId);
		if (!exception) return [];
		return [{ zone, choice: zone === 'domestic' ? exception.domestic : exception.international }];
	});
}
