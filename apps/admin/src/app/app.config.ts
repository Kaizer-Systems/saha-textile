import { CurrencyPipe } from '@angular/common';
import {
	HTTP_INTERCEPTORS,
	HttpClient,
	provideHttpClient,
	withFetch,
	withInterceptorsFromDi,
} from '@angular/common/http';
import { ApplicationConfig, importProvidersFrom, provideZoneChangeDetection } from '@angular/core';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter, withInMemoryScrolling } from '@angular/router';

import { provideEffects } from '@ngrx/effects';
import { provideStore } from '@ngrx/store';
import { TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { provideToastr } from 'ngx-toastr';

import { routes } from './app.routes';
import { CartEffects } from '@core/state/cart/cart.effects';
import { cartReducer } from '@core/state/cart/cart.reducer';
import { AuthInterceptor } from '@core/interceptors/auth.interceptor';
import { GlobalErrorHandlerInterceptor } from '@core/interceptors/global-error-handler.interceptor';
import { LoaderInterceptor } from '@core/interceptors/loader.interceptor';

export function HttpLoaderFactory(http: HttpClient) {
	return new TranslateHttpLoader(http, './assets/i18n/', '.json');
}

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
		importProvidersFrom(
			TranslateModule.forRoot({
				loader: {
					provide: TranslateLoader,
					useFactory: HttpLoaderFactory,
					deps: [HttpClient],
				},
			}),
		),
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
