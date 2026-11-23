import type {
	BundleChoice,
	CatalogPageBundle,
	CatalogPageBundleItem,
	CatalogPageFreeWith,
	FreePick,
} from '@saha-textile/contracts';

import { quoteBundle, type QuoteBundle, type QuoteItem } from '../bundle/price';
import { splitShares } from '../bundle/shares';

/**
 * A set or a product with free items, as a cart line (bundle builder brief E01–E04, approved 2026-11-22). The server
 * prices a set from the page model the shopper saw, with core's own engine; each piece carries its share of the set
 * price (owner-final: in proportion to its Price in this set), free items are ₹0, extras their own price.
 */

export interface PricedChild {
	role: 'piece' | 'free' | 'extra';
	key: string;
	parentKey: string | null;
	level: string | null;
	productId: string;
	title: string;
	sku: string;
	variantId: string | null;
	variantLabel: string | null;
	quantity: number;
	priceINR: number;
	mrpINR: number | null;
}

export type ChildRefusal = 'bundle_incomplete' | 'size_needed' | 'free_choice_needed' | 'bundle_not_on_sale';

/** A set's page model in the shape the engine prices. */
export function quoteFromPage(bundle: CatalogPageBundle): QuoteBundle {
	const item = (row: CatalogPageBundleItem): QuoteItem => ({
		key: row.key,
		quantity: row.quantity,
		priceInSetINR: row.priceInSetINR,
		todayINR: row.todayINR,
		onSale: row.saleINR !== null,
		perTenth: row.soldBy === 'metre',
	});
	const p = bundle.pricing;
	return {
		levels: bundle.levels.map((level) => ({
			code: level.code,
			take: level.take,
			priceMode: level.priceMode,
			items: level.items.map(item),
		})),
		extras: bundle.extras.map(item),
		method: { base: p.base, inputs: p.inputs, rules: p.methodRules, combine: p.methodCombine },
		params: p.params,
		rules: p.rules,
		combine: p.combine,
		capAtSeparately: p.capAtSeparately,
		roundTo: p.roundTo,
		eventSale: p.eventSale ?? [],
	};
}

/**
 * The free items a piece or product gives for these picks: given ones are filled in (sold-out ones drop out, D4);
 * a choice must hold between min and max in-stock items, each with a size when it has sizes. Null: not acceptable.
 */
export function freeItemsFor(rule: CatalogPageFreeWith | null, picks: readonly FreePick[]): FreePick[] | null {
	if (!rule) return [];
	const sizeOk = (item: CatalogPageFreeWith['items'][number], variantId: string | null) =>
		item.variantId !== null ||
		item.variants.length === 0 ||
		item.variants.some((v) => v.id === variantId && v.inStock);
	if (rule.given) {
		const out: FreePick[] = [];
		for (const item of rule.items.filter((row) => row.inStock)) {
			const asked = picks.find((pick) => pick.productId === item.productId)?.variantId ?? null;
			if (!sizeOk(item, asked)) return null;
			out.push({ productId: item.productId, variantId: item.variantId ?? asked });
		}
		return out;
	}
	const seen = new Set<string>();
	const out: FreePick[] = [];
	for (const pick of picks) {
		const item = rule.items.find((row) => row.productId === pick.productId);
		if (!item || !item.inStock || seen.has(pick.productId) || !sizeOk(item, pick.variantId)) return null;
		seen.add(pick.productId);
		out.push({ productId: item.productId, variantId: item.variantId ?? pick.variantId });
	}
	if (rule.noneOrExactly) return out.length === 0 || out.length === rule.max ? out : null;
	return out.length >= rule.min && out.length <= rule.max ? out : null;
}

const freeChildren = (
	rule: CatalogPageFreeWith,
	picks: readonly FreePick[],
	parentKey: string | null,
	perUnit: number,
): PricedChild[] =>
	picks.flatMap((pick) => {
		const item = rule.items.find((row) => row.productId === pick.productId);
		if (!item) return [];
		const variant = item.variants.find((v) => v.id === pick.variantId);
		return [
			{
				role: 'free' as const,
				key: `${parentKey ?? 'product'}>${item.productId}`,
				parentKey,
				level: null,
				productId: item.productId,
				title: item.title,
				sku: item.productId,
				variantId: pick.variantId,
				variantLabel: item.variantLabel ?? variant?.label ?? null,
				quantity: item.quantity * perUnit,
				priceINR: 0,
				mrpINR: item.mrpINR,
			},
		];
	});

/** A product's own free items as cart children (P8). */
export function productFreeChildren(
	rule: CatalogPageFreeWith | null,
	picks: readonly FreePick[],
): { ok: true; children: PricedChild[] } | { ok: false; reason: ChildRefusal } {
	if (!rule) return { ok: true, children: [] };
	const chosen = freeItemsFor(rule, picks);
	if (chosen === null) return { ok: false, reason: 'free_choice_needed' };
	return { ok: true, children: freeChildren(rule, chosen, null, 1) };
}

/** A set as a cart line: its price for these choices and the rows beneath it. */
export function priceBundleLine(
	bundle: CatalogPageBundle,
	choice: BundleChoice,
	now: Date = new Date(),
):
	| { ok: true; totalINR: number; children: PricedChild[]; separatelyINR: number; saleLowered: boolean }
	| { ok: false; reason: ChildRefusal } {
	if (!bundle.buyable) return { ok: false, reason: 'bundle_not_on_sale' };
	const quote = quoteBundle(quoteFromPage(bundle), { picks: choice.picks, extras: choice.extras }, now);
	if (!quote.ok) return { ok: false, reason: 'bundle_incomplete' };
	const items = new Map<string, { item: CatalogPageBundleItem; level: string | null }>();
	for (const level of bundle.levels) for (const item of level.items) items.set(item.key, { item, level: level.code });
	for (const item of bundle.extras) items.set(item.key, { item, level: null });
	const shares = splitShares(
		quote.setPriceINR,
		quote.pieces.map((piece) => ({ key: piece.key, weightINR: piece.priceInSetINR })),
	);
	const children: PricedChild[] = [];
	const row = (role: 'piece' | 'extra', key: string, priceINR: number): ChildRefusal | null => {
		const found = items.get(key);
		if (!found || !found.item.inStock) return 'bundle_incomplete';
		const { item, level } = found;
		const variantId = item.variantId ?? choice.variants[key] ?? null;
		if (
			item.variantId === null &&
			item.variants.length > 0 &&
			!item.variants.some((v) => v.id === variantId && v.inStock)
		) {
			return 'size_needed';
		}
		children.push({
			role,
			key,
			parentKey: null,
			level,
			productId: item.productId,
			title: item.title,
			sku: item.sku,
			variantId,
			variantLabel: item.variantLabel ?? item.variants.find((v) => v.id === variantId)?.label ?? null,
			quantity: item.quantity,
			priceINR,
			mrpINR: item.mrpINR,
		});
		if (item.freeWith) {
			const chosen = freeItemsFor(item.freeWith, choice.free[key] ?? []);
			if (chosen === null) return 'free_choice_needed';
			children.push(...freeChildren(item.freeWith, chosen, key, 1));
		}
		return null;
	};
	for (const piece of quote.pieces) {
		const refused = row('piece', piece.key, shares.get(piece.key) ?? 0);
		if (refused) return { ok: false, reason: refused };
	}
	for (const extra of quote.extras) {
		const refused = row('extra', extra.key, extra.priceINR);
		if (refused) return { ok: false, reason: refused };
	}
	// A sale event that lowered the set makes it count as on sale for coupons (accounts brief F, 2026-11-23).
	return {
		ok: true,
		totalINR: quote.totalINR,
		children,
		separatelyINR: quote.separatelyINR,
		saleLowered: quote.beforeEventINR !== null,
	};
}
