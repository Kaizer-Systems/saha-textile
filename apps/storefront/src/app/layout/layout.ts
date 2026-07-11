import { isPlatformBrowser, AsyncPipe, PlatformLocation, isPlatformServer } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';

import { LoadingBarModule } from '@ngx-loading-bar/core';
import { Observable } from 'rxjs';

import { AccountStore } from '@core/state/account.store';
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
import { ThemeCustomizer } from '@shared/ui/theme-customizer/theme-customizer';
import { IOption } from '@data-access/interfaces/theme-option.interface';
import { ThemeOptionService } from '@data-access/services/theme-option.service';
import { ThemeOptionStore } from '@core/state/theme-option.store';

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
		ThemeCustomizer,
	],
})
export class Layout {
	private platformId = inject<Object>(PLATFORM_ID);
	themeOptionService = inject(ThemeOptionService);
	private platformLocation = inject(PlatformLocation);
	private themeOptionStore = inject(ThemeOptionStore);
	private accountStore = inject(AccountStore);

	themeOption$: Observable<IOption> = toObservable(this.themeOptionStore.themeOptions) as Observable<IOption>;
	cookies$: Observable<boolean> = toObservable(this.themeOptionStore.cookies);
	exit$: Observable<boolean> = toObservable(this.themeOptionStore.exit);

	public cookies: boolean;
	public exit: boolean;
	public isBrowser: boolean;
	public isLoading: boolean = true;

	constructor() {
		this.isBrowser = isPlatformBrowser(this.platformId);
		this.cookies$.subscribe((res) => (this.cookies = res));
		this.exit$.subscribe((res) => (this.exit = res));
		this.themeOptionService.preloader.set(true);
		this.accountStore.loadUser();
		// Categories, blogs and deal products now load on-demand via TanStack queries
		// in each consumer (footer/filters/sidebar, menu/blog pages, header/menu deals);
		// no Layout prefetch remains. Route components own their own loading skeletons,
		// so drop the preloader immediately (theme pages still manage it during their
		// own data fetch).
		this.themeOptionService.preloader.set(false);
	}

	setLogo() {
		var headerLogo;
		var footerLogo;
		var footerClass;

		const pathname = isPlatformBrowser(this.platformId)
			? window.location.pathname
			: isPlatformServer(this.platformId)
				? this.platformLocation.pathname
				: null;

		if (pathname) {
			if (pathname.includes('/theme/paris') || pathname.includes('/theme/osaka')) {
				headerLogo = 'assets/images/logo/1.png';
				footerLogo = 'assets/images/logo/1.png';
			} else if (pathname.includes('/theme/tokyo')) {
				headerLogo = 'assets/images/logo/2.png';
				footerLogo = 'assets/images/logo/2.png';
			} else if (pathname.includes('/theme/rome')) {
				headerLogo = 'assets/images/logo/3.png';
				footerLogo = 'assets/images/logo/3.png';
			} else if (pathname.includes('/theme/madrid')) {
				headerLogo = 'assets/images/logo/4.png';
				footerLogo = 'assets/images/logo/4.png';
				footerClass = 'footer-section-2 footer-color-2';
			} else if (pathname.includes('/theme/berlin') || pathname.includes('/theme/denver')) {
				headerLogo = 'assets/images/logo/6.png';
				footerLogo = 'assets/images/logo/4.png';
				footerClass = 'footer-section-2 footer-color-3';
			} else {
				this.themeOption$.subscribe((theme) => {
					headerLogo = theme?.logo?.header_logo?.original_url;
					footerLogo = theme?.logo?.footer_logo?.original_url;
					footerClass = theme?.footer.footer_style === 'dark_mode' ? 'footer-section-2 footer-color-3' : '';
				});
			}
		}
		return {
			header_logo: headerLogo,
			footer: { footer_logo: footerLogo, footer_class: footerClass },
		};
	}
}
