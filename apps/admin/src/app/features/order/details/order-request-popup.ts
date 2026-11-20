import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

import { money } from '@core/orders/order-format';
import { OrdersGateway } from '@core/orders/orders.gateway';
import { RupeesPipe, apiProblem } from '@core/purchasing/purchasing-format';
import { parseRupees } from '@features/purchasing/shared/payment-popup';

import type { Order, PaymentRequest, PaymentRequestPreview } from '@saha-textile/contracts';

/** How long a request may stay open; the store's own setting is added when it isn't one of these. */
const VALID_DAYS = [1, 3, 7, 14, 30] as const;

/** ₹ per unit of the other currency, before the markup (`rateFromINR` is units per ₹). */
export function rupeesPerUnit(rateFromINR: number | null | undefined): number | null {
	return rateFromINR && rateFromINR > 0 ? Math.round((1 / rateFromINR) * 100) / 100 : null;
}

/**
 * Request online payment (brief oo07, pl01, pl05; concerns K1, K2, K10): the gateway sends its own
 * request for no more than is due; ₹ goes to the INR gateway and any other currency to PayPal, priced
 * at today's rate with the markup. "Request again" (pl05) shows the old request beside the new one.
 * Every check is the server's (the preview route); this popup only shows its answer.
 */
@Component({
	selector: 'app-order-request-popup',
	templateUrl: './order-request-popup.html',
	imports: [FormsModule, RupeesPipe, TranslocoModule],
})
export class OrderRequestPopup {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(OrdersGateway);
	private readonly transloco = inject(TranslocoService);

	readonly order = signal<Order | null>(null);
	readonly previous = signal<PaymentRequest | null>(null);
	readonly heldPieces = signal(0);
	readonly currency = signal('INR');
	readonly amount = signal('');
	readonly validDays = signal(7);
	readonly preview = signal<PaymentRequestPreview | null>(null);
	readonly loading = signal(false);
	readonly busy = signal(false);
	readonly error = signal<string | null>(null);
	private timer: ReturnType<typeof setTimeout> | null = null;
	private asked = 0;

	readonly amountValue = computed(() => parseRupees(this.amount()));
	readonly dayChoices = computed(() => {
		const days = new Set<number>(VALID_DAYS);
		days.add(this.validDays());
		return [...days].sort((a, b) => a - b);
	});
	/** K2: a foreign-currency request for a customer billed in India fails on PayPal India. */
	readonly billedInIndia = computed(() => {
		const billing = this.order()?.addresses?.billing;
		return (billing?.countryCode ?? billing?.country ?? '').toUpperCase() === 'IN';
	});
	readonly warnIndia = computed(() => this.billedInIndia() && this.currency() !== 'INR');
	readonly buyerName = computed(() => {
		const order = this.order();
		return order?.addresses?.billing?.fullName ?? order?.buyer?.name ?? '';
	});
	readonly newRate = computed(() => rupeesPerUnit(this.preview()?.rateFromINR));
	readonly oldRate = computed(() => rupeesPerUnit(this.previous()?.rateFromINR));
	readonly symbol = computed(
		() => this.preview()?.currencies.find((row) => row.code === this.currency())?.symbol ?? this.currency(),
	);

	async start(order: Order, previous: PaymentRequest | null, heldPieces: number): Promise<void> {
		this.order.set(order);
		this.previous.set(previous);
		this.heldPieces.set(heldPieces);
		this.currency.set(previous?.currency ?? order.currency ?? 'INR');
		await this.ask(true);
	}

	changeCurrency(code: string): void {
		this.currency.set(code);
		void this.ask(false);
	}

	changeAmount(text: string): void {
		this.amount.set(text);
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.ask(false), 350);
	}

	money(amount: number, currency: string): string {
		return money(amount, currency, this.transloco.getActiveLang() === 'bn' ? 'bn-IN' : 'en-IN');
	}

	canSend(): boolean {
		const value = this.amountValue();
		const preview = this.preview();
		return !this.busy() && !this.loading() && !!preview && !preview.problem && value !== null && value > 0;
	}

	async send(): Promise<void> {
		const order = this.order();
		const value = this.amountValue();
		if (!order || value === null || !this.canSend()) return;
		this.busy.set(true);
		this.error.set(null);
		try {
			const created = await firstValueFrom(
				this.gateway.requestPayment(order.id, {
					amountINR: value,
					currency: this.currency(),
					validDays: this.validDays(),
					revision: order.revision,
				}),
			);
			this.modal.close(created);
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('ord_action_failed')));
		} finally {
			this.busy.set(false);
		}
	}

	/** Asks the server what the request would be; the first answer fills the amount and the days. */
	private async ask(first: boolean): Promise<void> {
		const order = this.order();
		if (!order) return;
		const value = this.amountValue();
		const asked = ++this.asked;
		this.loading.set(true);
		try {
			const preview = await firstValueFrom(
				this.gateway.previewRequest(order.id, {
					currency: this.currency(),
					...(!first && value !== null && value > 0 ? { amountINR: value } : {}),
				}),
			);
			if (asked !== this.asked) return;
			this.preview.set(preview);
			if (first) {
				this.amount.set(String(preview.dueINR));
				this.validDays.set(preview.validDays);
				if (!preview.currencies.some((row) => row.code === this.currency())) this.changeCurrency('INR');
			}
			this.error.set(null);
		} catch (error) {
			if (asked === this.asked) this.error.set(apiProblem(error, this.transloco.translate('ord_action_failed')));
		} finally {
			if (asked === this.asked) this.loading.set(false);
		}
	}
}
