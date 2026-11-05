import { CurrencyPipe } from '@angular/common';
import {
	HTTP_INTERCEPTORS,
	provideHttpClient,
	withFetch,
	withInterceptorsFromDi,
	ɵHTTP_FETCH_MAX_RESPONSE_SIZE,
} from '@angular/common/http';
import { ApplicationConfig, importProvidersFrom, isDevMode, provideZoneChangeDetection } from '@angular/core';
import {
	BrowserModule,
	provideClientHydration,
	withEventReplay,
	withHttpTransferCacheOptions,
} from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { withInMemoryScrolling } from '@angular/router';

import { provideFileRouter } from '@analogjs/router';
import { provideToastr } from '@damjantonkli/ngx-toastr';
import { provideTransloco } from '@jsverse/transloco';
import { provideEffects } from '@ngrx/effects';
import { provideState, provideStore } from '@ngrx/store';
import { LoadingBarRouterModule } from '@ngx-loading-bar/router';
import { provideTanStackQuery } from '@tanstack/angular-query-experimental';

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
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from './core/i18n/locale';
import { provideLocaleRouting } from './core/i18n/locale-routing';
import { TranslocoHttpLoader } from './core/i18n/transloco-loader';
import { AuthInterceptor } from './core/interceptors/auth.interceptor';
import { GlobalErrorHandlerInterceptor } from './core/interceptors/global-error-handler.interceptor';
import { LoaderInterceptor } from './core/interceptors/loader.interceptor';
import { QUERY_CLIENT, isPublicRequest } from './core/query/query-client';

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
		// Every route is served under its locale (`/en/…`, `/fr/…`) as the router's base —
		// see provideLocaleRouting; the pages themselves stay locale-free.
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
		// Angular 22 caps an SSR fetch body at 1MB. The theme catalogue fixture is larger,
		// and a capped read fails the render before the page can paint.
		{ provide: ɵHTTP_FETCH_MAX_RESPONSE_SIZE, useValue: 8 * 1024 * 1024 },
		// Transloco — the locked i18n lib (ngx-translate fully removed). Loads
		// assets/i18n/<lang>.json via TranslocoHttpLoader. The active language comes from
		// the URL prefix (provideLocaleRouting), never from storage; the switcher changes
		// it by navigating to the other prefix.
		provideLocaleRouting(),
		provideTransloco({
			config: {
				availableLangs: [...SUPPORTED_LOCALES],
				defaultLang: DEFAULT_LOCALE,
				fallbackLang: DEFAULT_LOCALE,
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
		provideTanStackQuery(QUERY_CLIENT),
		// The browser adopts the server's DOM instead of re-rendering it. Only public GETs
		// are replayed from the server; clicks made before hydration are replayed too.
		provideClientHydration(withHttpTransferCacheOptions({ filter: isPublicRequest }), withEventReplay()),
		provideZoneChangeDetection({ eventCoalescing: true }),
		provideToastr({
			positionClass: 'toast-top-center',
			preventDuplicates: true,
		}),
	],
};
