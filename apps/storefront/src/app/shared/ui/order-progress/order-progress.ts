import { Component, computed, input } from '@angular/core';

import { ORDER_STEPS, orderStepRank } from './order-steps';

import type { OrderStatus } from '@saha-textile/contracts';

/**
 * A slim five-step track of how far an order has come (owner, 22 Nov 2026: My orders on phones, "next level"): the
 * steps reached fill in the theme colour, all of them turn green once delivered, and a cancelled order shows its track
 * in the danger colour. Pure CSS, no pictures, so a list of orders costs nothing extra to draw.
 */
@Component({
	selector: 'app-order-progress',
	templateUrl: './order-progress.html',
	styleUrls: ['./order-progress.scss'],
})
export class OrderProgress {
	readonly status = input.required<OrderStatus>();
	/** Read out instead of the bar ("Processing"). */
	readonly label = input('');

	readonly steps = ORDER_STEPS;
	readonly rank = computed(() => orderStepRank(this.status()));
	readonly cancelled = computed(() => this.status() === 'cancelled');
	readonly delivered = computed(() => this.status() === 'delivered');

	/** A cancelled order's whole track is tinted; otherwise the steps up to the one reached. */
	reached(at: number): boolean {
		const rank = this.rank();
		return this.cancelled() || (rank !== null && at <= rank);
	}
}
