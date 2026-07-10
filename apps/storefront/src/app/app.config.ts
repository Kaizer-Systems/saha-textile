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
import { provideEffects } from '@ngrx/effects';
import { provideState, provideStore } from '@ngrx/store';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { provideToastr } from 'ngx-toastr';

import { CartEffects } from '@core/state/cart/cart.effects';
import { CART_FEATURE_KEY } from '@core/state/cart/cart.models';
import { cartPersistenceMetaReducer } from '@core/state/cart/cart.persistence';
import { cartReducer } from '@core/state/cart/cart.reducer';
import {
  COMPARE_FEATURE_KEY,
  CompareEffects,
  compareReducer,
} from '@core/state/compare/compare.store';
import {
  WISHLIST_FEATURE_KEY,
  WishlistEffects,
  wishlistReducer,
} from '@core/state/wishlist/wishlist.store';

import { environment } from '../../public/environments/environment';
import { AuthInterceptor } from './core/interceptors/auth.interceptor';
import { GlobalErrorHandlerInterceptor } from './core/interceptors/global-error-handler.interceptor';
import { LoaderInterceptor } from './core/interceptors/loader.interceptor';
import { ErrorService } from '@data-access/services/error.service';
import { NotificationService } from '@data-access/services/notification.service';

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
    ),
    provideHttpClient(withInterceptorsFromDi(), withFetch()),
    // Classic NgRx (@ngrx/store + effects) — cart is heavily client-mutated with
    // optimistic updates, so it moves here rather than to TanStack/SignalStore.
    provideStore(),
    provideState(CART_FEATURE_KEY, cartReducer, { metaReducers: [cartPersistenceMetaReducer] }),
    provideState(WISHLIST_FEATURE_KEY, wishlistReducer),
    provideState(COMPARE_FEATURE_KEY, compareReducer),
    provideEffects(CartEffects, WishlistEffects, CompareEffects),
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
