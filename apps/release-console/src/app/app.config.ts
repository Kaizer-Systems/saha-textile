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
			new QueryClient({
				defaultOptions: {
					queries: {
						retry: 1,
						// Owner, 21 Nov: screens must not sit blank or jump. An answer read in the last 30 s is shown
						// at once when a screen opens again (and refreshed behind it); answers are kept 15 minutes;
						// coming back to the window no longer re-reads every screen at once.
						staleTime: 30_000,
						gcTime: 15 * 60_000,
						refetchOnWindowFocus: false,
					},
				},
			}),
		),
	],
};
