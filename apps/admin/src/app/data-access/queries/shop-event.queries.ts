import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { ShopEventService } from '@data-access/services/shop-event.service';

/** Launch and sale events for the admin table, any state. */
export function injectShopEventsQuery(params: () => Params) {
	const events = inject(ShopEventService);
	return injectQuery(() => ({
		queryKey: ['shop-events', params()],
		queryFn: () => firstValueFrom(events.list(params())),
	}));
}
