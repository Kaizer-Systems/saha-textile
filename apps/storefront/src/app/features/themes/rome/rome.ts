import { isPlatformBrowser } from '@angular/common';
import { Component, inject, PLATFORM_ID, input } from '@angular/core';

import { Store } from '@ngxs/store';
import { Observable, forkJoin } from 'rxjs';

import { GetBlogsAction } from '@data-access/actions/blog.action';
import { GetProductsAction } from '@data-access/actions/product.action';
import { ImageLink } from '@shared/ui/image-link/image-link';
import { Title } from '@shared/ui/title/title';
import * as data from '../../../shared/data/owl-carousel';
import { IProductModel } from '@data-access/interfaces/product.interface';
import { IRome } from '@data-access/interfaces/theme.interface';
import { ThemeOptionService } from '@data-access/services/theme-option.service';
import { ProductState } from '@data-access/states/product.state';
import { Banner } from '../widgets/banner/banner';
import { Blog } from '../widgets/blog/blog';
import { Categorie } from '../widgets/categorie/categorie';
import { FourColumnProduct } from '../widgets/four-column-product/four-column-product';
import { HomeBanner } from '../widgets/home-banner/home-banner';
import { Newsletter } from '../widgets/newsletter/newsletter';
import { Product } from '../widgets/product/product';

@Component({
  selector: 'app-rome',
  templateUrl: './rome.html',
  styleUrls: ['./rome.scss'],
  imports: [
    HomeBanner,
    Title,
    Categorie,
    Banner,
    Product,
    ImageLink,
    FourColumnProduct,
    Blog,
    Newsletter
],
})
export class Rome {
  private store = inject(Store);
  private platformId = inject<Object>(PLATFORM_ID);
  private themeOptionService = inject(ThemeOptionService);

  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly data = input<IRome>();
  readonly slug = input<string>();

  categoryProduct$: Observable<IProductModel> = inject(Store).select(
    ProductState.product,
  ) as Observable<IProductModel>;

  public categorySlider = data.categorySlider9;
  public productSlider6ItemMargin = data.productSlider6ItemMargin;
  public customOptionsItem4 = data.customOptionsItem4;
  public productFilterIds: number[] = [];
  public selectedCategoryId: number;

  ngOnInit() {
    if (isPlatformBrowser(this.platformId)) {
      const dataValue = this.data();
      if (dataValue?.slug == this.slug()) {
        // Get Products
        const getProducts$ = this.store.dispatch(
          new GetProductsAction({
            status: 1,
            ids: dataValue?.content?.products_ids?.join(','),
          }),
        );

        // Get Blogs
        const getBlogs$ = this.store.dispatch(
          new GetBlogsAction({
            status: 1,
            ids: dataValue?.content?.featured_blogs?.blog_ids?.join(','),
          }),
        );

        // Skeleton Loader
        document.body.classList.add('skeleton-body');

        forkJoin([getProducts$, getBlogs$]).subscribe({
          complete: () => {
            document.body.classList.remove('skeleton-body');
            this.themeOptionService.preloader = false;
          },
        });

        if (
          dataValue?.content?.categories_products &&
          dataValue?.content?.categories_products?.category_ids.length
        ) {
          this.selectCategory(dataValue?.content?.categories_products?.category_ids[0]);
        }
      }

      // Change color for this layout
      document.documentElement.style.setProperty('--theme-color', '#0baf9a');
      this.themeOptionService.theme_color = '#0baf9a';
    }
  }

  ngOnDestroy() {
    if (isPlatformBrowser(this.platformId)) {
      // Remove Color
      document.documentElement.style.removeProperty('--theme-color');
    }
  }

  selectCategory(id: number) {
    if (isPlatformBrowser(this.platformId)) {
      this.selectedCategoryId = id;
      this.categoryProduct$.subscribe(product => {
        this.productFilterIds = product.data
          .filter(product => product?.categories?.map(category => category.id).includes(id))
          ?.map(product => product.id)
          .slice(0, 5);
      });
    }
  }
}
