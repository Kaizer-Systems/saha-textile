import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { CountryService } from '@data-access/services/country.service';

/**
 * TanStack Query for countries (replaces NGXS CountryState + GetCountriesAction).
 * Countries are static reference data — cache indefinitely (mirrors the old
 * "if already loaded, skip" load-once behaviour). Consumers map to Select2Data
 * via a computed (see address-modal).
 */
export function injectCountriesQuery() {
	const countryService = inject(CountryService);
	return injectQuery(() => ({
		queryKey: ['countries'],
		queryFn: () => firstValueFrom(countryService.getCountries()),
		staleTime: Infinity,
	}));
}
