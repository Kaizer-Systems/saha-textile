import { isPlatformBrowser, AsyncPipe } from '@angular/common';
import { Component, DOCUMENT, effect, inject, PLATFORM_ID } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';

import { LoadingBarModule } from '@ngx-loading-bar/core';
import { Observable } from 'rxjs';

import { applyBrandHead } from '@core/brand/brand-head';
import { ShopEvents } from '@core/events/shop-events';
import { LocaleSeo } from '@core/i18n/locale-seo';
import { AccountStore } from '@core/state/account.store';
import { AuthStore } from '@core/state/auth.store';
import { SiteConfigStore } from '@core/state/site-config.store';
import { ISiteConfig } from '@data-access/interfaces/site-config.interface';
import { injectBrandQuery } from '@data-access/queries/brand.queries';
import { SiteConfigService } from '@data-access/services/site-config.service';
import { Footer } from '@layout/footer/footer';
import { Header } from '@layout/header/header';
import { BackToTop } from '@shared/ui/back-to-top/back-to-top';
import { Cookie } from '@shared/ui/cookie/cookie';
import { Loader } from '@shared/ui/loader/loader';
import { EventModal } from '@shared/ui/modal/event-modal/event-modal';
import { NewsletterModal } from '@shared/ui/modal/newsletter-modal/newsletter-modal';
import { RecentPurchasePopup } from '@shared/ui/recent-purchase-popup/recent-purchase-popup';
import { StickyCart } from '@shared/ui/sticky-cart/sticky-cart';
import { StickyCompare } from '@shared/ui/sticky-compare/sticky-compare';

@Component({
	selector: 'app-layout',
	templateUrl: './layout.html',
	styleUrls: ['./layout.scss'],
	imports: [
		LoadingBarModule,
		Loader,
		Header,
		RouterOutlet,
		Footer,
		RecentPurchasePopup,
		StickyCart,
		StickyCompare,
		BackToTop,
		EventModal,
		NewsletterModal,
		Cookie,
		AsyncPipe,
	],
})
export class Layout {
	private platformId = inject<Object>(PLATFORM_ID);
	siteConfigService = inject(SiteConfigService);
	private siteConfigStore = inject(SiteConfigStore);
	private accountStore = inject(AccountStore);
	private authStore = inject(AuthStore);

	siteConfig$: Observable<ISiteConfig> = toObservable(this.siteConfigStore.siteConfig) as Observable<ISiteConfig>;

	public isBrowser: boolean;
	public isLoading: boolean = true;

	// Single app-wide chrome: the dark footer. Logos come from the Brand Kit.
	public readonly footerData = {
		footer_class: 'footer-section-2 footer-color-3',
	};

	private readonly brand = injectBrandQuery();
	private readonly page = inject<Document>(DOCUMENT);
	private readonly seo = inject(LocaleSeo);
	private readonly shopEvents = inject(ShopEvents);

	constructor() {
		// Published launch and sale events: the top bar, the phone strip and the event popup.
		this.shopEvents.load();
		effect(() => {
			const brand = this.brand.data();
			if (!brand) return;
			applyBrandHead(this.page, brand, this.seo.absoluteUrl('/'));
			// Pages shared without their own picture show the Brand Kit's link preview picture.
			if (brand.shareImage) this.seo.setDefaultImage(brand.shareImage);
		});
		this.isBrowser = isPlatformBrowser(this.platformId);
		this.siteConfigService.preloader.set(true);
		// Only when there IS a session. A guest `/me` is 200 with `user: null`; this profile
		// load is for chrome that needs the full customer, not for discovering whether one exists.
		if (this.authStore.isAuthenticated()) this.accountStore.loadUser();
		// Categories, blogs and deal products load on-demand via TanStack queries in
		// each consumer (footer/filters/sidebar, menu/blog pages, header/menu deals);
		// no Layout prefetch remains. Route components own their own loading skeletons,
		// so drop the preloader immediately.
		this.siteConfigService.preloader.set(false);
	}
}
