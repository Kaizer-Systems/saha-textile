import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

import { invoiceProblemKey } from '@core/accounts/invoices.gateway';
import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { RefundVouchersGateway, refundProblemKey } from '@core/accounts/refund-vouchers.gateway';
import { OrdersGateway } from '@core/orders/orders.gateway';
import { apiProblem, rupees } from '@core/purchasing/purchasing-format';

import { cashAndBankLedgers } from '../../accounts/cash-bank-ledgers';

import type { AdminOrderDetail, AllowedNextStatus, Ledger, StatusChangeWrite } from '@saha-textile/contracts';

/** Today in India, as the date fields take it. */
export const indiaToday = (): string => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/**
 * Update status (brief st01–st05, concern K4): only the next steps this order can take are offered;
 * blocked ones stay in the list with their reason. Shipped asks for the courier and tracking number
 * (a connected courier is shown but off until one exists), Delivered for the date and an optional
 * proof, Cancelled for a reason. The last line says what the customer will be told.
 */
@Component({
	selector: 'app-order-status-popup',
	templateUrl: './order-status-popup.html',
	imports: [FormsModule, TranslocoModule],
})
export class OrderStatusPopup {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(OrdersGateway);
	private readonly transloco = inject(TranslocoService);
	private readonly refunds = inject(RefundVouchersGateway);
	private readonly ledgerGateway = inject(LedgerGateway);

	readonly detail = signal<AdminOrderDetail | null>(null);
	readonly options = computed<readonly AllowedNextStatus[]>(() => this.detail()?.allowedNext ?? []);
	readonly to = signal<AllowedNextStatus['to'] | null>(null);
	readonly chosen = computed(() => this.options().find((option) => option.to === this.to()) ?? null);
	readonly comment = signal('');
	readonly courierName = signal('');
	readonly trackingNumber = signal('');
	readonly trackingUrl = signal('');
	readonly shippedOn = signal(indiaToday());
	readonly deliveredOn = signal(indiaToday());
	readonly receivedBy = signal('');
	readonly podReference = signal('');
	readonly cancelReason = signal<NonNullable<StatusChangeWrite['cancel']>['reason']>('customerAsked');
	readonly cancelNote = signal('');
	/** C1: a paid order not yet invoiced gives its money back with a refund voucher, by gateway or bank transfer. */
	readonly refundHow = signal<'gateway' | 'bank_transfer'>('gateway');
	readonly refundLedger = signal('');
	readonly refundReference = signal('');
	readonly payFrom = signal<Ledger[]>([]);
	readonly busy = signal(false);
	readonly error = signal<string | null>(null);
	readonly today = indiaToday();

	private readonly t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);

	/** The last line: what the customer is told for the chosen step (st01–st04). */
	readonly toldLine = computed(() => {
		const chosen = this.chosen();
		if (!chosen) {
			// st02: Packed waits for the invoice address.
			return this.options().some((option) => option.reason === 'addInvoiceAddressFirst')
				? this.t('ord_told_add_invoice_first')
				: null;
		}
		if (chosen.to === 'cancelled') return null;
		if (chosen.to === 'shipped') return this.t('ord_told_shipped');
		if (chosen.to === 'delivered') return this.t('ord_told_delivered');
		return this.t('ord_told_nothing_for', { status: this.t(`ord_status_${chosen.to}`) });
	});

	/** st01: on an order still before Packed, the Cancelled choice says until when it stays open. */
	readonly cancelHint = computed(() => {
		const status = this.detail()?.order.status;
		return status === 'placed' || status === 'processing' ? this.t('ord_hint_cancel_until_packed') : null;
	});

	/** st05: what cancelling does — the refund, the stock and what the customer is told. */
	readonly cancelView = computed(() => {
		const detail = this.detail();
		if (!detail || this.chosen()?.to !== 'cancelled') return null;
		const received = detail.payments.filter((payment) => payment.state === 'received');
		const paidINR = Math.round(received.reduce((sum, payment) => sum + payment.amountINR, 0) * 100) / 100;
		const viaGateway = received.some((payment) => payment.method === 'gateway');
		const pieces = detail.order.lines.reduce((sum, line) => sum + line.quantity, 0);
		const amount = rupees(paidINR);
		return {
			refund:
				paidINR > 0
					? this.t(viaGateway ? 'ord_cancel_refund_gateway' : 'ord_cancel_refund_manual', { amount })
					: null,
			stock: this.t(
				pieces === 1
					? 'ord_cancel_stock_one'
					: pieces === 2
						? 'ord_cancel_stock_two'
						: 'ord_cancel_stock_other',
				{ count: pieces },
			),
			told: this.t(paidINR > 0 ? 'ord_cancel_told_refund' : 'ord_cancel_told_plain'),
			button: paidINR > 0 ? this.t('ord_cancel_and_refund', { amount }) : this.t('ord_cancel_the_order'),
		};
	});
	/** C1: the received payments with their receipts, what they add up to, and whether all came by the gateway. */
	readonly refunding = computed(() => {
		const paid = (this.detail()?.payments ?? []).filter(
			(p) => p.state === 'received' && p.amountINR > 0 && !!p.receiptNumber,
		);
		const paidINR = Math.round(paid.reduce((sum, p) => sum + p.amountINR, 0) * 100) / 100;
		return {
			paidINR,
			amount: rupees(paidINR),
			receipts: paid.map((p) => p.receiptNumber).join(', '),
			viaGateway: paid.length > 0 && paid.every((p) => p.method === 'gateway' && !!p.gateway?.reference),
		};
	});
	/** C1 applies when the order is being cancelled with money to give back. */
	readonly refundsOnCancel = computed(() => this.chosen()?.to === 'cancelled' && this.refunding().paidINR > 0);

	async chooseRefund(how: 'gateway' | 'bank_transfer'): Promise<void> {
		this.refundHow.set(how);
		if (how === 'bank_transfer' && !this.payFrom().length)
			this.payFrom.set(cashAndBankLedgers(await firstValueFrom(this.ledgerGateway.chart())));
	}

	readonly cancelReasons: ReadonlyArray<NonNullable<StatusChangeWrite['cancel']>['reason']> = [
		'customerAsked',
		'outOfStock',
		'paymentNotReceived',
		'fraudSuspected',
		'other',
	];

	start(detail: AdminOrderDetail): void {
		this.detail.set(detail);
		this.to.set(detail.allowedNext.find((option) => option.allowed)?.to ?? null);
		if (!this.refunding().viaGateway) void this.chooseRefund('bank_transfer');
	}

	needs(field: string): boolean {
		return this.chosen()?.needs.includes(field as never) ?? false;
	}

	canSave(): boolean {
		const chosen = this.chosen();
		if (!chosen?.allowed || this.busy()) return false;
		if (chosen.to === 'shipped')
			return !!this.courierName().trim() && !!this.trackingNumber().trim() && !!this.shippedOn();
		if (chosen.to === 'delivered') return !!this.deliveredOn();
		if (this.refundsOnCancel() && this.refundHow() === 'bank_transfer')
			return !!this.refundLedger() && this.refundReference().trim().length >= 4;
		return true;
	}

	async save(): Promise<void> {
		const detail = this.detail();
		const chosen = this.chosen();
		if (!detail || !chosen || !this.canSave()) return;
		const url = this.trackingUrl().trim();
		const body: StatusChangeWrite = {
			to: chosen.to,
			comment: this.comment().trim() || null,
			shipped:
				chosen.to === 'shipped'
					? {
							mode: 'manual',
							courierName: this.courierName().trim(),
							trackingNumber: this.trackingNumber().trim(),
							trackingUrl: url || null,
							shippedOn: this.shippedOn(),
						}
					: null,
			delivered:
				chosen.to === 'delivered'
					? {
							deliveredOn: this.deliveredOn(),
							receivedBy: this.receivedBy().trim() || null,
							podReference: this.podReference().trim() || null,
						}
					: null,
			cancel:
				chosen.to === 'cancelled'
					? { reason: this.cancelReason(), note: this.cancelNote().trim() || null }
					: null,
			lineIds: [],
			revision: detail.order.revision,
		};
		this.busy.set(true);
		this.error.set(null);
		try {
			if (this.refundsOnCancel() && body.cancel) {
				// C1: the same cancel step on the server, then each payment back with its refund voucher.
				const refund =
					this.refundHow() === 'gateway'
						? ({ how: 'gateway' } as const)
						: ({
								how: 'bank_transfer',
								ledgerId: this.refundLedger(),
								reference: this.refundReference().trim(),
							} as const);
				const vouchers = await firstValueFrom(
					this.refunds.cancelAndRefund(detail.order.id, {
						comment: body.comment,
						cancel: body.cancel,
						revision: body.revision,
						refund,
					}),
				);
				this.modal.close(vouchers);
				return;
			}
			const order = await firstValueFrom(this.gateway.changeStatus(detail.order.id, body));
			this.modal.close(order);
		} catch (error) {
			const message = apiProblem(error, this.transloco.translate('ord_action_failed'));
			const problem = invoiceProblemKey(message);
			const refusal = refundProblemKey(message);
			this.error.set(
				problem
					? this.transloco.translate(problem.key, problem.params)
					: refusal
						? this.transloco.translate(refusal)
						: message,
			);
		} finally {
			this.busy.set(false);
		}
	}
}
