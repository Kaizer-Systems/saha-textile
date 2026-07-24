import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { StoreService } from '@data-access/services/store.service';

export function injectStoresQuery(params: () => Params) {
	const storeService = inject(StoreService);
	return injectQuery(() => ({
		queryKey: ['stores', params()],
		queryFn: () => firstValueFrom(storeService.getStores(params())),
	}));
}
