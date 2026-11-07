import { inject } from '@angular/core';

import { cleanListingParams } from '@saha-textile/core-domain/listing';
import { injectQuery, keepPreviousData } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { ICatalogResponse } from '@data-access/interfaces/catalog.interface';
import { Params } from '@data-access/interfaces/core.interface';
import { IProduct } from '@data-access/interfaces/product.interface';
import { ProductService } from '@data-access/services/product.service';

const RECENT_PURCHASES_REFRESH_MS = 5 * 60 * 1000;

/**
 * The collection page's filter signal as the listing's request. The filters come from the
 * address, so a hand-edited value is dropped here and the shopper still gets a listing.
 */
function toCatalogParams(f?: Params): Params {
	return {
		...cleanListingParams(f ?? {}),
		limit: f?.['paginate'] ?? 25,
		path: f?.['path'] ?? '',
	};
}

/**
 * Category-listing query: the catalogue API's server-side filtered, paginated slice with
 * disjunctive facets. Keyed on the filter params; keepPreviousData holds the old page
 * visible while the next one loads.
 */
export function injectCatalogQuery(params: () => Params | undefined) {
	const productService = inject(ProductService);
	return injectQuery(() => ({
		queryKey: ['catalog', toCatalogParams(params())],
		queryFn: () => firstValueFrom(productService.getCatalog(toCatalogParams(params()))),
		placeholderData: keepPreviousData,
		staleTime: Infinity,
	}));
}

/**
 * A single product by slug (replaces GetProductBySlugAction + selectedProduct,
 * and the old ProductResolver). Normalizes related/cross-sell arrays so the
 * detail widgets can derive their related-products query params.
 */
export function injectProductBySlugQuery(slug: () => string | undefined, variant: () => string | null = () => null) {
	const productService = inject(ProductService);
	return injectQuery(() => ({
		queryKey: ['catalog', 'product', slug(), variant() ?? ''],
		queryFn: () => firstValueFrom(productService.getProductPage(slug()!, variant())),
		enabled: !!slug(),
		// Another variant of the same product keeps the page up; a different product starts clean.
		placeholderData: (previous?: IProduct, previousQuery?: { queryKey: readonly unknown[] }) =>
			previousQuery?.queryKey[2] === slug() ? previous : undefined,
		staleTime: Infinity,
	}));
}

/** Real sales for the popup. The browser asks every few minutes, so it notices new orders by itself. */
export function injectRecentPurchasesQuery(enabled: () => boolean) {
	const productService = inject(ProductService);
	return injectQuery(() => ({
		queryKey: ['catalog', 'recent-purchases'],
		queryFn: () => firstValueFrom(productService.recentPurchases()),
		enabled: enabled(),
		refetchInterval: RECENT_PURCHASES_REFRESH_MS,
	}));
}

/** Fixed cache slot the detail widgets read as the shared related-products set. */
export const RELATED_PRODUCTS_KEY = ['products', 'related', 'current'];

/** The product page's saved relation rails, from the catalogue API. */
export function injectProductRelationsQuery(slug: () => string | undefined) {
	const productService = inject(ProductService);
	return injectQuery(() => ({
		queryKey: ['catalog', 'relations', slug()],
		queryFn: () => firstValueFrom(productService.getRelations(slug()!)),
		enabled: !!slug(),
	}));
}

/**
 * Passive reader of the shared related-products slot (enabled: false so it never
 * fetches). Returns whatever the product-detail page mirrored into
 * RELATED_PRODUCTS_KEY. Used by the detail widgets (related/trending/bundle).
 */
export function injectRelatedProductsData() {
	return injectQuery(() => ({
		queryKey: RELATED_PRODUCTS_KEY,
		queryFn: () => Promise.resolve<IProduct[]>([]),
		enabled: false,
		staleTime: Infinity,
	}));
}
