/** The API's admin catalogue shapes (`AdminProductList`, `AdminProductDetail`, `ProductMerchandisingWrite`). */

import type { ProductContentWrite } from '@saha-textile/contracts';

export type CatalogBadgeCode = 'sale' | 'featured' | 'bestseller' | 'trending' | 'new' | 'low_stock' | 'back_in_stock';

export const CATALOG_BADGE_CODES: readonly CatalogBadgeCode[] = [
	'sale',
	'featured',
	'bestseller',
	'trending',
	'new',
	'low_stock',
	'back_in_stock',
];

export type CatalogProductStatus = 'draft' | 'live' | 'disabled' | 'discontinued';

export interface CatalogShipping {
	weightGrams: number | null;
	lengthCm: number | null;
	widthCm: number | null;
	heightCm: number | null;
}

export interface CatalogProductRow {
	id: string;
	slug: string;
	sku: string;
	title: string;
	status: CatalogProductStatus;
	featured: boolean;
	sellingFromINR: number;
	stock: number;
	variantCount: number;
	thumbnailUrl: string | null;
}

export interface CatalogProductList {
	items: CatalogProductRow[];
	total: number;
	page: number;
	pageSize: number;
}

export interface CatalogVariantView extends CatalogShipping {
	id: string;
	sku: string;
	label: string;
	isBase: boolean;
	mrpINR: number | null;
	sellingINR: number;
	quantity: number;
	available: boolean;
	barcode: string | null;
	hsnCode: string | null;
}

export interface CatalogProductDetail {
	id: string;
	slug: string;
	sku: string;
	title: string;
	type: 'simple' | 'variable' | 'bundle';
	status: CatalogProductStatus;
	published: boolean;
	featured: boolean;
	madeToOrder: boolean;
	estimatedDeliveryText: string | null;
	lowStockThreshold: number | null;
	pinnedBadges: CatalogBadgeCode[];
	hiddenBadges: CatalogBadgeCode[];
	addonPriceINR: number | null;
	replacementPath: string | null;
	shipping: CatalogShipping;
	hsnCode: string | null;
	content: ProductContentWrite;
	images: Array<{ assetId: string; url: string; width: number; height: number }>;
	relatedProductIds: string[];
	upsellProductIds: string[];
	crossSellProductIds: string[];
	variants: CatalogVariantView[];
}

export interface CatalogVariantWrite extends CatalogShipping {
	id: string;
	sku: string;
	mrpINR: number | null;
	sellingINR: number;
	quantity: number;
	available: boolean;
	barcode: string | null;
	hsnCode: string | null;
}

export interface CatalogProductWrite {
	sku: string;
	status: 'live' | 'disabled';
	featured: boolean;
	madeToOrder: boolean;
	estimatedDeliveryText: string | null;
	lowStockThreshold: number | null;
	pinnedBadges: CatalogBadgeCode[];
	hiddenBadges: CatalogBadgeCode[];
	addonPriceINR: number | null;
	shipping: CatalogShipping;
	hsnCode: string | null;
	variants: CatalogVariantWrite[];
	slug?: string;
	content?: ProductContentWrite;
	relatedProductIds?: string[];
	upsellProductIds?: string[];
	crossSellProductIds?: string[];
}

export interface CatalogReplacementTarget {
	kind: 'product' | 'collection';
	path: string;
	label: string;
}
