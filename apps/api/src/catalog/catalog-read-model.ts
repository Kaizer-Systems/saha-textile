import type { Product, ProductVariant } from '@saha-textile/contracts';
import {
	badgeSlots,
	cardPrice,
	mrpPriceINR,
	selectDefaultVariant,
	sellingPriceINR,
	type CardPrice,
} from '@saha-textile/core-domain';

export interface PricedRow {
	sellingINR: number;
	mrpINR: number | null;
	buyable: boolean;
	live: boolean;
	quantity: number;
}

export function pricedRow(row: ProductVariant, madeToOrder: boolean): PricedRow {
	return {
		sellingINR: sellingPriceINR(row.priceINR, row.salePriceINR),
		mrpINR: mrpPriceINR(row.priceINR, row.compareAtPriceINR, row.salePriceINR),
		buyable: row.status === 'live' && (row.stock.quantity > 0 || madeToOrder),
		live: row.status === 'live',
		quantity: row.stock.quantity,
	};
}

export function skuView(row: ProductVariant, madeToOrder: boolean) {
	const priced = pricedRow(row, madeToOrder);
	return {
		sku: row.sku,
		isBase: row.isBaseVariant,
		sellingINR: priced.sellingINR,
		mrpINR: priced.mrpINR,
		quantity: priced.quantity,
		buyable: priced.buyable,
		imageAssetId: row.media?.primaryAssetId ?? null,
	};
}

/**
 * Price, badges, and the selected SKU for one product, from one read of its variants.
 * Cards and the product page both use this, so the two can never disagree.
 */
export function productReadModel(product: Product, rows: readonly ProductVariant[], variantSku?: string | null) {
	const madeToOrder = product.madeToOrder && product.status === 'live';
	const priced = rows.map((row) => pricedRow(row, madeToOrder));
	// Rows nobody can buy show the product's own price, so a card always has one to show.
	const price = cardPrice(
		priced.some((row) => row.live)
			? priced
			: [{ sellingINR: product.basePriceINR, mrpINR: null, buyable: true, live: true, quantity: 0 }],
	) as CardPrice;
	const sellable = priced.filter((row) => row.buyable).reduce((sum, row) => sum + row.quantity, 0);
	const badges = badgeSlots({
		now: new Date(),
		sellingBelowMrp: priced.some((row) => row.mrpINR !== null && row.sellingINR < row.mrpINR),
		featured: product.featured,
		bestseller: product.insightBadges.includes('bestseller'),
		trending: product.insightBadges.includes('trending'),
		publishedAt: product.lifecycle.liveAt ? new Date(product.lifecycle.liveAt) : null,
		backInStockAt: product.backInStockAt ? new Date(product.backInStockAt) : null,
		sellableQuantity: sellable,
		lowStockThreshold: product.lowStockThreshold,
		lifetimeUnitsReceived: product.lifetimeUnitsReceived,
		pinned: product.pinnedBadges,
		hidden: product.hiddenBadges,
	});
	const chosen = variantSku ? (rows.find((row) => row.sku === variantSku) ?? null) : null;
	const fallback = selectDefaultVariant(
		rows.map((row) => ({ row, isBase: row.isBaseVariant, buyable: pricedRow(row, madeToOrder).buyable })),
	);
	const selected = chosen ?? fallback?.row ?? null;
	return {
		madeToOrder,
		price,
		badges,
		sellable,
		selected,
		unknownVariant: Boolean(variantSku && !chosen),
	};
}
