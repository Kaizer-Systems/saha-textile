import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject, input } from '@angular/core';


import { ImageLink } from '@shared/ui/image-link/image-link';
import { Title } from '@shared/ui/title/title';
import * as data from '../../../shared/data/owl-carousel';
import { IBerlin } from '@data-access/interfaces/theme.interface';
import { ThemeOptionService } from '@data-access/services/theme-option.service';
import { Categorie } from '../widgets/categorie/categorie';
import { HomeBanner } from '../widgets/home-banner/home-banner';
import { Newsletter } from '../widgets/newsletter/newsletter';
import { Product } from '../widgets/product/product';
import { Service } from '../widgets/service/service';

@Component({
  selector: 'app-berlin',
  templateUrl: './berlin.html',
  styleUrls: ['./berlin.scss'],
  imports: [HomeBanner, Service, Title, Product, Categorie, ImageLink, Newsletter],
})
export class Berlin {
  private platformId = inject<Object>(PLATFORM_ID);
  private themeOptionService = inject(ThemeOptionService);

  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly data = input<IBerlin>();
  readonly slug = input<string>();

  public categorySlider = data.categorySlider;
  public productSliderMargin = data.productSliderMargin;

  ngOnInit() {
    if (isPlatformBrowser(this.platformId)) {
      const dataValue = this.data();
      if (dataValue?.slug == this.slug()) {
        // Products load on-demand in each widget (TanStack query); no page-
        // level prefetch. Drop the preloader now that the theme data is in.
        this.themeOptionService.preloader = false;
      }

      // Change color for this layout
      document.documentElement.style.setProperty('--theme-color', '#417394');
      this.themeOptionService.theme_color = '#417394';
    }
  }

  ngOnDestroy() {
    if (isPlatformBrowser(this.platformId)) {
      // Remove Color
      document.documentElement.style.removeProperty('--theme-color');
    }
  }
}
