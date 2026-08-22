import { isPlatformBrowser, AsyncPipe } from '@angular/common';
import { Component, inject, PLATFORM_ID } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';

import { LoadingBarModule } from '@ngx-loading-bar/core';
import { Observable } from 'rxjs';

import { AccountStore } from '@core/state/account.store';
import { AuthStore } from '@core/state/auth.store';
import { SiteConfigStore } from '@core/state/site-config.store';
import { ISiteConfig } from '@data-access/interfaces/site-config.interface';
import { SiteConfigService } from '@data-access/services/site-config.service';
import { Footer } from '@layout/footer/footer';
import { Header } from '@layout/header/header';
import { BackToTop } from '@shared/ui/back-to-top/back-to-top';
import { Cookie } from '@shared/ui/cookie/cookie';
import { Loader } from '@shared/ui/loader/loader';
import { ExitModal } from '@shared/ui/modal/exit-modal/exit-modal';
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
		NewsletterModal,
		Cookie,
		ExitModal,
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
	cookies$: Observable<boolean> = toObservable(this.siteConfigStore.cookies);
	exit$: Observable<boolean> = toObservable(this.siteConfigStore.exit);

	public cookies: boolean;
	public exit: boolean;
	public isBrowser: boolean;
	public isLoading: boolean = true;

	// Single app-wide chrome (Denver): logo + dark footer. Static — the old
	// per-theme pathname branching in setLogo() was removed with the theme concept.
	// Bound as plain fields (not a method call) so they don't re-run every CD cycle.
	public readonly headerLogo = 'assets/images/logo/6.png';
	public readonly footerData = {
		footer_logo: 'assets/images/logo/4.png',
		footer_class: 'footer-section-2 footer-color-3',
	};

	constructor() {
		this.isBrowser = isPlatformBrowser(this.platformId);
		this.cookies$.subscribe((res) => (this.cookies = res));
		this.exit$.subscribe((res) => (this.exit = res));
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
