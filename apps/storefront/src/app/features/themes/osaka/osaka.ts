import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject, input } from '@angular/core';

import { Store } from '@ngxs/store';
import { forkJoin } from 'rxjs';

import { GetProductsAction } from '@data-access/actions/product.action';
import { Title } from '@shared/ui/title/title';
import * as data from '../../../shared/data/owl-carousel';
import { IOsaka } from '@data-access/interfaces/theme.interface';
import { ThemeOptionService } from '@data-access/services/theme-option.service';
import { Banner } from '../widgets/banner/banner';
import { Blog } from '../widgets/blog/blog';
import { Categorie } from '../widgets/categorie/categorie';
import { Collection } from '../widgets/collection/collection ';
import { FourColumnProduct } from '../widgets/four-column-product/four-column-product';
import { HomeBanner } from '../widgets/home-banner/home-banner';
import { Newsletter } from '../widgets/newsletter/newsletter';
import { Product } from '../widgets/product/product';

@Component({
  selector: 'app-osaka',
  templateUrl: './osaka.html',
  styleUrls: ['./osaka.scss'],
  imports: [
    HomeBanner,
    Title,
    Categorie,
    Banner,
    Product,
    Collection,
    FourColumnProduct,
    Blog,
    Newsletter,
  ],
})
export class Osaka {
  private store = inject(Store);
  private platformId = inject<Object>(PLATFORM_ID);
  private themeOptionService = inject(ThemeOptionService);

  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly data = input<IOsaka>();
  readonly slug = input<string>();

  public categorySlider = data.categorySlider9;
  public productSlider6Item = data.productSlider6Item;
  public productSlider = data.bannerSlider;

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

        // Skeleton Loader
        document.body.classList.add('skeleton-body');

        forkJoin([getProducts$]).subscribe({
          complete: () => {
            document.body.classList.remove('skeleton-body');
            this.themeOptionService.preloader = false;
          },
        });
      }

      // Change color for this layout
      document.documentElement.style.setProperty('--theme-color', '#239698');
      this.themeOptionService.theme_color = '#239698';
    }
  }

  ngOnDestroy() {
    if (isPlatformBrowser(this.platformId)) {
      // Remove Color
      document.documentElement.style.removeProperty('--theme-color');
    }
  }
}
