import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { IOrder, IOrderModel } from '@data-access/interfaces/order.interface';
import { OrderService } from '@data-access/services/order.service';

/**
 * Orders list (replaces NGXS OrderState.order + GetOrdersAction). Keyed on
 * paginate params. Checkout/place/clear were client-side mocks — moved into the
 * checkout component locally.
 */
export function injectOrdersQuery(params: () => Params) {
  const orderService = inject(OrderService);
  return injectQuery(() => ({
    queryKey: ['orders', params()],
    queryFn: () => firstValueFrom(orderService.getOrders(params())),
  }));
}

/**
 * A single order by its order_number (replaces ViewOrderAction + selectedOrder).
 * Fetches the order list and selects the match (mock data has no by-id endpoint).
 */
export function injectOrderByNumberQuery(orderNumber: () => number | string | undefined) {
  const orderService = inject(OrderService);
  return injectQuery(() => ({
    queryKey: ['orders', 'all'],
    queryFn: () => firstValueFrom(orderService.getOrders()),
    select: (res: IOrderModel): IOrder | undefined =>
      res.data.find(order => order.order_number == orderNumber()),
    enabled: !!orderNumber(),
  }));
}
