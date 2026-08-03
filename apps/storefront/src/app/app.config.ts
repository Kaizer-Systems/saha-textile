import { CurrencyPipe } from '@angular/common';
import { HTTP_INTERCEPTORS, provideHttpClient, withFetch, withInterceptorsFromDi } from '@angular/common/http';
import { ApplicationConfig, importProvidersFrom, isDevMode, provideZoneChangeDetection } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { withInMemoryScrolling } from '@angular/router';

import { provideFileRouter } from '@analogjs/router';
import { provideTransloco } from '@jsverse/transloco';
import { provideEffects } from '@ngrx/effects';
import { provideState, provideStore } from '@ngrx/store';
import { LoadingBarRouterModule } from '@ngx-loading-bar/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { provideToastr } from 'ngx-toastr';

import { CartEffects } from '@core/state/cart/cart.effects';
import { CART_FEATURE_KEY } from '@core/state/cart/cart.models';
import { cartPersistenceMetaReducer } from '@core/state/cart/cart.persistence';
import { cartReducer } from '@core/state/cart/cart.reducer';
import { COMPARE_FEATURE_KEY, CompareEffects, compareReducer } from '@core/state/compare/compare.store';
import { WISHLIST_FEATURE_KEY, WishlistEffects, wishlistReducer } from '@core/state/wishlist/wishlist.store';
import { ErrorService } from '@data-access/services/error.service';
import { NotificationService } from '@data-access/services/notification.service';

import { StorefrontAuthGateway } from './core/auth/auth-gateway';
import { HttpStorefrontAuthGateway } from './core/auth/http-auth.gateway';
import { provideSessionBootstrap } from './core/auth/session-bootstrap';
import { provideRuntimeConfig } from './core/config/runtime-config';
import { TranslocoHttpLoader } from './core/i18n/transloco-loader';
import { AuthInterceptor } from './core/interceptors/auth.interceptor';
import { GlobalErrorHandlerInterceptor } from './core/interceptors/global-error-handler.interceptor';
import { LoaderInterceptor } from './core/interceptors/loader.interceptor';

export const appConfig: ApplicationConfig = {
	providers: [
		CurrencyPipe,
		ErrorService,
		NotificationService,
		// Public runtime config: fetches /config.json before the app starts and
		// fills the mutable environment (no fileReplacements for deploy URLs).
		provideRuntimeConfig(),
		// The one binding that decides how this app talks to the auth API. Components,
		// guards and stores depend on the abstract gateway, so swapping the transport
		// (or faking it in a test) is this line, not a search across features.
		{ provide: StorefrontAuthGateway, useClass: HttpStorefrontAuthGateway },
		// Resolves the cookie session from /me before routing, so guards never run
		// against an undetermined session. Must come after provideRuntimeConfig().
		provideSessionBootstrap(),
		// Analog file-based routing (pages under src/app/pages). `/` is the custom
		// home (pages/index.page.ts → features/home). Replaces the old
		// provideRouter + app.routes.ts / feature *.routes.ts config.
		provideFileRouter(
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
		importProvidersFrom(BrowserModule, BrowserAnimationsModule, LoadingBarRouterModule),
		provideHttpClient(withInterceptorsFromDi(), withFetch()),
		// Transloco — the locked i18n lib (ngx-translate fully removed). Loads
		// assets/i18n/<lang>.json via TranslocoHttpLoader; the language switcher drives
		// it through TranslocoService.setActiveLang.
		provideTransloco({
			config: {
				availableLangs: ['en', 'fr'],
				defaultLang: 'en',
				fallbackLang: 'en',
				reRenderOnLangChange: true,
				prodMode: !isDevMode(),
				missingHandler: { useFallbackTranslation: true },
			},
			loader: TranslocoHttpLoader,
		}),
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
