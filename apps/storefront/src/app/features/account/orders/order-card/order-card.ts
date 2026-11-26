import { DatePipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { OrderProgress } from '@shared/ui/order-progress/order-progress';
import { ThumbStack } from '@shared/ui/thumb-stack/thumb-stack';

import { orderMoney, orderPill, orderThumbs } from '../order-money';

import type { ShopOrderSummary } from '@saha-textile/contracts';

/**
 * One order as a card (owner, 22 Nov 2026: My orders on phones and tablets, nothing scrolls sideways, "next level"):
 * its pictures fanned out, number and date, what it holds as chips, its status with a five-step track and since when,
 * and the total. The whole card opens the order. Usable wherever a short list of orders shows (My orders today; the
 * account home's recent orders later).
 */
@Component({
	selector: 'app-order-card',
	templateUrl: './order-card.html',
	styleUrls: ['./order-card.scss'],
	imports: [RouterLink, DatePipe, TranslocoModule, ThumbStack, OrderProgress],
})
export class OrderCard {
	readonly order = input.required<ShopOrderSummary>();

	readonly money = orderMoney;
	readonly pill = orderPill;

	/** Lines of its own beyond the first one named. */
	readonly more = computed(() => Math.max(0, this.order().sets + this.order().products - 1));
	readonly thumbs = computed(() => orderThumbs(this.order()));
	/** Pictures beyond the ones in the stack. */
	readonly morePictures = computed(() =>
		Math.max(0, this.order().sets + this.order().products - this.thumbs().length),
	);
	/** Delivered and cancelled orders say "on", the rest "since". */
	readonly settled = computed(() => this.order().status === 'delivered' || this.order().status === 'cancelled');
}
