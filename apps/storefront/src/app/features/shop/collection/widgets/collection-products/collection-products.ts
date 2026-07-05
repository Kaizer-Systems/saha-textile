import { AsyncPipe } from '@angular/common';
import { Component, inject, input } from '@angular/core';

import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { NoData } from '@shared/ui/no-data/no-data';
import { ProductBox } from '@shared/ui/product-box/product-box';
import { SkeletonProductBox } from '@shared/ui/product-box/skeleton-product-box/skeleton-product-box';
import { Params } from '@data-access/interfaces/core.interface';
import { IProductModel } from '@data-access/interfaces/product.interface';
import { ProductService } from '@data-access/services/product.service';
import { ProductState } from '@data-access/states/product.state';
import { CollectionPaginate } from '../collection-paginate/collection-paginate';
import { CollectionSort } from '../collection-sort/collection-sort';

@Component({
  selector: 'app-collection-products',
  templateUrl: './collection-products.html',
  styleUrls: ['./collection-products.scss'],
  imports: [CollectionSort, SkeletonProductBox, ProductBox, NoData, CollectionPaginate, AsyncPipe],
})
export class CollectionProducts {
  productService = inject(ProductService);

  product$: Observable<IProductModel> = inject(Store).select(ProductState.product);

  readonly filter = input<Params>();
  readonly gridCol = input<string>();

  public gridClass: string =
    'row g-sm-4 g-3 row-cols-xxl-4 row-cols-xl-3 row-cols-lg-2 row-cols-md-3 row-cols-2 product-list-section';

  public skeletonItems = Array.from({ length: 40 }, (_, index) => index);

  setGridClass(gridClass: string) {
    this.gridClass = gridClass;
  }
}
