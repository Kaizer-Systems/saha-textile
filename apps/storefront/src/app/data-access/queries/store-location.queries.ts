import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { ACTIVE_LOCALE } from '@core/i18n/active-locale';
import { StoreLocationService } from '@data-access/services/store-location.service';

/** The active stores in display order. The language is in the key. */
export function injectStoreLocationsQuery() {
	const service = inject(StoreLocationService);
	const locale = inject(ACTIVE_LOCALE);
	return injectQuery(() => ({
		queryKey: ['store-locations', locale],
		queryFn: () => firstValueFrom(service.getStores()),
		staleTime: 60 * 1000,
	}));
}
