import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject, input } from '@angular/core';

import { Store } from '@ngxs/store';
import { forkJoin } from 'rxjs';

import { GetBlogsAction } from '@data-access/actions/blog.action';
import { GetProductsAction } from '@data-access/actions/product.action';
import { ImageLink } from '@shared/ui/image-link/image-link';
import { Title } from '@shared/ui/title/title';
import * as data from '../../../shared/data/owl-carousel';
import { IMadrid } from '@data-access/interfaces/theme.interface';
import { ThemeOptionService } from '@data-access/services/theme-option.service';
import { Banner } from '../widgets/banner/banner';
import { Blog } from '../widgets/blog/blog';
import { Categorie } from '../widgets/categorie/categorie';
import { Deal } from '../widgets/deal/deal';
import { HomeBanner } from '../widgets/home-banner/home-banner';
import { Product } from '../widgets/product/product';
import { WalletOffer } from '../widgets/wallet-offer/wallet-offer';

@Component({
  selector: 'app-madrid',
  templateUrl: './madrid.html',
  styleUrls: ['./madrid.scss'],
  imports: [HomeBanner, Banner, Title, Categorie, Product, WalletOffer, Deal, ImageLink, Blog],
})
export class Madrid {
  private store = inject(Store);
  private platformId = inject<Object>(PLATFORM_ID);
  private themeOptionService = inject(ThemeOptionService);

  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly data = input<IMadrid>();
  readonly slug = input<string>();

  public categorySlider = data.categorySlider9;
  public productSlider6Item = data.productSlider6Item;
  public productSlider6ItemMargin = data.productSlider6ItemMargin;
  public customOptionsItem4 = data.customOptionsItem4;

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
