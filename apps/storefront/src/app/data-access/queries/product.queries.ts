import { inject } from '@angular/core';

import { injectQuery, keepPreviousData } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { ICatalogResponse } from '@data-access/interfaces/catalog.interface';
import { Params } from '@data-access/interfaces/core.interface';
import { IProduct, IProductModel } from '@data-access/interfaces/product.interface';
import { ProductService } from '@data-access/services/product.service';

/** Map the collection page's filter signal to the Nitro catalog route's query params. */
function toCatalogParams(f?: Params): Params {
	const p: Params = { page: f?.['page'] ?? 1, limit: f?.['paginate'] ?? 25 };
	if (f?.['category']) p['category'] = f['category'];
	if (f?.['sortBy']) p['sortBy'] = f['sortBy'];
	if (f?.['rating']) p['rating'] = f['rating'];
	// price "min-max" -> price_min/price_max
	if (f?.['price']) {
		const [lo, hi] = String(f['price']).split('-');
		if (lo) p['price_min'] = lo;
		if (hi) p['price_max'] = hi;
	}
	// attribute facets: "fabric:Silk,Cotton|color:Red" -> fabric=Silk,Cotton & color=Red
	if (f?.['attribute']) {
		for (const grp of String(f['attribute']).split('|')) {
			const [key, vals] = grp.split(':');
			if (key && vals) p[key] = vals;
		}
	}
	return p;
}

/**
 * Category-listing query (Pass B) — hits the Nitro `/api/products` route for a
 * server-side filtered/sorted/paginated lean slice + disjunctive facets. Keyed on
 * the filter params; keepPreviousData holds the old page visible while the next
 * one loads. Replaces the "download product.json + client filter" path here.
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
 * Client-side filter/sort/search transform, ported verbatim from the old
 * ProductState.getProducts reducer. The mock endpoint returns the full list and
 * ignores query params, so filtering/sorting happens here. On a real backend
 * this moves server-side and the transform can be dropped.
 */
export function filterProducts(result: IProductModel, payload?: Params): IProductModel {
	let products = result.data || [];

	if (payload) {
		products = result?.data?.filter(
			(product) =>
				(payload['store_slug'] && product?.store?.slug == payload['store_slug']) ||
				(payload['category'] &&
					product?.categories.length &&
					product?.categories?.some((category) => payload['category']?.split(',')?.includes(category.slug))),
		);

		products = products && products.length ? products : result.data;

		if (products) {
			if (payload['sortBy']) {
				if (payload['sortBy'] === 'asc') {
					products = products.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
				} else if (payload['sortBy'] === 'desc') {
					products = products.sort((a, b) => (a.id > b.id ? -1 : a.id < b.id ? 1 : 0));
				} else if (payload['sortBy'] === 'a-z') {
					products = products.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
				} else if (payload['sortBy'] === 'z-a') {
					products = products.sort((a, b) => (a.name > b.name ? -1 : a.name < b.name ? 1 : 0));
				} else if (payload['sortBy'] === 'low-high') {
					products = products.sort((a, b) => (a.sale_price < b.sale_price ? -1 : a.price > b.price ? 1 : 0));
				} else if (payload['sortBy'] === 'high-low') {
					products = products.sort((a, b) => (a.sale_price > b.sale_price ? -1 : a.price < b.price ? 1 : 0));
				}
			} else if (!payload['ids']) {
				products = products.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
			}
		}

		if (payload['search']) {
			products = products.filter((product) =>
				product.name.toLowerCase().includes(payload['search'].toLowerCase()),
			);
		}
	}

	return {
		...result,
		data: products,
		total: result?.total ? result?.total : result.data ? result.data.length : 0,
	};
}

/**
 * Product list (replaces ProductState.product + GetProductsAction). Keyed on the
 * filter params; the transform above is applied in `select`. Pass `undefined`
 * for the raw, untransformed list (theme widgets that filter by their own ids).
 */
export function injectProductsQuery(params: () => Params | undefined, enabled: () => boolean = () => true) {
	const productService = inject(ProductService);
	return injectQuery(() => ({
		queryKey: ['products', params()],
		queryFn: () => firstValueFrom(productService.getProducts(params())),
		enabled: enabled(),
		select: (res: IProductModel): IProductModel => filterProducts(res, params()),
		staleTime: Infinity,
	}));
}

/**
 * Deal products (replaces ProductState.dealProducts + GetDealProductsAction).
 * Filters the list to the given ids, falling back to the last two products.
 */
export function injectDealProductsQuery(params: () => Params | undefined) {
	const productService = inject(ProductService);
	return injectQuery(() => ({
		queryKey: ['products', 'deal', params()],
		queryFn: () => firstValueFrom(productService.getProducts(params())),
		select: (res: IProductModel): IProduct[] => {
			const ids = params()?.['ids'];
			const matched = res?.data?.filter((product) =>
				ids
					?.split(',')
					?.map((id: number) => Number(id))
					.includes(product.id),
			);
			return matched && matched.length ? matched : res?.data?.reverse()?.slice(0, 2);
		},
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
		staleTime: Infinity,
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
