import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { SearchTermService } from '@data-access/services/search-term.service';

/** Search words for the admin table, any status, latest change first. */
export function injectSearchTermsQuery(params: () => Params) {
	const service = inject(SearchTermService);
	return injectQuery(() => ({
		queryKey: ['search-terms', params()],
		queryFn: () => firstValueFrom(service.list(params())),
	}));
}

/** One search word with its tagged products, for the form. */
export function injectSearchTermQuery(id: () => string | undefined) {
	const service = inject(SearchTermService);
	return injectQuery(() => ({
		queryKey: ['search-term', id()],
		enabled: !!id(),
		queryFn: () => firstValueFrom(service.get(id() as string)),
	}));
}

/** Storefront settings › Search. */
export function injectStorefrontSearchSettingsQuery() {
	const service = inject(SearchTermService);
	return injectQuery(() => ({
		queryKey: ['storefront-settings', 'search'],
		queryFn: () => firstValueFrom(service.getSearchSettings()),
	}));
}
