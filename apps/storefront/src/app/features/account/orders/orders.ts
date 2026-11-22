import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import { injectMyOrdersQuery } from '@data-access/queries/order.queries';
import { NoData } from '@shared/ui/no-data/no-data';
import { Pagination } from '@shared/ui/pagination/pagination';

import { orderItemsText, orderMoney, orderPill } from './order-money';

import type { ShopOrderSummary } from '@saha-textile/contracts';

/**
 * My orders on the shopper's real orders (bundle builder brief E06, approved 2026-11-22): Order, Date, Items, Total
 * and Status on laptops; on phones each order is a card, so nothing scrolls sideways (owner, 22 Nov 2026).
 */
@Component({
	selector: 'app-orders',
	templateUrl: './orders.html',
	styleUrls: ['./orders.scss'],
	imports: [RouterLink, Pagination, NoData, DatePipe, TranslocoModule],
})
export class Orders {
	private readonly transloco = inject(TranslocoService);

	readonly pageSize = 10;
	readonly page = signal(1);
	private readonly query = injectMyOrdersQuery(() => this.page(), this.pageSize);
	readonly result = computed(() => this.query.data());
	readonly orders = computed(() => this.result()?.items ?? []);

	readonly money = orderMoney;
	readonly pill = orderPill;

	items(order: ShopOrderSummary): string {
		return orderItemsText(order, (key, params) => this.transloco.translate(key, params));
	}

	setPaginate(page: number) {
		this.page.set(page);
	}
}
