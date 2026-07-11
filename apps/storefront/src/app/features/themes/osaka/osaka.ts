import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject, input } from '@angular/core';

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
	imports: [HomeBanner, Title, Categorie, Banner, Product, Collection, FourColumnProduct, Blog, Newsletter],
})
export class Osaka {
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
				// Products load on-demand in each widget (TanStack query); no page-
				// level prefetch. Drop the preloader now that the theme data is in.
				this.themeOptionService.preloader.set(false);
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
