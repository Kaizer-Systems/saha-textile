import { CurrencyPipe } from '@angular/common';
import { HTTP_INTERCEPTORS, provideHttpClient, withFetch, withInterceptorsFromDi } from '@angular/common/http';
import { ApplicationConfig, isDevMode, provideAppInitializer, provideZoneChangeDetection } from '@angular/core';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter, withInMemoryScrolling } from '@angular/router';

import { provideTransloco } from '@jsverse/transloco';
import { provideEffects } from '@ngrx/effects';
import { provideStore } from '@ngrx/store';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { provideToastr } from 'ngx-toastr';

import { AuthInterceptor } from '@core/interceptors/auth.interceptor';
import { GlobalErrorHandlerInterceptor } from '@core/interceptors/global-error-handler.interceptor';
import { LoaderInterceptor } from '@core/interceptors/loader.interceptor';
import { CartEffects } from '@core/state/cart/cart.effects';
import { cartReducer } from '@core/state/cart/cart.reducer';

import { routes } from './app.routes';
import { applyRuntimeConfig } from '../../public/environments/environment';
import { loadRuntimeConfig } from './core/config/runtime-config';
import { TranslocoHttpLoader } from './core/i18n/transloco-loader';

export const appConfig: ApplicationConfig = {
	providers: [
		CurrencyPipe,
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
		provideAppInitializer(async () => applyRuntimeConfig(await loadRuntimeConfig())),
		provideToastr({
			positionClass: 'toast-top-center',
		}),
	],
};
