import { randomUUID } from 'node:crypto';

import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
	type CancelAndRefundWrite,
	type Order,
	type OrderPayment,
	RefundVoucher,
	type RefundByHand,
	type RefundVoucherReason,
} from '@saha-textile/contracts';
import {
	type AdminOrderRepository,
	defaultStockLocation,
	gatewayRefundReference,
	istDay,
	ledgerClass,
	type LocationRepository,
	type OrderPaymentRepository,
	refundablePayments,
	refundStatusOf,
	type RefundVoucherRepository,
	refundVoucherPosting,
	type TaxInvoiceRepository,
	type TransactionContext,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import { accountsRefusal } from '../ledger/accounts-refusal';
import { type Actor, AdminOrdersService } from '../admin-orders/admin-orders.service';
import { type CheckoutGateways, gatewayNamed } from '../infra/payment-gateway-factory';
import {
	ADMIN_ORDER_REPOSITORY,
	CHECKOUT_GATEWAYS,
	LOCATION_REPOSITORY,
	ORDER_PAYMENT_REPOSITORY,
	REFUND_VOUCHER_REPOSITORY,
	TAX_INVOICE_REPOSITORY,
	TRANSACTION_MANAGER,
} from '../infra/tokens';
import { EditLogService } from '../ledger/edit-log';
import { LedgerService } from '../ledger/ledger.service';
import { DocumentNumbersService } from '../orders-setup/document-numbers.service';

type Refunding = { how: 'gateway' } | ({ how: 'bank_transfer' } & RefundByHand);

/**
 * Refund vouchers (accounts brief C, Rule 51): money given back before anything was invoiced. Cancel and refund
 * runs the order's own cancel step unchanged, then gives back each received payment in full, through its gateway
 * (our own reference, so a retry never refunds twice) or by a bank transfer typed in, each with an RF voucher.
 * A voucher is never edited or cancelled; a refused or unanswered gateway refund is tried again or paid by hand.
 */
@Injectable()
export class RefundVouchersService {
	constructor(
		private readonly adminOrders: AdminOrdersService,
		@Inject(ADMIN_ORDER_REPOSITORY) private readonly orders: Pick<AdminOrderRepository, 'findById'>,
		@Inject(ORDER_PAYMENT_REPOSITORY)
		private readonly payments: Pick<OrderPaymentRepository, 'listByOrder' | 'findById' | 'save'>,
		@Inject(TAX_INVOICE_REPOSITORY) private readonly invoices: Pick<TaxInvoiceRepository, 'listForOrder'>,
		@Inject(REFUND_VOUCHER_REPOSITORY) private readonly vouchers: RefundVoucherRepository,
		@Inject(LOCATION_REPOSITORY) private readonly locations: Pick<LocationRepository, 'list'>,
		@Inject(CHECKOUT_GATEWAYS) private readonly gateways: CheckoutGateways,
		@Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManagerPort,
		private readonly numbers: DocumentNumbersService,
		private readonly ledger: LedgerService,
		private readonly log: EditLogService,
	) {}

	private async order(id: string): Promise<Order> {
		const order = await this.orders.findById(id);
		if (!order) throw new NotFoundException('order_not_found');
		return order;
	}

	async get(id: string): Promise<RefundVoucher> {
		const voucher = await this.vouchers.get(id);
		if (!voucher) throw new NotFoundException('refund_voucher_not_found');
		return voucher;
	}

	listForOrder(orderId: string): Promise<RefundVoucher[]> {
		return this.vouchers.listForOrder(orderId);
	}

	/** A bank transfer is paid from a cash or bank ledger (its group, or one above it). */
	private async refuseUnlessCashOrBank(ledgerId: string): Promise<void> {
		const chart = await this.ledger.chart();
		const from = chart.ledgers.find((l) => l.id === ledgerId);
		if (!from || ledgerClass(from, chart.groups) === 'other')
			throw new BadRequestException(accountsRefusal('refund_needs_cash_or_bank'));
	}

	/** C1: cancel a paid order that has no tax invoice yet, and give its money back with a voucher for each payment. */
	async cancelAndRefund(orderId: string, write: CancelAndRefundWrite, actor: Actor, now = new Date()) {
		await this.order(orderId);
		const invoiced = (await this.invoices.listForOrder(orderId)).some((i) => i.status === 'issued');
		if (invoiced) throw new ConflictException(accountsRefusal('refund_after_invoice_needs_credit_note'));
		const paid = refundablePayments(await this.payments.listByOrder(orderId));
		if (!paid.length) throw new ConflictException(accountsRefusal('nothing_to_refund'));
		if (write.refund.how === 'bank_transfer') await this.refuseUnlessCashOrBank(write.refund.ledgerId);
		else if (paid.some((p) => p.method !== 'gateway' || !p.gateway?.reference))
			throw new BadRequestException(accountsRefusal('refund_payment_not_by_gateway'));
		await this.adminOrders.changeStatus(
			orderId,
			{
				to: 'cancelled',
				comment: write.comment,
				shipped: null,
				delivered: null,
				cancel: write.cancel,
				lineIds: [],
				revision: write.revision,
			},
			actor,
			now,
		);
		const order = await this.order(orderId);
		const made: RefundVoucher[] = [];
		for (const payment of paid)
			made.push(await this.refund(order, payment, write.refund, 'order_cancelled', actor, now));
		return made;
	}

	/** Asks the payment's gateway to give it back; null when it gave no answer (or there is no gateway to ask). */
	private async askGateway(payment: OrderPayment, reference: string) {
		const port = payment.gateway ? gatewayNamed(this.gateways, payment.gateway.id) : null;
		if (!port || !payment.gateway?.reference) return { outcome: null, refusal: null };
		try {
			const result = await port.refundPayment({
				gatewayReference: payment.gateway.reference,
				refundReference: reference,
				amountMinor: Math.round(payment.amount * 100),
				currency: payment.currency,
			});
			return { outcome: result.outcome, refusal: result.refusalReason };
		} catch {
			return { outcome: null, refusal: null };
		}
	}

	private async locationOf(order: Order): Promise<string> {
		const id = order.shipsFromLocationId ?? defaultStockLocation(await this.locations.list());
		if (!id) throw new ConflictException(accountsRefusal('refund_needs_a_location'));
		return id;
	}

	/** One payment back in full, with its voucher; the books move only once the money has gone. */
	private async refund(
		order: Order,
		payment: OrderPayment,
		how: Refunding,
		reason: RefundVoucherReason,
		actor: Actor,
		now: Date,
	): Promise<RefundVoucher> {
		const locationId = await this.locationOf(order);
		const reference = how.how === 'gateway' ? gatewayRefundReference('RF', payment.id) : how.reference;
		const answer =
			how.how === 'gateway'
				? await this.askGateway(payment, reference)
				: { outcome: 'accepted' as const, refusal: null };
		return this.tx.withTransaction((context) =>
			this.issue({ order, payment, how, reason, reference, answer, locationId }, actor, now, context),
		);
	}

	/**
	 * The shop's own refunds (OD1): money paid for pieces that sold out first, or paid after the order was cancelled.
	 * The shop has asked the gateway already; this gives that refund its RF voucher, numbered and posted once the money
	 * has gone. A payment that has its voucher keeps it; with no location to keep one at, none is made.
	 */
	async automatic(
		order: Order,
		payment: OrderPayment,
		refund: {
			reference: string;
			outcome: 'accepted' | 'duplicate' | 'refused' | 'unknown';
			reason: 'sold_out_before_payment' | 'paid_after_cancel';
		},
		now = new Date(),
	): Promise<RefundVoucher | null> {
		const made = (await this.vouchers.listForOrder(order.id)).find((voucher) => voucher.paymentId === payment.id);
		if (made) return made;
		const locationId = order.shipsFromLocationId ?? defaultStockLocation(await this.locations.list());
		if (!locationId) return null;
		const answer = { outcome: refund.outcome === 'unknown' ? null : refund.outcome, refusal: null };
		return this.tx.withTransaction((context) =>
			this.issue(
				{
					order,
					payment,
					how: { how: 'gateway' },
					reason: refund.reason,
					reference: refund.reference,
					answer,
					locationId,
				},
				{ id: null, name: 'System' },
				now,
				context,
			),
		);
	}

	/** The voucher itself: numbered, settled (posted) when refunded, saved and logged, in the caller's transaction. */
	private async issue(
		input: {
			order: Order;
			payment: OrderPayment;
			how: Refunding;
			reason: RefundVoucherReason;
			reference: string;
			answer: { outcome: 'accepted' | 'duplicate' | 'refused' | null; refusal: string | null };
			locationId: string;
		},
		actor: Actor,
		now: Date,
		context: TransactionContext,
	): Promise<RefundVoucher> {
		const { order, payment, how, reason, reference, answer, locationId } = input;
		const id = `rf_${randomUUID()}`;
		const at = now.toISOString();
		const voucher = RefundVoucher.parse({
			id,
			number: await this.numbers.issue('refundVoucher', context, now),
			date: istDay(now),
			orderId: order.id,
			orderNumber: order.orderNumber,
			paymentId: payment.id,
			receiptNumber: payment.receiptNumber,
			receiptDate: payment.receivedOn,
			payee: order.buyer?.name ?? order.orderNumber,
			amountINR: payment.amountINR,
			currency: payment.currency,
			amount: payment.amount,
			how: how.how,
			reference,
			reason,
			status: refundStatusOf(answer.outcome),
			refusal: answer.refusal,
			ledgerId: how.how === 'bank_transfer' ? how.ledgerId : null,
			locationId,
			createdAt: at,
			createdBy: actor.id,
			updatedAt: at,
		});
		const done = await this.settle(voucher, payment, actor.id, context);
		await this.vouchers.insert(done, context);
		await this.log.append(actor.id, 'refundVoucher.issue', 'refundVoucher', id, [], {
			number: done.number,
			order: order.orderNumber,
			reason,
		});
		await this.log.append(null, 'refundVoucher.outcome', 'refundVoucher', id, [], {
			status: done.status,
			how: done.how,
			number: done.number,
		});
		return done;
	}

	/** Once refunded: the payment reads Refunded and the voucher posts (Customer advance against where it went). */
	private async settle(
		voucher: RefundVoucher,
		payment: OrderPayment,
		actorId: string | null,
		context: TransactionContext,
	): Promise<RefundVoucher> {
		if (voucher.status !== 'refunded') return voucher;
		await this.payments.save({ ...payment, state: 'refunded' }, context);
		const posted = await this.ledger.post(
			{
				date: voucher.date,
				narration: `Refund voucher ${voucher.number} · receipt ${voucher.receiptNumber ?? '—'} · ${voucher.orderNumber}`,
				lines: refundVoucherPosting(
					voucher.amountINR,
					voucher.ledgerId ? { id: voucher.ledgerId } : { role: 'gateway_clearing' },
				).map((line) => ({ ...line, locationId: voucher.locationId })),
				source: { type: 'refundVoucher', id: voucher.id, number: voucher.number },
				idempotencyKey: `refundVoucher:${voucher.id}`,
			},
			context,
			actorId,
		);
		return { ...voucher, voucherId: posted.id };
	}

	private async open(id: string): Promise<{ voucher: RefundVoucher; payment: OrderPayment }> {
		const voucher = await this.get(id);
		if (voucher.status === 'refunded')
			throw new ConflictException(accountsRefusal('refund_voucher_already_refunded'));
		const payment = await this.payments.findById(voucher.paymentId);
		if (!payment) throw new NotFoundException('payment_not_found');
		return { voucher, payment };
	}

	private async update(
		before: RefundVoucher,
		next: RefundVoucher,
		payment: OrderPayment,
		action: string,
		actorId: string | null,
	): Promise<RefundVoucher> {
		return this.tx.withTransaction(async (context) => {
			const done = await this.settle(next, payment, actorId, context);
			await this.vouchers.save(done, before.updatedAt, context).catch((error: Error) => {
				throw new ConflictException(accountsRefusal(error.message));
			});
			await this.log.append(actorId, action, 'refundVoucher', before.id, [
				{ field: 'status', before: before.status, after: done.status },
			]);
			return done;
		});
	}

	/** "Failed: try again": the gateway is asked again with the same reference. */
	async retry(id: string, actorId: string | null, now = new Date()): Promise<RefundVoucher> {
		const { voucher, payment } = await this.open(id);
		if (voucher.how !== 'gateway') throw new ConflictException(accountsRefusal('refund_voucher_not_by_gateway'));
		const answer = await this.askGateway(payment, voucher.reference);
		const next = {
			...voucher,
			status: refundStatusOf(answer.outcome),
			refusal: answer.refusal,
			date: istDay(now),
			updatedAt: now.toISOString(),
		};
		return this.update(voucher, next, payment, 'refundVoucher.retry', actorId);
	}

	/** A refund the gateway wouldn't make, paid by bank transfer instead (from a cash or bank ledger, with its UTR). */
	async byHand(id: string, write: RefundByHand, actorId: string | null, now = new Date()): Promise<RefundVoucher> {
		const { voucher, payment } = await this.open(id);
		await this.refuseUnlessCashOrBank(write.ledgerId);
		const next: RefundVoucher = {
			...voucher,
			how: 'bank_transfer',
			reference: write.reference,
			ledgerId: write.ledgerId,
			status: 'refunded',
			refusal: null,
			date: istDay(now),
			updatedAt: now.toISOString(),
		};
		return this.update(voucher, next, payment, 'refundVoucher.by_hand', actorId);
	}

	/** Q11: every print is in the voucher's log. */
	async printed(id: string, actorId: string | null): Promise<void> {
		await this.log.append(actorId, 'refundVoucher.print', 'refundVoucher', id, [], { format: 'pdf' });
	}
}
