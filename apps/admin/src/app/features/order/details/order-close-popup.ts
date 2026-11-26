import { Component, computed, inject, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

import { shippingReason } from '@core/orders/order-format';
import { OrdersGateway } from '@core/orders/orders.gateway';
import { RupeesPipe, apiProblem } from '@core/purchasing/purchasing-format';

import type { OpenOrderClose, OpenOrderClosePreview, Order } from '@saha-textile/contracts';

/** What the close popup hands back: the order is closed; `requestOnline` asks the page to open the request popup. */
export interface CloseOutcome {
	then: OpenOrderClose['then'];
	dueINR: number;
}

/**
 * Close an open order (brief oo08): adding stops, the shipping is worked out now for one parcel, and
 * the order moves on. Then: request what is due online now, record it by hand later, or (a business
 * within its credit) put it on its account. The numbers are the server's preview; nothing is saved
 * until Close the order is pressed.
 */
@Component({
	selector: 'app-order-close-popup',
	templateUrl: './order-close-popup.html',
	imports: [RupeesPipe, TranslocoModule],
})
export class OrderClosePopup {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(OrdersGateway);
	private readonly transloco = inject(TranslocoService);

	readonly order = signal<Order | null>(null);
	readonly preview = signal<OpenOrderClosePreview | null>(null);
	/** oo08: "first piece ₹2,000, then 23 more × ₹900", from the engine's own explanation. */
	readonly shipWhy = computed(() => {
		const p = this.preview();
		if (!p?.shippingTrace?.length) return '';
		const { reason } = shippingReason({ trace: p.shippingTrace, pieces: p.shippingPieces ?? [] }, (key, params) =>
			this.transloco.translate(key, params),
		);
		return this.transloco.getActiveLang() === 'en' && reason
			? reason.charAt(0).toLowerCase() + reason.slice(1)
			: reason;
	});
	readonly then = signal<OpenOrderClose['then']>('requestOnline');
	readonly busy = signal(false);
	readonly error = signal<string | null>(null);

	/** Nothing to request when the payments already cover the order. */
	readonly nothingDue = computed(() => (this.preview()?.dueINR ?? 0) <= 0);

	async start(order: Order): Promise<void> {
		this.order.set(order);
		try {
			const preview = await firstValueFrom(this.gateway.closePreview(order.id));
			this.preview.set(preview);
			if (preview.dueINR <= 0) this.then.set('recordLater');
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('ord_action_failed')));
		}
	}

	canClose(): boolean {
		const preview = this.preview();
		if (this.busy() || !preview || preview.problem) return false;
		return this.then() !== 'toAccount' || !!preview.toAccount?.allowed;
	}

	async close(): Promise<void> {
		const order = this.order();
		const preview = this.preview();
		if (!order || !preview || !this.canClose()) return;
		this.busy.set(true);
		this.error.set(null);
		try {
			await firstValueFrom(
				this.gateway.closeOpen(order.id, { then: this.then(), currency: 'INR', revision: order.revision }),
			);
			this.modal.close({ then: this.then(), dueINR: preview.dueINR } satisfies CloseOutcome);
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('ord_action_failed')));
		} finally {
			this.busy.set(false);
		}
	}
}
