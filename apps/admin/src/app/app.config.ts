import { CurrencyPipe } from '@angular/common';
import { HTTP_INTERCEPTORS, provideHttpClient, withFetch, withInterceptorsFromDi } from '@angular/common/http';
import { ApplicationConfig, isDevMode, provideZoneChangeDetection } from '@angular/core';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter, withInMemoryScrolling } from '@angular/router';

import { provideTransloco } from '@jsverse/transloco';
import { provideEffects } from '@ngrx/effects';
import { provideStore } from '@ngrx/store';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { provideToastr } from 'ngx-toastr';

import { AdminAuthGateway } from '@core/auth/auth-gateway';
import { HttpAdminAuthGateway } from '@core/auth/http-auth.gateway';
import { provideAdminSessionBootstrap } from '@core/auth/session-bootstrap';
import { AdminCustomersGateway } from '@core/admin-customers/admin-customers.gateway';
import { HttpAdminCustomersGateway } from '@core/admin-customers/http-admin-customers.gateway';
import { AdminNotificationsGateway } from '@core/admin-notifications/admin-notifications.gateway';
import { HttpAdminNotificationsGateway } from '@core/admin-notifications/http-admin-notifications.gateway';
import { AdminRolesGateway } from '@core/admin-roles/admin-roles.gateway';
import { HttpAdminRolesGateway } from '@core/admin-roles/http-admin-roles.gateway';
import { AdminUsersGateway } from '@core/admin-users/admin-users.gateway';
import { HttpAdminUsersGateway } from '@core/admin-users/http-admin-users.gateway';
import { provideRuntimeConfig } from '@core/config/runtime-config';
import { AuthInterceptor } from '@core/interceptors/auth.interceptor';
import { GlobalErrorHandlerInterceptor } from '@core/interceptors/global-error-handler.interceptor';
import { LoaderInterceptor } from '@core/interceptors/loader.interceptor';
import { CartEffects } from '@core/state/cart/cart.effects';
import { cartReducer } from '@core/state/cart/cart.reducer';

import { routes } from './app.routes';
import { TranslocoHttpLoader } from './core/i18n/transloco-loader';

export const appConfig: ApplicationConfig = {
	providers: [
		CurrencyPipe,
		// Public runtime config: fetches /config.json before the app starts and
		// fills the mutable environment (no fileReplacements for deploy URLs).
		provideRuntimeConfig(),
		// The one binding that decides how this app talks to the auth API. Components,
		// guards and stores depend on the abstract gateway, so swapping the transport (or
		// faking it in a test) is this line, not a search across features.
		{ provide: AdminAuthGateway, useClass: HttpAdminAuthGateway },
		// Admin user management gateway binding.
		{ provide: AdminUsersGateway, useClass: HttpAdminUsersGateway },
		// Admin customer CRM gateway binding (`DEC-ACCOUNT-SEPARATION` D3).
		{ provide: AdminCustomersGateway, useClass: HttpAdminCustomersGateway },
		// Non-secret notification Settings (MSG91 Authkey stays in API env).
		{ provide: AdminNotificationsGateway, useClass: HttpAdminNotificationsGateway },
		// Admin roles + permission registry gateway (auth pass 5c.3 UI wiring).
		{ provide: AdminRolesGateway, useClass: HttpAdminRolesGateway },
		// Resolves the admin cookie session before routing, so the guard protecting the
		// whole back office never runs against an undetermined session.
		provideAdminSessionBootstrap(),
		provideRouter(
			routes,
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
		provideZoneChangeDetection({ eventCoalescing: true }),
		provideAnimations(),
		provideStore({ cart: cartReducer }),
		provideEffects(CartEffects),
		provideTanStackQuery(new QueryClient()),
		provideHttpClient(withInterceptorsFromDi(), withFetch()),
		provideToastr({
			positionClass: 'toast-top-center',
		}),
	],
};
