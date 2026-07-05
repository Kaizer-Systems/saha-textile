import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

import { Store, Action, Selector, State, StateContext } from '@ngxs/store';
import { tap } from 'rxjs';

import {
  GetProductsAction,
  GetStoreProductsAction,
  GetRelatedProductsAction,
  GetProductBySlugAction,
  GetDealProductsAction,
} from '@data-access/actions/product.action';
import { IProduct, IProductModel } from '@data-access/interfaces/product.interface';
import { ProductService } from '../services/product.service';
import { ThemeOptionService } from '../services/theme-option.service';

export class ProductStateModel {
  product = {
    data: [] as IProduct[],
    total: 0,
  };
  selectedProduct: IProduct | null;
  categoryProducts: IProduct[] | [];
  relatedProducts: IProduct[] | [];
  storeProducts: IProduct[] | [];
  dealProducts: IProduct[] | [];
}

@State<ProductStateModel>({
  name: 'product',
  defaults: {
    product: {
      data: [],
      total: 0,
    },
    selectedProduct: null,
    categoryProducts: [],
    relatedProducts: [],
    storeProducts: [],
    dealProducts: [],
  },
})
@Injectable()
export class ProductState {
  private store = inject(Store);
  private router = inject(Router);
  private productService = inject(ProductService);
  private themeOptionService = inject(ThemeOptionService);

  @Selector()
  static product(state: ProductStateModel) {
    return state.product;
  }

  @Selector()
  static selectedProduct(state: ProductStateModel) {
    return state.selectedProduct;
  }

  @Selector()
  static relatedProducts(state: ProductStateModel) {
    return state.relatedProducts;
  }

  @Selector()
  static storeProducts(state: ProductStateModel) {
    return state.storeProducts;
  }

  @Selector()
  static dealProducts(state: ProductStateModel) {
    return state.dealProducts;
  }

  @Action(GetProductsAction)
  getProducts(ctx: StateContext<ProductStateModel>, action: GetProductsAction) {
    this.productService.skeletonLoader = true;
    // Note :- You must need to call api for filter and pagination as of now we are using json data so currently get all data from json
    //          you must need apply this logic on server side
    return this.productService.getProducts(action.payload).pipe(
      tap({
        next: (result: IProductModel) => {
          let products = result.data || [];
          if (action?.payload) {
            // Note:- For Internal filter purpose only, once you apply filter logic on server side then you can remove  it as per your requirement.
            // Note:- we have covered only few filters as demo purpose
            products = result?.data?.filter(
              product =>
                (action?.payload?.['store_slug'] &&
                  product?.store?.slug == action?.payload?.['store_slug']) ||
                (action?.payload?.['category'] &&
                  product?.categories.length &&
                  product?.categories?.some(category =>
                    action?.payload?.['category']?.split(',')?.includes(category.slug),
                  )),
            );

            products = products && products.length ? products : result.data;

            if (products) {
              if (action?.payload?.['sortBy']) {
                if (action?.payload?.['sortBy'] === 'asc') {
                  products = products.sort((a, b) => {
                    if (a.id < b.id) {
                      return -1;
                    } else if (a.id > b.id) {
                      return 1;
                    }
                    return 0;
                  });
                } else if (action?.payload?.['sortBy'] === 'desc') {
                  products = products.sort((a, b) => {
                    if (a.id > b.id) {
                      return -1;
                    } else if (a.id < b.id) {
                      return 1;
                    }
                    return 0;
                  });
                } else if (action?.payload?.['sortBy'] === 'a-z') {
                  products = products.sort((a, b) => {
                    if (a.name < b.name) {
                      return -1;
                    } else if (a.name > b.name) {
                      return 1;
                    }
                    return 0;
                  });
                } else if (action?.payload?.['sortBy'] === 'z-a') {
                  products = products.sort((a, b) => {
                    if (a.name > b.name) {
                      return -1;
                    } else if (a.name < b.name) {
                      return 1;
                    }
                    return 0;
                  });
                } else if (action?.payload?.['sortBy'] === 'low-high') {
                  products = products.sort((a, b) => {
                    if (a.sale_price < b.sale_price) {
                      return -1;
                    } else if (a.price > b.price) {
                      return 1;
                    }
                    return 0;
                  });
                } else if (action?.payload?.['sortBy'] === 'high-low') {
                  products = products.sort((a, b) => {
                    if (a.sale_price > b.sale_price) {
                      return -1;
                    } else if (a.price < b.price) {
                      return 1;
                    }
                    return 0;
                  });
                }
              } else if (!action?.payload?.['ids']) {
                products = products.sort((a, b) => {
                  if (a.id < b.id) {
                    return -1;
                  } else if (a.id > b.id) {
                    return 1;
                  }
                  return 0;
                });
              }
            }

            if (action?.payload?.['search']) {
              products = products.filter(product =>
                product.name.toLowerCase().includes(action?.payload?.['search'].toLowerCase()),
              );
            }
          }

          ctx.patchState({
            product: {
              data: products,
              total: result?.total ? result?.total : result.data ? result.data.length : 0,
            },
          });
        },
        complete: () => {
          this.productService.skeletonLoader = false;
        },
        error: err => {
          throw new Error(err?.error?.message);
        },
      }),
    );
  }

  @Action(GetRelatedProductsAction)
  getRelatedProducts(ctx: StateContext<ProductStateModel>, action: GetProductsAction) {
    this.themeOptionService.preloader = true;
    return this.productService.getProducts(action.payload).pipe(
      tap({
        next: (result: IProductModel) => {
          const state = ctx.getState();
          const products = result.data.filter(
            product =>
              action?.payload?.['ids']
                ?.split(',')
                ?.map((id: number) => Number(id))
                .includes(product.id) ||
              (product?.categories.length &&
                product?.categories
                  ?.map(category => category.id)
                  .includes(Number(action?.payload?.['category_ids']))),
          );
          ctx.patchState({
            ...state,
            relatedProducts: products,
          });
        },
        complete: () => {
          this.themeOptionService.preloader = false;
        },
        error: err => {
          throw new Error(err?.error?.message);
        },
      }),
    );
  }

  @Action(GetStoreProductsAction)
  getStoreProducts(ctx: StateContext<ProductStateModel>, action: GetProductsAction) {
    return this.productService.getProducts(action.payload).pipe(
      tap({
        next: (result: IProductModel) => {
          const state = ctx.getState();
          const products = result.data.filter(product =>
            action?.payload?.['store_ids']
              ?.split(',')
              ?.map((id: number) => Number(id))
              .includes(product.store_id),
          );
          ctx.patchState({
            ...state,
            storeProducts: products,
          });
        },
        error: err => {
          throw new Error(err?.error?.message);
        },
      }),
    );
  }

  @Action(GetProductBySlugAction)
  getProductBySlug(ctx: StateContext<ProductStateModel>, { slug }: GetProductBySlugAction) {
    this.themeOptionService.preloader = true;
    return this.productService.getProducts().pipe(
      tap({
        next: results => {
          const result = results.data.find(product => product.slug == slug);

          if (result) {
            result.related_products =
              result.related_products && result.related_products.length
                ? result.related_products
                : [];
            result.cross_sell_products =
              result.cross_sell_products && result.cross_sell_products.length
                ? result.cross_sell_products
                : [];

            const ids = [...result.related_products, ...result.cross_sell_products];
            const categoryIds = [...result?.categories?.map(category => category.id)];
            this.store.dispatch(
              new GetRelatedProductsAction({
                ids: ids.join(','),
                category_ids: categoryIds.join(','),
                status: 1,
              }),
            );

            const state = ctx.getState();
            ctx.patchState({
              ...state,
              selectedProduct: result,
            });
          } else {
            void this.router.navigate(['/404']);
          }
        },
        complete: () => {
          this.themeOptionService.preloader = false;
        },
        error: err => {
          throw new Error(err?.error?.message);
        },
      }),
    );
  }

  @Action(GetDealProductsAction)
  getDealProducts(ctx: StateContext<ProductStateModel>, action: GetDealProductsAction) {
    return this.productService.getProducts(action.payload).pipe(
      tap({
        next: (result: IProductModel) => {
          const state = ctx.getState();
          const products = result?.data?.filter(product =>
            action?.payload?.['ids']
              ?.split(',')
              ?.map((id: number) => Number(id))
              .includes(product.id),
          );
          ctx.patchState({
            ...state,
            dealProducts:
              products && products.length ? products : result?.data?.reverse()?.slice(0, 2),
          });
        },
        error: err => {
          throw new Error(err?.error?.message);
        },
      }),
    );
  }
}
