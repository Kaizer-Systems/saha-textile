import { NgClass } from '@angular/common';
import { Component, computed, effect, inject, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { CarouselModule, OwlOptions } from 'ngx-owl-carousel-o';
import { Observable } from 'rxjs';

import { ProductBox } from '@shared/ui/product-box/product-box';
import { SkeletonProductBox } from '@shared/ui/product-box/skeleton-product-box/skeleton-product-box';
import * as data from '../../../../shared/data/owl-carousel';
import { injectProductsQuery } from '@data-access/queries/product.queries';
import { IProduct, IProductModel } from '@data-access/interfaces/product.interface';
import { ProductService } from '@data-access/services/product.service';

@Component({
  selector: 'app-theme-product',
  templateUrl: './product.html',
  styleUrls: ['./product.scss'],
  imports: [SkeletonProductBox, ProductBox, CarouselModule, NgClass, NgClass],
})
export class Product {
  productService = inject(ProductService);

  readonly style = input<string>('vertical');
  readonly productIds = input<number[]>([]);
  readonly boxClass = input<string>();
  readonly productStyle = input<string>('product-modern');
  readonly layout = input<string>();
  readonly sliderOption = input<OwlOptions>(data.productSlider);
  readonly slider = input<boolean>();
  readonly showItem = input<number>();

  public products: IProduct[] = [];

  public skeletonItems = Array.from({ length: 6 }, (_, index) => index);

  private readonly productsQuery = injectProductsQuery(() => undefined);
  product$: Observable<IProductModel | undefined> = toObservable(
    computed(() => this.productsQuery.data()),
  );

  constructor() {
    // Widget loads the raw list itself (was populated by the theme page's now-
    // removed GetProductsAction dispatch) and mirrors the query's fetch state.
    effect(() => (this.productService.skeletonLoader = this.productsQuery.isFetching()));
  }

  ngOnChanges() {
    if (Array.isArray(this.productIds())) {
      this.product$.subscribe(products => {
        this.products = (products?.data ?? []).filter(product =>
          this.productIds()?.includes(product?.id),
        );
      });
    }
  }
}
