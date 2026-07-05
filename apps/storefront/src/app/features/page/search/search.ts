import { Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable, debounceTime, distinctUntilChanged } from 'rxjs';

import { GetProductsAction } from '@data-access/actions/product.action';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { NoData } from '@shared/ui/no-data/no-data';
import { ProductBox } from '@shared/ui/product-box/product-box';
import { SkeletonProductBox } from '@shared/ui/product-box/skeleton-product-box/skeleton-product-box';
import * as data from '../../../shared/data/owl-carousel';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { Params } from '@data-access/interfaces/core.interface';
import { IProduct, IProductModel } from '@data-access/interfaces/product.interface';
import { ProductState } from '@data-access/states/product.state';
import { ProductService } from '@data-access/services/product.service';

@Component({
  selector: 'app-search',
  templateUrl: './search.html',
  styleUrls: ['./search.scss'],
  imports: [
    Breadcrumb,
    ReactiveFormsModule,
    Button,
    SkeletonProductBox,
    ProductBox,
    NoData,
    TranslateModule,
  ],
})
export class Search {
  private store = inject(Store);
  productService = inject(ProductService);
  private route = inject(ActivatedRoute);
  router = inject(Router);

  public breadcrumb: IBreadcrumb = {
    title: 'Search',
    items: [{ label: 'Search', active: true }],
  };

  product$: Observable<IProductModel> = inject(Store).select(ProductState.product);

  public products: IProduct[];
  public search = new FormControl();
  public totalItems: number = 0;
  public gridClass: string =
    'row g-sm-4 g-3 row-cols-2 row-cols-md-3 cols-lg-4 row-cols-xxl-6 product-list-section';
  public skeletonItems = Array.from({ length: 12 }, (_, index) => index);
  public productSlider6ItemMargin = data.productSlider6ItemMargin;
  public filter: Params = {
    page: 1, // Current page number
    paginate: 200, // Display per page,
    status: 1,
    search: '',
  };

  constructor() {
    //  this.getProduct(this.filter);

    this.route.queryParams.subscribe(params => {
      if (params['search']) {
        this.filter['search'] = params['search'];
        this.search.patchValue(params['search'] ? params['search'] : '');
      }
      this.store.dispatch(new GetProductsAction(this.filter)).subscribe({
        next: (val: any) => {
          this.products = val.product.product.data;
        },
      });
    });
  }

  ngOnInit() {
    this.search.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged()) // Adjust the debounce time as needed (in milliseconds)
      .subscribe(inputValue => {
        if (inputValue.length == 0) {
          void this.router.navigate([], {
            relativeTo: this.route,
            queryParams: {
              search: inputValue,
            },
          });
          this.filter['search'] = inputValue;
        }
      });
  }

  searchProduct() {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        search: this.search.value,
      },
    });
    this.filter['search'] = this.search.value;
  }
}
