import { SlicePipe } from '@angular/common';
import { Component, inject } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { ProductBox } from '@shared/ui/product-box/product-box';
import { IProduct } from '@data-access/interfaces/product.interface';
import { ProductState } from '@data-access/states/product.state';

@Component({
  selector: 'app-trending-products',
  templateUrl: './trending-products.html',
  styleUrls: ['./trending-products.scss'],
  imports: [ProductBox, SlicePipe, TranslateModule],
})
export class TrendingProducts {
  relatedProduct$: Observable<IProduct[]> = inject(Store).select(ProductState.relatedProducts);

  public relatedProducts: IProduct[] = [];

  ngOnInit() {
    this.relatedProduct$.subscribe(products => {
      this.relatedProducts = products.length
        ? products?.filter(product => product?.is_trending)
        : [];
    });
  }
}
