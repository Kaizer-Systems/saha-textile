import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { AdminLanguagesGateway } from '@core/admin-languages/admin-languages.gateway';

export const LANGUAGE_SETTINGS_QUERY_KEY = ['admin-languages'] as const;
export const LANGUAGE_REMINDERS_QUERY_KEY = ['admin-language-reminders'] as const;

export function injectLanguageSettingsQuery() {
	const gateway = inject(AdminLanguagesGateway);
	return injectQuery(() => ({
		queryKey: LANGUAGE_SETTINGS_QUERY_KEY,
		queryFn: () => lastValueFrom(gateway.settings()),
	}));
}

/** The bell's reminders about deleted languages' stored text; asked only of people who manage languages. */
export function injectLanguageRemindersQuery(enabled: () => boolean) {
	const gateway = inject(AdminLanguagesGateway);
	return injectQuery(() => ({
		queryKey: LANGUAGE_REMINDERS_QUERY_KEY,
		queryFn: () => lastValueFrom(gateway.reminders()),
		enabled: enabled(),
		staleTime: 10 * 60_000,
	}));
}
