import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { IProduct, IProductModel } from '@data-access/interfaces/product.interface';
import { ProductService } from '@data-access/services/product.service';

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
      product =>
        (payload['store_slug'] && product?.store?.slug == payload['store_slug']) ||
        (payload['category'] &&
          product?.categories.length &&
          product?.categories?.some(category =>
            payload['category']?.split(',')?.includes(category.slug),
          )),
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
          products = products.sort((a, b) =>
            a.sale_price < b.sale_price ? -1 : a.price > b.price ? 1 : 0,
          );
        } else if (payload['sortBy'] === 'high-low') {
          products = products.sort((a, b) =>
            a.sale_price > b.sale_price ? -1 : a.price < b.price ? 1 : 0,
          );
        }
      } else if (!payload['ids']) {
        products = products.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      }
    }

    if (payload['search']) {
      products = products.filter(product =>
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
export function injectProductsQuery(params: () => Params | undefined) {
  const productService = inject(ProductService);
  return injectQuery(() => ({
    queryKey: ['products', params()],
    queryFn: () => firstValueFrom(productService.getProducts(params())),
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
      const matched = res?.data?.filter(product =>
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
export function injectProductBySlugQuery(slug: () => string | undefined) {
  const productService = inject(ProductService);
  return injectQuery(() => ({
    queryKey: ['products', 'all'],
    queryFn: () => firstValueFrom(productService.getProducts()),
    select: (res: IProductModel): IProduct | undefined => {
      const result = res.data.find(product => product.slug == slug());
      if (!result) return undefined;
      result.related_products =
        result.related_products && result.related_products.length ? result.related_products : [];
      result.cross_sell_products =
        result.cross_sell_products && result.cross_sell_products.length
          ? result.cross_sell_products
          : [];
      return result;
    },
    enabled: !!slug(),
    staleTime: Infinity,
  }));
}

/** Fixed cache slot the detail widgets read as the shared related-products set. */
export const RELATED_PRODUCTS_KEY = ['products', 'related', 'current'];

/**
 * Related products for the current detail page (replaces relatedProducts +
 * GetRelatedProductsAction, which the slug action used to chain-dispatch). The
 * filter runs in queryFn so the computed array IS the cached value; keyed on the
 * params (ids/category_ids derived from the selected product). The product-detail
 * page owns this active query and mirrors its result into RELATED_PRODUCTS_KEY
 * so the detail widgets can read the same set via injectRelatedProductsData.
 */
export function injectRelatedProductsQuery(params: () => Params | undefined) {
  const productService = inject(ProductService);
  return injectQuery(() => ({
    queryKey: ['products', 'related', params()],
    queryFn: async (): Promise<IProduct[]> => {
      const payload = params();
      const res = await firstValueFrom(productService.getProducts());
      return res.data.filter(
        product =>
          payload?.['ids']
            ?.split(',')
            ?.map((id: number) => Number(id))
            .includes(product.id) ||
          (product?.categories.length &&
            product?.categories
              ?.map(category => category.id)
              .includes(Number(payload?.['category_ids']))),
      );
    },
    enabled: !!params()?.['ids'] || !!params()?.['category_ids'],
    staleTime: Infinity,
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
