import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

import { OrdersGateway } from '@core/orders/orders.gateway';
import { RupeesPipe, apiProblem, rupees } from '@core/purchasing/purchasing-format';
import { parseRupees } from '@features/purchasing/shared/payment-popup';

import { indiaToday } from './order-status-popup';

import type { ManualPaymentMethod, Order } from '@saha-textile/contracts';

/**
 * Record payment (brief ck03–ck05, oo03–oo05, od08; concern K3): UPI, bank transfer or cash on
 * delivery, always in ₹ at the order's ₹ total. The amount opens at what is due now; less leaves the
 * rest due, more leaves the order paid ahead. A bank transfer not yet in the account waits as pending.
 */
@Component({
	selector: 'app-order-payment-popup',
	templateUrl: './order-payment-popup.html',
	imports: [FormsModule, RupeesPipe, TranslocoModule],
})
export class OrderPaymentPopup {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(OrdersGateway);
	private readonly transloco = inject(TranslocoService);

	readonly order = signal<Order | null>(null);
	readonly dueINR = signal(0);
	readonly method = signal<ManualPaymentMethod>('upi');
	readonly amount = signal('');
	readonly reference = signal('');
	readonly receivedOn = signal(indiaToday());
	readonly received = signal(true);
	readonly note = signal('');
	readonly busy = signal(false);
	readonly error = signal<string | null>(null);
	readonly today = indiaToday();
	readonly methods: readonly ManualPaymentMethod[] = ['upi', 'bankTransfer', 'cashOnDelivery'];

	readonly amountValue = computed(() => parseRupees(this.amount()));
	/** What recording this amount does to the balance (oo03–oo05). */
	readonly outcome = computed<{ key: string; amount: string } | null>(() => {
		const value = this.amountValue();
		if (value === null || value <= 0) return null;
		const due = this.dueINR();
		if (Math.abs(value - due) < 0.005) return { key: 'ord_pay_result_exact', amount: rupees(due) };
		if (value < due) return { key: 'ord_pay_result_less', amount: rupees(due - value) };
		return { key: 'ord_pay_result_more', amount: rupees(value - due) };
	});

	async start(order: Order): Promise<void> {
		this.order.set(order);
		try {
			const prefill = await firstValueFrom(this.gateway.paymentPrefill(order.id));
			this.dueINR.set(prefill.amountINR);
		} catch {
			this.dueINR.set(order.balance?.dueINR ?? order.totalINR);
		}
		this.amount.set(String(this.dueINR()));
	}

	canSave(): boolean {
		const value = this.amountValue();
		return !this.busy() && value !== null && value > 0 && !!this.reference().trim() && !!this.receivedOn();
	}

	async save(): Promise<void> {
		const order = this.order();
		const value = this.amountValue();
		if (!order || value === null || !this.canSave()) return;
		this.busy.set(true);
		this.error.set(null);
		try {
			const saved = await firstValueFrom(
				this.gateway.recordPayment(order.id, {
					method: this.method(),
					amountINR: value,
					reference: this.reference().trim(),
					receivedOn: this.receivedOn(),
					received: this.method() === 'bankTransfer' ? this.received() : true,
					note: this.note().trim() || null,
					proofMediaId: null,
					collector: this.method() === 'cashOnDelivery' ? 'staff' : null,
					revision: order.revision,
				}),
			);
			this.modal.close(saved);
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('ord_action_failed')));
		} finally {
			this.busy.set(false);
		}
	}
}
