import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbNavModule } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { FxGateway, LAUNCH_SYMBOLS, PAYMENT_ROUTING_KEY, injectPaymentRoutingQuery } from '@core/fx/fx.gateway';
import { staleSave, staleSaveText } from '@core/shipping/shipping.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { FormFields } from '@shared/ui/form-fields/form-fields';

import type { PaymentGatewayId, PaymentRoutingWrite } from '@saha-textile/contracts';

/**
 * Settings › Payment method (shipping rules brief pay01; owner OD20): the currency decides the
 * gateway. Rupees go to the one active INR gateway; every other currency goes to PayPal. Shoppers
 * never see a gateway name. Keys stay in server settings; this page only says whether they are set.
 */
@Component({
	selector: 'app-payment-routing',
	templateUrl: './payment-routing.html',
	imports: [FormFields, FormsModule, NgbNavModule, TranslocoModule],
})
export class PaymentRouting {
	private readonly gateway = inject(FxGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);

	readonly query = injectPaymentRoutingQuery();
	readonly canEdit = computed(() => this.auth.permissions().includes('setting.edit'));
	readonly draft = signal<PaymentRoutingWrite | null>(null);
	readonly saving = signal(false);
	readonly tab = signal<PaymentGatewayId>('ccavenue');
	readonly gateways: PaymentGatewayId[] = ['paypal', 'ccavenue', 'razorpay'];
	/** Brand names, the same in every language. */
	readonly names: Record<PaymentGatewayId, string> = { paypal: 'PayPal', ccavenue: 'CCAvenue', razorpay: 'Razorpay' };
	/** "US$ · £ · € · C$ · A$ · S$ · NZ$": the launch currencies PayPal takes (FX6). */
	readonly foreignCurrencies = LAUNCH_SYMBOLS.join(' · ');

	constructor() {
		effect(() => {
			const data = this.query.data();
			if (!data) return;
			const { updatedAt: _at, updatedBy: _by, ...write } = data.settings;
			void _at;
			void _by;
			this.draft.set(structuredClone(write));
		});
	}

	patch(change: Partial<PaymentRoutingWrite>) {
		this.draft.update((draft) => (draft ? { ...draft, ...change } : draft));
	}

	/** "Takes new payments": the active INR gateway for rupees, PayPal's own switch for the rest. */
	takesNewPayments(id: PaymentGatewayId): boolean {
		const draft = this.draft();
		if (!draft) return false;
		return id === 'paypal' ? draft.paypalTakesNewPayments : draft.activeInrGateway === id;
	}

	setTakesNewPayments(id: PaymentGatewayId, on: boolean) {
		const draft = this.draft();
		if (!draft) return;
		if (id === 'paypal') this.patch({ paypalTakesNewPayments: on });
		else if (on) this.patch({ activeInrGateway: id });
		else if (draft.activeInrGateway === id) this.patch({ activeInrGateway: null });
	}

	setTestMode(id: PaymentGatewayId, on: boolean) {
		const draft = this.draft();
		if (draft) this.patch({ testMode: { ...draft.testMode, [id]: on } });
	}

	setPopup(name: 'paypalChooseCurrency' | 'inrCardRefused', on: boolean) {
		const draft = this.draft();
		if (draft) this.patch({ popups: { ...draft.popups, [name]: on } });
	}

	/** True when the page differs from what the server holds. */
	readonly changed = computed(() => {
		const data = this.query.data();
		const draft = this.draft();
		if (!data || !draft) return false;
		const { updatedAt: _at, updatedBy: _by, ...saved } = data.settings;
		void _at;
		void _by;
		return JSON.stringify(saved) !== JSON.stringify(draft);
	});

	/**
	 * Saved by the Settings page's own Save button (one Save for every settings tab, as the page
	 * already works), and only when something on this tab changed.
	 */
	async save() {
		const draft = this.draft();
		if (!draft || this.saving() || !this.changed()) return;
		this.saving.set(true);
		try {
			const saved = await firstValueFrom(this.gateway.saveRouting(draft));
			this.queryClient.setQueryData([...PAYMENT_ROUTING_KEY], saved);
			this.notifier.showSuccess(this.transloco.translate('pay_saved'));
		} catch (error) {
			const stale = staleSave(error);
			this.notifier.showError(
				stale
					? staleSaveText(stale, 'fx_err', (key, params) => this.transloco.translate(key, params))
					: this.transloco.translate('pay_save_failed'),
			);
		} finally {
			this.saving.set(false);
		}
	}
}
