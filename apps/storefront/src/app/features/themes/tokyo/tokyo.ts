import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject, input } from '@angular/core';


import { ImageLink } from '@shared/ui/image-link/image-link';
import { Title } from '@shared/ui/title/title';
import * as data from '../../../shared/data/owl-carousel';
import { ITokyo } from '@data-access/interfaces/theme.interface';
import { ThemeOptionService } from '@data-access/services/theme-option.service';
import { Banner } from '../widgets/banner/banner';
import { Categorie } from '../widgets/categorie/categorie';
import { FourColumnProduct } from '../widgets/four-column-product/four-column-product';
import { HomeBanner } from '../widgets/home-banner/home-banner';
import { Newsletter } from '../widgets/newsletter/newsletter';
import { Product } from '../widgets/product/product';

@Component({
  selector: 'app-tokyo',
  templateUrl: './tokyo.html',
  styleUrls: ['./tokyo.scss'],
  imports: [
    HomeBanner,
    Categorie,
    Banner,
    Title,
    Product,
    ImageLink,
    FourColumnProduct,
    Newsletter,
  ],
})
export class Tokyo {
  private platformId = inject<Object>(PLATFORM_ID);
  private themeOptionService = inject(ThemeOptionService);

  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly data = input<ITokyo>();
  readonly slug = input<string>();

  public productSlider = data.productSlider2;
  public categorySlider = data.categorySlider9;

  ngOnInit() {
    if (isPlatformBrowser(this.platformId)) {
      const dataValue = this.data();
      if (dataValue?.slug == this.slug()) {
        // Products load on-demand in each widget (TanStack query); no page-
        // level prefetch. Drop the preloader now that the theme data is in.
        this.themeOptionService.preloader = false;
      }

      // Change color for this layout
      document.documentElement.style.setProperty('--theme-color', '#d99f46');
      this.themeOptionService.theme_color = '#d99f46';
    }
  }

  ngAfterViewChecked() {
    if (isPlatformBrowser(this.platformId)) {
      // Add Topbar Dark Class
      document.querySelector('.header-top')?.classList.add('bg-dark');
    }
  }

  ngOnDestroy() {
    if (isPlatformBrowser(this.platformId)) {
      // Remove Color
      document.documentElement.style.removeProperty('--theme-color');

      // Remove Topbar Dark Class for this theme only
      document.querySelector('.header-top')?.classList.remove('bg-dark');
    }
  }
}
