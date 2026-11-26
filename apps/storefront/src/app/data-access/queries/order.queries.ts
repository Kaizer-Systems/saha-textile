import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';

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
		select: (res: IOrderModel): IOrder | undefined => res.data.find((order) => order.order_number == orderNumber()),
		enabled: !!orderNumber(),
	}));
}

/** The shopper's own orders, a page at a time (bundle builder brief E06). */
export function injectMyOrdersQuery(page: () => number, pageSize = 10) {
	const orderService = inject(OrderService);
	// The shopper's cookie lives in the browser; the server draws the page's frame only.
	const browser = isPlatformBrowser(inject(PLATFORM_ID));
	return injectQuery(() => ({
		queryKey: ['my-orders', page(), pageSize],
		queryFn: () => firstValueFrom(orderService.mine(page(), pageSize)),
		enabled: browser,
	}));
}

/** One of the shopper's own orders (E05). */
export function injectMyOrderQuery(orderNumber: () => string | undefined) {
	const orderService = inject(OrderService);
	const browser = isPlatformBrowser(inject(PLATFORM_ID));
	return injectQuery(() => ({
		queryKey: ['my-orders', 'one', orderNumber()],
		queryFn: () => firstValueFrom(orderService.one(orderNumber() ?? '')),
		enabled: browser && !!orderNumber(),
	}));
}
