import { CurrencyPipe } from '@angular/common';
import {
  HTTP_INTERCEPTORS,
  HttpClient,
  provideHttpClient,
  withFetch,
  withInterceptorsFromDi,
} from '@angular/common/http';
import { ApplicationConfig, importProvidersFrom, provideZoneChangeDetection } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { withInMemoryScrolling } from '@angular/router';

import { provideFileRouter, withExtraRoutes } from '@analogjs/router';
import { LoadingBarRouterModule } from '@ngx-loading-bar/router';
import { TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';
import { NgxsStoragePluginModule } from '@ngxs/storage-plugin';
import { NgxsModule } from '@ngxs/store';
import { provideToastr } from 'ngx-toastr';

import { environment } from '../../public/environments/environment';
import { AuthInterceptor } from './core/interceptors/auth.interceptor';
import { GlobalErrorHandlerInterceptor } from './core/interceptors/global-error-handler.interceptor';
import { LoaderInterceptor } from './core/interceptors/loader.interceptor';
import { ErrorService } from '@data-access/services/error.service';
import { NotificationService } from '@data-access/services/notification.service';
import { AccountState } from '@data-access/states/account.state';
import { AttributeState } from '@data-access/states/attribute.state';
import { AuthState } from '@data-access/states/auth.state';
import { BlogState } from '@data-access/states/blog.state';
import { CartState } from '@data-access/states/cart.state';
import { CategoryState } from '@data-access/states/category.state';
import { CompareState } from '@data-access/states/compare.state';
import { CountryState } from '@data-access/states/country.state';
import { CouponState } from '@data-access/states/coupon.state';
import { CurrencyState } from '@data-access/states/currency.state';
import { LoaderState } from '@data-access/states/loader.state';
import { NotificationState } from '@data-access/states/notification.state';
import { OrderStatusState } from '@data-access/states/order-status.state';
import { OrderState } from '@data-access/states/order.state';
import { PageState } from '@data-access/states/page.state';
import { PaymentDetailsState } from '@data-access/states/payment-details.state';
import { PointState } from '@data-access/states/point.state';
import { ProductState } from '@data-access/states/product.state';
import { QuestionAnswersState } from '@data-access/states/questions-answers.state';
import { RefundState } from '@data-access/states/refund.state';
import { ReviewState } from '@data-access/states/review.state';
import { SettingState } from '@data-access/states/setting.state';
import { StateState } from '@data-access/states/state.state';
import { TagState } from '@data-access/states/tag.state';
import { ThemeOptionState } from '@data-access/states/theme-option.state';
import { ThemeState } from '@data-access/states/theme.state';
import { WalletState } from '@data-access/states/wallet.state';
import { WishlistState } from '@data-access/states/wishlist.state';

export function HttpLoaderFactory(http: HttpClient) {
  // Absolute base URL (not './assets/i18n/') so the loader resolves correctly
  // under Nitro SSR — a relative URL resolves against http://localhost:80 on the
  // server (ECONNREFUSED). This mirrors the absolute environment.URL the data
  // services already use, so client behaviour is unchanged and prod picks up the
  // real host from environment.baseURL.
  return new TranslateHttpLoader(http, `${environment.baseURL}assets/i18n/`, '.json');
}

export const appConfig: ApplicationConfig = {
  providers: [
    CurrencyPipe,
    ErrorService,
    NotificationService,
    // Analog file-based routing (pages under src/app/pages). withExtraRoutes
    // holds the root redirect (matched before file routes); the pathless
    // (shell) group provides the global Layout. Replaces the old provideRouter
    // + app.routes.ts / feature *.routes.ts config.
    provideFileRouter(
      withExtraRoutes([{ path: '', redirectTo: 'theme/paris', pathMatch: 'full' }]),
      withInMemoryScrolling({
        anchorScrolling: 'enabled',
        scrollPositionRestoration: 'enabled',
      }),
    ),
    {
      provide: HTTP_INTERCEPTORS,
      useClass: AuthInterceptor,
      multi: true,
    },
    {
      provide: HTTP_INTERCEPTORS,
      useClass: GlobalErrorHandlerInterceptor,
      multi: true,
    },
    {
      provide: HTTP_INTERCEPTORS,
      useClass: LoaderInterceptor,
      multi: true,
    },
    importProvidersFrom(
      BrowserModule,
      BrowserAnimationsModule,
      LoadingBarRouterModule,
      TranslateModule.forRoot({
        loader: {
          provide: TranslateLoader,
          useFactory: HttpLoaderFactory,
          deps: [HttpClient],
        },
        defaultLanguage: 'en',
      }),
      NgxsModule.forRoot([
        LoaderState,
        AccountState,
        CountryState,
        StateState,
        SettingState,
        CurrencyState,
        ThemeState,
        ThemeOptionState,
        CategoryState,
        PageState,
        AttributeState,
        ProductState,
        CartState,
        BlogState,
        TagState,
        WishlistState,
        CompareState,
        OrderState,
        OrderStatusState,
        WalletState,
        PointState,
        RefundState,
        PaymentDetailsState,
        NotificationState,
        QuestionAnswersState,
        ReviewState,
        CouponState,
      ]),
      NgxsStoragePluginModule.forRoot({
        keys: [
          'auth',
          'account',
          'country',
          'state',
          'cart',
          'theme',
          'theme_option',
          'setting',
          'notification',
        ],
      }),
      NgxsModule.forFeature([AuthState]),
    ),
    provideHttpClient(withInterceptorsFromDi(), withFetch()),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideToastr({
      positionClass: 'toast-top-center',
      preventDuplicates: true,
    }),
  ],
};
