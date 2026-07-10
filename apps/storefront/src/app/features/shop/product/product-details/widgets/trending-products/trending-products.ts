import { SlicePipe } from '@angular/common';
import { Component, computed } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { TranslateModule } from '@ngx-translate/core';
import { Observable } from 'rxjs';

import { ProductBox } from '@shared/ui/product-box/product-box';
import { injectRelatedProductsData } from '@data-access/queries/product.queries';
import { IProduct } from '@data-access/interfaces/product.interface';

@Component({
  selector: 'app-trending-products',
  templateUrl: './trending-products.html',
  styleUrls: ['./trending-products.scss'],
  imports: [ProductBox, SlicePipe, TranslateModule],
})
export class TrendingProducts {
  private readonly relatedQuery = injectRelatedProductsData();
  relatedProduct$: Observable<IProduct[]> = toObservable(
    computed(() => this.relatedQuery.data() ?? []),
  );

  public relatedProducts: IProduct[] = [];

  ngOnInit() {
    this.relatedProduct$.subscribe(products => {
      this.relatedProducts = products.length
        ? products?.filter(product => product?.is_trending)
        : [];
    });
  }
}
