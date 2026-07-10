import { isPlatformBrowser, AsyncPipe, PlatformLocation, isPlatformServer } from '@angular/common';
import { Component, inject, PLATFORM_ID } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { LoadingBarModule } from '@ngx-loading-bar/core';
import { Store } from '@ngxs/store';
import { Observable, forkJoin } from 'rxjs';

import { GetUserDetailsAction } from '@data-access/actions/account.action';
import { GetDealProductsAction } from '@data-access/actions/product.action';
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
import { ThemeOptionState } from '@data-access/states/theme-option.state';

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
  private store = inject(Store);
  private platformId = inject<Object>(PLATFORM_ID);
  themeOptionService = inject(ThemeOptionService);
  private platformLocation = inject(PlatformLocation);

  themeOption$: Observable<IOption> = inject(Store).select(
    ThemeOptionState.themeOptions,
  ) as Observable<IOption>;
  cookies$: Observable<boolean> = inject(Store).select(ThemeOptionState.cookies);
  exit$: Observable<boolean> = inject(Store).select(ThemeOptionState.exit);

  public cookies: boolean;
  public exit: boolean;
  public isBrowser: boolean;
  public isLoading: boolean = true;

  constructor() {
    this.isBrowser = isPlatformBrowser(this.platformId);
    this.cookies$.subscribe(res => (this.cookies = res));
    this.exit$.subscribe(res => (this.exit = res));
    this.themeOptionService.preloader = true;
    this.store.dispatch(new GetUserDetailsAction());
    // Categories and blogs now load on-demand via TanStack queries in each
    // consumer (footer/filters/sidebar, menu/blog pages); no Layout prefetch
    // needed. Deal products stay on NGXS until ProductState is migrated.
    const getProduct$ = this.store.dispatch(new GetDealProductsAction({ status: 1, paginate: 2 }));
    forkJoin([getProduct$]).subscribe({
      complete: () => {
        this.themeOptionService.preloader = false;
      },
    });
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
        this.themeOption$.subscribe(theme => {
          headerLogo = theme?.logo?.header_logo?.original_url;
          footerLogo = theme?.logo?.footer_logo?.original_url;
          footerClass =
            theme?.footer.footer_style === 'dark_mode' ? 'footer-section-2 footer-color-3' : '';
        });
      }
    }
    return {
      header_logo: headerLogo,
      footer: { footer_logo: footerLogo, footer_class: footerClass },
    };
  }
}
