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
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { provideToastr } from 'ngx-toastr';

import { environment } from '../../public/environments/environment';
import { AuthInterceptor } from './core/interceptors/auth.interceptor';
import { GlobalErrorHandlerInterceptor } from './core/interceptors/global-error-handler.interceptor';
import { LoaderInterceptor } from './core/interceptors/loader.interceptor';
import { ErrorService } from '@data-access/services/error.service';
import { NotificationService } from '@data-access/services/notification.service';
import { AccountState } from '@data-access/states/account.state';
import { AuthState } from '@data-access/states/auth.state';
import { CartState } from '@data-access/states/cart.state';
import { CompareState } from '@data-access/states/compare.state';
import { LoaderState } from '@data-access/states/loader.state';
import { NotificationState } from '@data-access/states/notification.state';
import { ProductState } from '@data-access/states/product.state';
import { SettingState } from '@data-access/states/setting.state';
import { ThemeOptionState } from '@data-access/states/theme-option.state';
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
        SettingState,
        ThemeOptionState,
        ProductState,
        CartState,
        WishlistState,
        CompareState,
        NotificationState,
      ]),
      NgxsStoragePluginModule.forRoot({
        keys: [
          'auth',
          'account',
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
    // TanStack Query — server-state (lists/details/dropdowns) migrated off NGXS
    // feature states, one feature at a time (queries in data-access/queries/).
    provideTanStackQuery(new QueryClient()),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideToastr({
      positionClass: 'toast-top-center',
      preventDuplicates: true,
    }),
  ],
};
