import { BundlePriceMethod, ProductBundle } from '@saha-textile/contracts';
import { SEEDED_PRICE_METHODS } from '@saha-textile/core-domain';

import { BundlePriceMethodModel, ProductBundleModel, ProductModel } from '../models/index';

/** Seeded methods have fixed ids, so a bundle seeded or migrated anywhere points at the same record. */
export const seededMethodId = (code: string): string => `bpm_${code}`;

/**
 * Migration 0013 (bundle builder brief, approved 2026-11-22): the five price methods shown in the brief, seeded so
 * the "Set price is" list has them from day one (owner: "create those exact same rules by default as seed data
 * into the db itself"). A method already stored under the same code is never overwritten.
 */
export async function seedBundlePriceMethods(now = new Date()): Promise<string> {
	let written = 0;
	for (const seed of SEEDED_PRICE_METHODS) {
		const method = BundlePriceMethod.parse({ ...seed, id: seededMethodId(seed.code), seeded: true, version: 1 });
		const { id, createdAt: _c, updatedAt: _u, ...rest } = method;
		const result = await BundlePriceMethodModel.updateOne(
			{ code: method.code },
			{ $setOnInsert: { _id: id, ...rest, createdAt: now, updatedAt: now } },
			{ upsert: true },
		).exec();
		if (result.upsertedCount > 0) written += 1;
	}
	return `wrote ${written} bundle price method${written === 1 ? '' : 's'}`;
}

interface LegacyComponent {
	productId: string;
	variantId?: string | null;
	quantity?: number;
	required?: boolean;
	priceAdjustmentINR?: number | null;
}
interface LegacyGroup {
	code: string;
	label?: Record<string, string>;
	minSelections?: number;
	maxSelections?: number;
	components?: LegacyComponent[];
}
interface LegacyBundle {
	_id: string;
	productId: string;
	pricePolicy?: string;
	fixedPriceINR?: number | null;
	groups?: LegacyGroup[];
	levels?: unknown[];
	status?: string;
}

/**
 * Converts one bundle from the old Bundle tab's shape (groups with min/max, `required`, a price policy) to levels.
 * - A group whose every component is required (a fixed kit) becomes one level per piece ("Piece 1", "Piece 2").
 * - A group holding more components than it takes becomes one choice level taking `maxSelections`.
 * - A component that is not required outside a choice becomes an optional extra.
 * - `fixed_bundle_price` → One fixed price; the other policies → Pieces added up (an adjustment becomes the
 *   item's Price in this set, as the selling price minus the adjustment, worked out by the caller's prices).
 */
export function legacyBundleToLevels(
	doc: LegacyBundle,
	sellingOf: (productId: string) => number | null,
): Pick<ProductBundle, 'levels' | 'extras' | 'pricing'> {
	const levels: ProductBundle['levels'] = [];
	const extras: ProductBundle['extras'] = [];
	let piece = 0;
	for (const group of doc.groups ?? []) {
		const components = group.components ?? [];
		const take = Math.max(1, group.maxSelections ?? 1);
		const isChoice = components.length > take && components.some((component) => component.required === false);
		const itemOf = (component: LegacyComponent) => {
			const selling = sellingOf(component.productId);
			const adjusted =
				doc.pricePolicy === 'discounted_components' && component.priceAdjustmentINR && selling !== null
					? Math.max(0, Math.round(selling - component.priceAdjustmentINR))
					: null;
			return {
				productId: component.productId,
				variantId: component.variantId ?? null,
				quantity: component.quantity ?? 1,
				priceInSetINR: adjusted,
			};
		};
		if (isChoice) {
			levels.push({
				code: group.code || `level-${levels.length + 1}`,
				label:
					group.label && group.label.en
						? (group.label as ProductBundle['levels'][number]['label'])
						: { en: 'Choose one', bn: 'একটি বেছে নিন' },
				take,
				source: { kind: 'items' },
				items: components.map(itemOf),
				priceMode: 'difference',
			});
			continue;
		}
		for (const component of components) {
			if (component.required === false) {
				extras.push(itemOf(component));
				continue;
			}
			piece += 1;
			levels.push({
				code: `piece-${piece}`,
				label: { en: `Piece ${piece}`, bn: `পিস ${piece}` },
				take: 1,
				source: { kind: 'items' },
				items: [itemOf(component)],
				priceMode: 'difference',
			});
		}
	}
	const fixed = doc.pricePolicy === 'fixed_bundle_price' && typeof doc.fixedPriceINR === 'number';
	return {
		levels,
		extras,
		pricing: {
			methodId: seededMethodId(fixed ? 'fixed_price' : 'pieces_added_up'),
			params: fixed ? { setPrice: doc.fixedPriceINR as number } : {},
			rules: [],
			combine: 'all',
			capAtSeparately: false,
			roundTo: 'one',
		},
	};
}

/**
 * Migration 0014 (expand): every bundle still in the old Bundle tab's shape gains levels, extras and pricing. The
 * old fields stay for a rollback; a later release removes them (end-of-project clean-up list).
 */
export async function convertBundlesToLevels(): Promise<string> {
	const docs = await ProductBundleModel.find({ levels: { $in: [null, []] }, 'groups.0': { $exists: true } })
		.lean<LegacyBundle[]>()
		.exec();
	if (docs.length === 0) return 'no bundles to convert';
	const ids = [
		...new Set(
			docs.flatMap((doc) => (doc.groups ?? []).flatMap((g) => (g.components ?? []).map((c) => c.productId))),
		),
	];
	const products = await ProductModel.find({ _id: { $in: ids } }, { basePriceINR: 1 })
		.lean<Array<{ _id: string; basePriceINR?: number }>>()
		.exec();
	const prices = new Map(products.map((p) => [p._id, p.basePriceINR ?? null]));
	let converted = 0;
	for (const doc of docs) {
		const next = legacyBundleToLevels(doc, (id) => prices.get(id) ?? null);
		const memberIds = [
			...new Set([...next.levels.flatMap((l) => l.items), ...next.extras].map((i) => i.productId)),
		];
		await ProductBundleModel.updateOne(
			{ _id: doc._id },
			{
				$set: {
					...next,
					memberIds,
					methodId: next.pricing.methodId,
					saleWindow: null,
					styledPhoto: null,
					dearerReason: null,
					stock: null,
				},
			},
		).exec();
		converted += 1;
	}
	return `converted ${converted} bundle${converted === 1 ? '' : 's'} to levels`;
}

/** Migration 0015: products written before Show on shop existed are shown (D5: "the migration sets it on"). */
export async function showProductsOnShop(): Promise<string> {
	const result = await ProductModel.updateMany(
		{ showOnShop: { $exists: false } },
		{ $set: { showOnShop: true } },
	).exec();
	return `set Show on shop on ${result.modifiedCount} product${result.modifiedCount === 1 ? '' : 's'}`;
}
