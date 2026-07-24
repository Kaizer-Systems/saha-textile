import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { OrderService } from '@data-access/services/order.service';

export function injectOrdersQuery(params: () => Params) {
	const orderService = inject(OrderService);
	return injectQuery(() => ({
		queryKey: ['orders', params()],
		queryFn: () => firstValueFrom(orderService.getOrders(params())),
	}));
}
