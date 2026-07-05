import { inject } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { ShippingService } from '@data-access/services/shipping.service';

export function injectShippingsQuery(params: () => Params) {
	const shippingService = inject(ShippingService);
	return injectQuery(() => ({
		queryKey: ['shippings', params()],
		queryFn: () => firstValueFrom(shippingService.getShippings(params())),
	}));
}
