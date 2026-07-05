import { AsyncPipe, ViewportScroller } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { Pagination } from '@shared/ui/pagination/pagination';
import { Params } from '@data-access/interfaces/core.interface';
import { IProductModel } from '@data-access/interfaces/product.interface';
import { ProductState } from '@data-access/states/product.state';

@Component({
  selector: 'app-collection-paginate',
  templateUrl: './collection-paginate.html',
  styleUrls: ['./collection-paginate.scss'],
  imports: [Pagination, AsyncPipe],
})
export class CollectionPaginate {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private viewScroller = inject(ViewportScroller);

  product$: Observable<IProductModel> = inject(Store).select(ProductState.product);

  readonly filter = input<Params>();

  public totalItems: number = 0;

  constructor() {
    this.product$.subscribe(product => (this.totalItems = product?.total));
  }

  setPaginate(page: number) {
    void this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams: {
          page: page,
        },
        queryParamsHandling: 'merge', // preserve the existing query params in the route
        skipLocationChange: false, // do trigger navigation
      })
      .finally(() => {
        // this.viewScroller.setOffset([100, 100]);
        // this.viewScroller.scrollToAnchor('filtered_products'); // Anchor Link
      });
  }
}
