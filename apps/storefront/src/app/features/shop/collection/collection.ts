import { Component, computed, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';

import { Observable } from 'rxjs';

import { CollectionBanner } from './collection-banner/collection-banner';
import { CollectionCategorySidebar } from './collection-category-sidebar/collection-category-sidebar';
import { CollectionCategorySlider } from './collection-category-slider/collection-category-slider';
import { CollectionLeftSidebar } from './collection-left-sidebar/collection-left-sidebar';
import { CollectionList } from './collection-list/collection-list';
import { CollectionNoSidebar } from './collection-no-sidebar/collection-no-sidebar';
import { CollectionOffCanvasFilter } from './collection-offcanvas-filter/collection-offcanvas-filter';
import { CollectionRightSidebar } from './collection-right-sidebar/collection-right-sidebar';
import { injectProductsQuery } from '@data-access/queries/product.queries';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { Params } from '@data-access/interfaces/core.interface';
import { IProductModel } from '@data-access/interfaces/product.interface';
import { IOption } from '@data-access/interfaces/theme-option.interface';
import { ThemeOptionStore } from '@core/state/theme-option.store';

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

  public filter = signal<Params>({
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
  });

  private readonly productsQuery = injectProductsQuery(() => this.filter());
  product$: Observable<IProductModel | undefined> = toObservable(
    computed(() => this.productsQuery.data()),
  );
  themeOptions$: Observable<IOption> = toObservable(inject(ThemeOptionStore).themeOptions) as Observable<IOption>;

  public breadcrumb: IBreadcrumb = {
    title: 'Collections',
    items: [{ label: 'Collections', active: false }],
  };
  public layout: string = 'collection_category_slider';
  public skeleton: boolean = true;

  public totalItems: number = 0;

  constructor() {
    // Get Query params..
    this.route.queryParams.subscribe(params => {
      const next: Params = {
        page: params['page'] ? params['page'] : 1,
        paginate: 200, // Note we are using json thats why its it static
        status: 1,
        field: params['field'] ? params['field'] : this.filter()['field'],
        price: params['price'] ? params['price'] : '',
        category: params['category'] ? params['category'] : '',
        tag: params['tag'] ? params['tag'] : '',
        sort: params['sort'] ? params['sort'] : '',
        sortBy: params['sortBy'] ? params['sortBy'] : this.filter()['sortBy'],
        rating: params['rating'] ? params['rating'] : '',
        attribute: params['attribute'] ? params['attribute'] : '',
      };

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

      next['layout'] = this.layout;
      this.filter.set(next);
    });

    this.product$.subscribe(product => (this.totalItems = product?.total ?? 0));
  }
}
