import { inject } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { OrderStatusService } from '@data-access/services/order-status.service';

export function injectOrderStatusQuery(params: () => Params) {
	const orderStatusService = inject(OrderStatusService);
	return injectQuery(() => ({
		queryKey: ['order-status', params()],
		queryFn: () => firstValueFrom(orderStatusService.getOrderStatus(params())),
	}));
}
