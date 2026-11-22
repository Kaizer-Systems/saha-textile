import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import { injectMyOrdersQuery } from '@data-access/queries/order.queries';
import { NoData } from '@shared/ui/no-data/no-data';
import { OrderProgress } from '@shared/ui/order-progress/order-progress';
import { Pagination } from '@shared/ui/pagination/pagination';
import { ThumbStack } from '@shared/ui/thumb-stack/thumb-stack';

import { OrderCard } from './order-card/order-card';
import { orderItemsText, orderMoney, orderPill, orderThumbs } from './order-money';

import type { ShopOrderSummary } from '@saha-textile/contracts';

/**
 * My orders on the shopper's real orders (bundle builder brief E06, approved 2026-11-22): Order, Date, Items, Total
 * and Status on laptops; on phones and tablets each order is a card (OrderCard), so nothing scrolls sideways (owner,
 * 22 Nov 2026: "a mobile specific better view").
 */
@Component({
	selector: 'app-orders',
	templateUrl: './orders.html',
	styleUrls: ['./orders.scss'],
	imports: [RouterLink, Pagination, NoData, DatePipe, TranslocoModule, OrderCard, ThumbStack, OrderProgress],
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
	readonly thumbs = orderThumbs;

	items(order: ShopOrderSummary): string {
		return orderItemsText(order, (key, params) => this.transloco.translate(key, params));
	}

	setPaginate(page: number) {
		this.page.set(page);
	}
}
