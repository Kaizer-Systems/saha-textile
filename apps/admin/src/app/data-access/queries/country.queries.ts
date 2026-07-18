import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { CountryService } from '@data-access/services/country.service';

export function injectCountriesQuery() {
	const countryService = inject(CountryService);
	return injectQuery(() => ({
		queryKey: ['countries'],
		queryFn: () => firstValueFrom(countryService.getCountries()),
		staleTime: Infinity, // countries are effectively static — load once and cache
	}));
}
