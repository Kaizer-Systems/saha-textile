import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject, viewChild, input } from '@angular/core';

import { ImageLink } from '@shared/ui/image-link/image-link';
import { ExitModal } from '@shared/ui/modal/exit-modal/exit-modal';
import { NewsletterModal } from '@shared/ui/modal/newsletter-modal/newsletter-modal';
import { Title } from '@shared/ui/title/title';
import * as data from '../../../shared/data/owl-carousel';
import { IParis } from '@data-access/interfaces/theme.interface';
import { ThemeOptionService } from '@data-access/services/theme-option.service';
import { Banner } from '../widgets/banner/banner';
import { Blog } from '../widgets/blog/blog';
import { Categorie } from '../widgets/categorie/categorie';
import { HomeBanner } from '../widgets/home-banner/home-banner';
import { Newsletter } from '../widgets/newsletter/newsletter';
import { Product } from '../widgets/product/product';

@Component({
	selector: 'app-paris',
	templateUrl: './paris.html',
	styleUrls: ['./paris.scss'],
	imports: [HomeBanner, Banner, Categorie, Product, Title, ImageLink, Blog, Newsletter],
})
export class Paris {
	private platformId = inject<Object>(PLATFORM_ID);
	private themeOptionService = inject(ThemeOptionService);

	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly data = input<IParis>();
	readonly slug = input<string>();

	readonly NewsletterModal = viewChild<NewsletterModal>('newsletterModal');
	readonly ExitModal = viewChild<ExitModal>('exitModal');

	public categorySlider = data.categorySlider;
	public isBrowser: boolean;

	constructor() {
		this.isBrowser = isPlatformBrowser(this.platformId);
	}

	ngOnInit() {
		if (this.isBrowser) {
			const dataValue = this.data();
			if (dataValue?.slug == this.slug()) {
				// Products load on-demand in each widget (TanStack query); no page-
				// level prefetch. Drop the preloader now that the theme data is in.
				this.themeOptionService.preloader.set(false);
			}

			// Change color for this layout
			document.documentElement.style.setProperty('--theme-color', '#0da487');
			this.themeOptionService.theme_color = '#0da487';
		}
	}

	ngOnDestroy() {
		if (this.isBrowser) {
			// Remove Color
			document.documentElement.style.removeProperty('--theme-color');
		}
	}
}
