import {
	type ApplicationConfig,
	provideBrowserGlobalErrorListeners,
	provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';

import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
	providers: [
		provideBrowserGlobalErrorListeners(),
		provideZonelessChangeDetection(),
		provideRouter(routes, withComponentInputBinding()),
		provideTanStackQuery(
			new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } }),
		),
	],
};
