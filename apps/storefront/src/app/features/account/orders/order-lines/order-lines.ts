import { Component, computed, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { orderMoney } from '../order-money';
import { orderLineGroups } from './order-line-groups';

import type { ShopOrderView } from '@saha-textile/contracts';

/**
 * An order's lines as cards (owner, 22 Nov 2026: the order page on phones, no sideways scroll, "next level"): each
 * line of its own is a card with its picture, name, choices and money; a set's pieces, their free items and its
 * extras hang beneath it on a rail, numbered, as the cart draws them. Usable wherever an order is shown whole (the
 * order page today; a thank-you page later).
 */
@Component({
	selector: 'app-order-lines',
	templateUrl: './order-lines.html',
	styleUrls: ['./order-lines.scss'],
	imports: [TranslocoModule],
})
export class OrderLines {
	readonly order = input.required<ShopOrderView>();

	readonly groups = computed(() => orderLineGroups(this.order().lines));
	readonly money = orderMoney;
}
