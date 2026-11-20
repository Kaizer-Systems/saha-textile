import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { injectQueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { ORDER_STATUS_PILL, money } from '@core/orders/order-format';
import { ORDERS_KEY, OrdersGateway, injectAdminOrderQuery } from '@core/orders/orders.gateway';
import { RupeesPipe, apiProblem, rupees, shortDate, shortDateTime } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { askReason } from '@features/purchasing/shared/popups';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

import { OrderEDocPopup } from './order-edoc-popup';
import { OrderPaymentPopup } from './order-payment-popup';
import { OrderStatusPopup } from './order-status-popup';

import type {
	AdminOrderDetail,
	Order,
	OrderAddress,
	OrderHistoryEntry,
	OrderPayment,
	PaymentRequest,
} from '@saha-textile/contracts';

/** The steps across the top of the order (od05): the theme's tracking icons, in the status machine's order. */
const STEPS: ReadonlyArray<{ status: Order['status']; icon: string }> = [
	{ status: 'awaiting_payment', icon: 'pending' },
	{ status: 'placed', icon: 'refund' },
	{ status: 'processing', icon: 'processing' },
	{ status: 'packed', icon: 'shipped' },
	{ status: 'shipped', icon: 'out-for-delivery' },
	{ status: 'delivered', icon: 'delivered' },
];
const STEP_AT: Partial<Record<Order['status'], number>> = {
	awaiting_payment: 0,
	placed: 1,
	processing: 2,
	packed: 3,
	shipped: 4,
	out_for_delivery: 4,
	delivered: 5,
};

/**
 * Admin › Orders › Order (brief od05–od08, pl01–pl05, st01–st05; owner 2026-11-16 to 2026-11-20):
 * the steps, the items, the shipping charge with its reason, payments and payment requests, the
 * e-invoice / e-way bill block, shipments, history, and the summary, buyer and rates on the right.
 * Every action goes through the API's status machine and permission checks; the page shows answers.
 */
@Component({
	selector: 'app-details',
	templateUrl: './details.html',
	styleUrls: ['./details.scss'],
	imports: [HasPermissionDirective, RouterModule, RupeesPipe, TranslocoModule],
})
export class Details {
	private readonly route = inject(ActivatedRoute);
	private readonly gateway = inject(OrdersGateway);
	private readonly modals = inject(NgbModal);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly queryClient = injectQueryClient();

	readonly id = toSignal(this.route.paramMap.pipe(map((params) => params.get('id'))), { initialValue: null });
	readonly query = injectAdminOrderQuery(() => this.id());
	readonly detail = computed<AdminOrderDetail | null>(() => this.query.data() ?? null);
	readonly order = computed<Order | null>(() => this.detail()?.order ?? null);
	readonly busy = signal<string | null>(null);

	readonly steps = STEPS;
	readonly stepAt = computed(() => {
		const order = this.order();
		return order ? (STEP_AT[order.status] ?? -1) : -1;
	});
	readonly statusPill = computed(() => {
		const order = this.order();
		return order ? ORDER_STATUS_PILL[order.status] : 'pending';
	});
	readonly foreign = computed(() => (this.order()?.currency ?? 'INR') !== 'INR');
	readonly requests = computed(() => [...(this.detail()?.requests ?? [])].reverse());
	readonly history = computed(() => [...(this.order()?.history ?? [])].reverse());
	readonly paypalRecord = computed(() => this.detail()?.payments.find((payment) => payment.paypal)?.paypal ?? null);
	readonly needsInvoiceAddress = computed(() => !!this.detail()?.attention.includes('invoiceAddressNeeded'));

	/* ------------------------------------------------------------------ formatting */

	money(amount: number | null | undefined): string {
		const order = this.order();
		if (amount === null || amount === undefined || !order) return '—';
		return money(amount, order.currency, this.locale());
	}

	moneyIn(amount: number, currency: string): string {
		return money(amount, currency, this.locale());
	}

	rupees(amount: number | null | undefined): string {
		return rupees(amount);
	}

	day(value: string | null | undefined): string {
		return shortDate(value);
	}

	when(value: string | null | undefined): string {
		return shortDateTime(value);
	}

	address(address: OrderAddress | null | undefined): string {
		if (!address) return '—';
		const parts = [
			address.line1,
			address.line2,
			address.landmark,
			address.city,
			address.state,
			address.postalCode,
			this.country(address.countryCode ?? address.country),
		];
		return parts.filter((part) => !!part && String(part).trim()).join(', ');
	}

	phone(address: OrderAddress | null | undefined): string {
		const mobile = address?.mobile;
		return mobile ? `+${mobile.countryCallingCode} ${mobile.number}` : '';
	}

	country(code: string | null | undefined): string {
		if (!code) return '';
		try {
			return new Intl.DisplayNames([this.locale()], { type: 'region' }).of(code.toUpperCase()) ?? code;
		} catch {
			return code;
		}
	}

	paymentPill(payment: OrderPayment): string {
		if (payment.state === 'received') return 'success';
		if (payment.state === 'pending') return 'pending';
		if (payment.state === 'refunded' || payment.state === 'partRefunded') return 'refund';
		return 'failed';
	}

	requestPill(request: PaymentRequest): string {
		if (request.status === 'paid') return 'success';
		if (request.status === 'active') return 'pending';
		if (request.status === 'expired' || request.status === 'failed') return 'failed';
		return 'cancelled';
	}

	historyWords(entry: OrderHistoryEntry): string {
		const what = this.transloco.translate(`ord_history_${entry.kind}`);
		const move =
			entry.kind === 'status' && entry.to ? ` · ${this.transloco.translate(`ord_status_${entry.to}`)}` : '';
		return `${what}${move}`;
	}

	private locale(): string {
		return this.transloco.getActiveLang() === 'bn' ? 'bn-IN' : 'en-IN';
	}

	/* ------------------------------------------------------------------ actions */

	async updateStatus(): Promise<void> {
		const detail = this.detail();
		if (!detail) return;
		const popup = this.modals.open(OrderStatusPopup, {
			centered: true,
			size: 'lg',
			windowClass: 'theme-modal',
			ariaLabelledBy: 'order_status_popup_title',
		});
		(popup.componentInstance as OrderStatusPopup).start(detail);
		if (await popup.result.catch(() => null)) await this.refresh('ord_status_saved');
	}

	async addComment(): Promise<void> {
		const order = this.order();
		if (!order) return;
		const done = await askReason(this.modals, {
			title: 'ord_add_comment',
			label: 'ord_comment',
			help: 'ord_comment_help',
			confirm: 'ord_add_comment',
			act: (comment) => firstValueFrom(this.gateway.comment(order.id, { comment, revision: order.revision })),
		});
		if (done) await this.refresh('ord_comment_saved');
	}

	async recordPayment(): Promise<void> {
		const order = this.order();
		if (!order) return;
		const popup = this.modals.open(OrderPaymentPopup, {
			centered: true,
			windowClass: 'theme-modal',
			ariaLabelledBy: 'order_payment_popup_title',
		});
		await (popup.componentInstance as OrderPaymentPopup).start(order);
		if (await popup.result.catch(() => null)) await this.refresh('ord_payment_saved');
	}

	async markReceived(payment: OrderPayment): Promise<void> {
		const order = this.order();
		if (!order) return;
		const done = await askReason(this.modals, {
			title: 'ord_mark_received',
			body: 'ord_mark_received_body',
			params: { amount: rupees(payment.amountINR) },
			label: 'ord_utr',
			confirm: 'ord_mark_received',
			act: (reference) =>
				firstValueFrom(
					this.gateway.markReceived(order.id, payment.id, {
						reference,
						receivedOn: new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10),
						revision: order.revision,
					}),
				),
		});
		if (done) await this.refresh('ord_payment_saved');
	}

	async checkRequest(request: PaymentRequest): Promise<void> {
		const order = this.order();
		if (!order) return;
		await this.run(`check:${request.id}`, async () => {
			const result = await firstValueFrom(this.gateway.checkRequest(order.id, request.id));
			await this.refresh(result.recorded ? 'ord_request_paid_toast' : 'ord_request_not_paid');
		});
	}

	async cancelRequest(request: PaymentRequest): Promise<void> {
		const order = this.order();
		if (!order) return;
		await this.run(`cancel:${request.id}`, async () => {
			await firstValueFrom(this.gateway.cancelRequest(order.id, request.id));
			await this.refresh('ord_request_cancelled_toast');
		});
	}

	async copy(text: string | null): Promise<void> {
		if (!text) return;
		try {
			await navigator.clipboard.writeText(text);
			this.notifier.showSuccess(this.transloco.translate('ord_link_copied'));
		} catch {
			this.notifier.showError(this.transloco.translate('ord_copy_failed'));
		}
	}

	async eDocument(kind: 'eInvoice' | 'eWayBill'): Promise<void> {
		const order = this.order();
		if (!order) return;
		await this.run(`raise:${kind}`, async () => {
			const raised = await firstValueFrom(
				kind === 'eInvoice' ? this.gateway.raiseEInvoice(order.id) : this.gateway.raiseEWayBill(order.id),
			);
			if (raised.outcome === 'raised') {
				await this.refresh('ord_edoc_saved');
				return;
			}
			// No integration yet: the details are typed in by hand (owner, 2026-11-20).
			const popup = this.modals.open(OrderEDocPopup, {
				centered: true,
				size: 'lg',
				windowClass: 'theme-modal',
				ariaLabelledBy: 'order_edoc_popup_title',
			});
			(popup.componentInstance as OrderEDocPopup).start(order, kind);
			if (await popup.result.catch(() => null)) await this.refresh('ord_edoc_saved');
		});
	}

	private async run(key: string, work: () => Promise<void>): Promise<void> {
		this.busy.set(key);
		try {
			await work();
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('ord_action_failed')));
		} finally {
			this.busy.set(null);
		}
	}

	private async refresh(message: string): Promise<void> {
		await this.queryClient.invalidateQueries({ queryKey: [...ORDERS_KEY] });
		this.notifier.showSuccess(this.transloco.translate(message));
	}
}
