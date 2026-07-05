import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { CollectionBanner } from './collection-banner/collection-banner';
import { CollectionCategorySidebar } from './collection-category-sidebar/collection-category-sidebar';
import { CollectionCategorySlider } from './collection-category-slider/collection-category-slider';
import { CollectionLeftSidebar } from './collection-left-sidebar/collection-left-sidebar';
import { CollectionList } from './collection-list/collection-list';
import { CollectionNoSidebar } from './collection-no-sidebar/collection-no-sidebar';
import { CollectionOffCanvasFilter } from './collection-offcanvas-filter/collection-offcanvas-filter';
import { CollectionRightSidebar } from './collection-right-sidebar/collection-right-sidebar';
import { GetProductsAction } from '@data-access/actions/product.action';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { Params } from '@data-access/interfaces/core.interface';
import { IProductModel } from '@data-access/interfaces/product.interface';
import { IOption } from '@data-access/interfaces/theme-option.interface';
import { ProductState } from '@data-access/states/product.state';
import { ThemeOptionState } from '@data-access/states/theme-option.state';

@Component({
  selector: 'app-collection',
  templateUrl: './collection.html',
  styleUrls: ['./collection.scss'],
  imports: [
    Breadcrumb,
    CollectionCategorySlider,
    CollectionCategorySidebar,
    CollectionBanner,
    CollectionLeftSidebar,
    CollectionRightSidebar,
    CollectionList,
    CollectionOffCanvasFilter,
    CollectionNoSidebar,
  ],
})
export class Collection {
  private route = inject(ActivatedRoute);
  private store = inject(Store);

  product$: Observable<IProductModel> = inject(Store).select(ProductState.product);
  themeOptions$: Observable<IOption> = inject(Store).select(
    ThemeOptionState.themeOptions,
  ) as Observable<IOption>;

  public breadcrumb: IBreadcrumb = {
    title: 'Collections',
    items: [{ label: 'Collections', active: false }],
  };
  public layout: string = 'collection_category_slider';
  public skeleton: boolean = true;

  public filter: Params = {
    page: 1, // Current page number
    paginate: 200, // Display per page, // Note we are using json thats why its it static
    status: 1,
    field: '',
    price: '',
    category: '',
    tag: '',
    sort: '', // ASC, DSC
    sortBy: '',
    rating: '',
    attribute: '',
  };

  public totalItems: number = 0;

  constructor() {
    // Get Query params..
    this.route.queryParams.subscribe(params => {
      this.filter = {
        page: params['page'] ? params['page'] : 1,
        paginate: 200, // Note we are using json thats why its it static
        status: 1,
        field: params['field'] ? params['field'] : this.filter['field'],
        price: params['price'] ? params['price'] : '',
        category: params['category'] ? params['category'] : '',
        tag: params['tag'] ? params['tag'] : '',
        sort: params['sort'] ? params['sort'] : '',
        sortBy: params['sortBy'] ? params['sortBy'] : this.filter['sortBy'],
        rating: params['rating'] ? params['rating'] : '',
        attribute: params['attribute'] ? params['attribute'] : '',
      };

      this.store.dispatch(new GetProductsAction(this.filter));

      // Params For Demo Purpose only
      if (params && params['layout']) {
        this.layout = params['layout'];
      } else {
        // Get Collection Layout
        this.themeOptions$.subscribe(option => {
          this.layout =
            option?.collection && option?.collection?.collection_layout
              ? option?.collection?.collection_layout
              : 'collection_category_slider';
        });
      }

      this.filter['layout'] = this.layout;
    });

    this.product$.subscribe(product => (this.totalItems = product?.total));
  }
}
