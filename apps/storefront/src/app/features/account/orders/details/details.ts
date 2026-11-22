import { DatePipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { map } from 'rxjs';

import { injectMyOrderQuery } from '@data-access/queries/order.queries';

import { orderMoney, orderPill } from '../order-money';

import type { OrderStatus, ShopOrderLine } from '@saha-textile/contracts';

/** The steps across the top, with the theme's tracking icons. */
const STEPS: ReadonlyArray<{ status: OrderStatus; icon: string }> = [
	{ status: 'placed', icon: 'pending' },
	{ status: 'processing', icon: 'processing' },
	{ status: 'shipped', icon: 'shipped' },
	{ status: 'out_for_delivery', icon: 'out-for-delivery' },
	{ status: 'delivered', icon: 'delivered' },
];
const RANK: Partial<Record<OrderStatus, number>> = {
	placed: 0,
	processing: 1,
	packed: 1,
	shipped: 2,
	out_for_delivery: 3,
	delivered: 4,
};

/**
 * One of the shopper's own orders (bundle builder brief E05, approved 2026-11-22): the steps so far, every line with
 * a set's pieces, their free items and its extras beneath it, the money in the currency paid, and the delivery
 * address.
 */
@Component({
	selector: 'app-order-details',
	templateUrl: './details.html',
	styleUrls: ['./details.scss'],
	imports: [DatePipe, TranslocoModule],
})
export class OrderDetails {
	private readonly route = inject(ActivatedRoute);

	private readonly orderNumber = toSignal(this.route.params.pipe(map((params) => params['id'] as string)));
	private readonly query = injectMyOrderQuery(() => this.orderNumber());
	readonly order = computed(() => this.query.data());
	readonly missing = computed(() => this.query.isError());

	readonly steps = STEPS;
	readonly money = orderMoney;
	readonly pill = orderPill;

	reached(step: OrderStatus): boolean {
		const at = RANK[this.order()?.status ?? 'placed'];
		return at !== undefined && (RANK[step] ?? 99) <= at;
	}

	/** Lines of their own and free items: the parcel's item count. */
	readonly itemCount = computed(() => (this.order()?.lines ?? []).filter((line) => !line.parentLineId).length);

	depthOf(line: ShopOrderLine): number {
		if (!line.parentLineId) return 0;
		const parent = this.order()?.lines.find((row) => row.lineId === line.parentLineId);
		return parent?.parentLineId ? 2 : 1;
	}

	pieceNumber(line: ShopOrderLine): number {
		const siblings = (this.order()?.lines ?? []).filter(
			(row) => row.parentLineId === line.parentLineId && row.role === 'piece',
		);
		return siblings.indexOf(line) + 1;
	}

	/** "3 pieces + 1 extra" for a set; "2 free items" for a product with free items. */
	childCounts(line: ShopOrderLine): { pieces: number; extras: number; free: number } {
		const children = (this.order()?.lines ?? []).filter((row) => row.parentLineId === line.lineId);
		return {
			pieces: children.filter((row) => row.role === 'piece').length,
			extras: children.filter((row) => row.role === 'extra').length,
			free: children.filter((row) => row.role === 'free').length,
		};
	}
}
