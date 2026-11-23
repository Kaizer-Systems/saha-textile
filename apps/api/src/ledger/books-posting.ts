import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type {
	BusinessReceiptWrite,
	MoneyLanding,
	Order,
	OrderPayment,
	PurchaseEntry,
	PurchaseReturn,
	SupplierPayment,
} from '@saha-textile/contracts';
import {
	bankLanding,
	billTotals,
	defaultStockLocation,
	istDay,
	purchaseEntryPosting,
	purchaseReturnPosting,
	receiptLanding,
	receiptPosting,
	resolveRole,
	supplierPaymentFrom,
	supplierPaymentPosting,
	supplierRefundPosting,
	upiLanding,
	type LedgerRef,
	type LocationRepository,
	type MoneyLandingRepository,
	type MoneyRow,
	type OrderPaymentRepository,
	type RefundVoucherRepository,
	type TaxInvoiceRepository,
	type TransactionContext,
} from '@saha-textile/core-domain';

import {
	LOCATION_REPOSITORY,
	MONEY_LANDING_REPOSITORY,
	ORDER_PAYMENT_REPOSITORY,
	REFUND_VOUCHER_REPOSITORY,
	TAX_INVOICE_REPOSITORY,
} from '../infra/tokens';
import { accountsRefusal } from './accounts-refusal';
import { LedgerService } from './ledger.service';

interface Posting {
	date: string;
	narration: string;
	source: { type: string; id: string; number?: string | null };
	key: string;
}

type ReceiptOrder = Pick<Order, 'id' | 'orderNumber' | 'shipsFromLocationId'>;

/**
 * Receipts and purchases in the books, inline (Postings and Convert brief P1–P3, approved 24 Nov). Each step that saves
 * a payment, a purchase entry or a purchase return calls one of these inside its own transaction, so the document and
 * its voucher are saved together or not at all. A posting that can't be made refuses the step with the reason as a
 * code the admin puts in words; only a payment the customer already made through the gateway is kept unposted and
 * left for "Post them" (AP-D2). Every voucher has its own key, so a repeated step never posts twice.
 */
@Injectable()
export class BooksPostingService {
	private readonly logger = new Logger(BooksPostingService.name);

	constructor(
		private readonly ledger: LedgerService,
		@Inject(MONEY_LANDING_REPOSITORY) private readonly landing: Pick<MoneyLandingRepository, 'get'>,
		@Inject(LOCATION_REPOSITORY) private readonly locations: Pick<LocationRepository, 'list'>,
		@Inject(TAX_INVOICE_REPOSITORY) private readonly invoices: Pick<TaxInvoiceRepository, 'listForOrder'>,
		@Inject(ORDER_PAYMENT_REPOSITORY) private readonly payments: Pick<OrderPaymentRepository, 'listByOrder'>,
		@Inject(REFUND_VOUCHER_REPOSITORY) private readonly refunds: Pick<RefundVoucherRepository, 'listForOrder'>,
	) {}

	/** A rule reading "Where money lands"; a missing bank account refuses the step in words. */
	private async lands<T>(pick: (landing: MoneyLanding) => T): Promise<T> {
		const landing = await this.landing.get();
		try {
			return pick(landing);
		} catch (error) {
			throw new BadRequestException(accountsRefusal((error as Error).message));
		}
	}

	/** Purchases and supplier money sit with the stock location (the online warehouse). */
	private async stockLocation(): Promise<string> {
		const id = defaultStockLocation(await this.locations.list());
		if (!id) throw new BadRequestException(accountsRefusal('books_need_a_location'));
		return id;
	}

	private post(
		rows: readonly MoneyRow[],
		at: Posting,
		locationId: string,
		context: TransactionContext,
		by: string | null,
	) {
		return this.ledger.post(
			{
				date: at.date,
				narration: at.narration,
				source: at.source,
				idempotencyKey: at.key,
				lines: rows.map((row) => ({ ...row, locationId })),
			},
			context,
			by,
		);
	}

	/** The opposite of what a document posted, once; nothing when it never posted (saved before the books took it). */
	private async reverse(originalKey: string, at: Posting, context: TransactionContext, by: string | null) {
		const original = await this.ledger.voucherByKey(originalKey, context);
		if (!original) return null;
		return this.ledger.post(
			{
				date: at.date,
				narration: at.narration,
				source: at.source,
				idempotencyKey: at.key,
				lines: original.lines.map((line) => ({
					ledger: { id: line.ledgerId },
					locationId: line.locationId,
					debitPaise: line.creditPaise,
					creditPaise: line.debitPaise,
				})),
			},
			context,
			by,
		);
	}

	/* ---------------------------------------------------------------- purchases */

	/** Purchases › Post: stock and input tax against the supplier (input tax that can't be claimed goes into stock). */
	async purchaseEntryPosted(entry: PurchaseEntry, context: TransactionContext, by: string | null) {
		return this.post(
			purchaseEntryPosting(billTotals(entry.totals, entry.itcClaimable)),
			{
				date: istDay(entry.postedAt ?? new Date()),
				narration: `Purchase entry ${entry.number} · ${entry.supplierName}, bill ${entry.billNumber}`,
				source: { type: 'purchaseEntry', id: entry.id, number: entry.number },
				key: `purchaseEntry:${entry.id}`,
			},
			await this.stockLocation(),
			context,
			by,
		);
	}

	/** A posted entry voided: its posting reversed, dated the day it is voided. */
	async purchaseEntryVoided(entry: PurchaseEntry, context: TransactionContext, by: string | null) {
		return this.reverse(
			`purchaseEntry:${entry.id}`,
			{
				date: istDay(entry.voidedAt ?? new Date()),
				narration: `Void of purchase entry ${entry.number}`,
				source: { type: 'purchaseEntry', id: entry.id, number: entry.number },
				key: `purchaseEntry:${entry.id}:void`,
			},
			context,
			by,
		);
	}

	/** A supplier paid: their account against cash or the bank set in "Where money lands". */
	async supplierPaid(
		payment: SupplierPayment,
		entry: Pick<PurchaseEntry, 'number' | 'supplierName'>,
		context: TransactionContext,
		by: string | null,
	) {
		const from = await this.lands((landing) => supplierPaymentFrom(payment.mode, landing));
		return this.post(
			supplierPaymentPosting(payment.amountINR, from),
			{
				date: payment.paidOn,
				narration: `Payment to ${entry.supplierName} for ${entry.number}`,
				source: { type: 'supplierPayment', id: payment.id, number: entry.number },
				key: `supplierPayment:${payment.id}`,
			},
			await this.stockLocation(),
			context,
			by,
		);
	}

	/** A supplier payment reversed (or its voucher cancelled): its posting reversed on that day. */
	async supplierPaymentReversed(payment: SupplierPayment, context: TransactionContext, by: string | null) {
		return this.reverse(
			`supplierPayment:${payment.id}`,
			{
				date: istDay(payment.reversedAt ?? new Date()),
				narration: `Reversal of a payment of ${payment.paidOn}`,
				source: { type: 'supplierPayment', id: payment.id },
				key: `supplierPayment:${payment.id}:reversed`,
			},
			context,
			by,
		);
	}

	/** A purchase return (debit note) sent: the supplier owes its total back, against stock and input tax. */
	async purchaseReturnSent(
		doc: PurchaseReturn,
		itcClaimable: boolean,
		context: TransactionContext,
		by: string | null,
	) {
		return this.post(
			purchaseReturnPosting(
				billTotals(
					{
						taxableINR: doc.taxableINR,
						cgstINR: doc.cgstINR,
						sgstINR: doc.sgstINR,
						igstINR: doc.igstINR,
						totalINR: doc.totalINR,
					},
					itcClaimable,
				),
			),
			{
				date: istDay(doc.sentAt ?? new Date()),
				narration: `Debit note ${doc.number} · ${doc.supplierName}`,
				source: { type: 'purchaseReturn', id: doc.id, number: doc.number },
				key: `purchaseReturn:${doc.id}`,
			},
			await this.stockLocation(),
			context,
			by,
		);
	}

	/**
	 * A settlement of a debit note. Only a refund moves money (into the bank set); a credit note or a later bill only
	 * clears what the debit note already took off the supplier, and a write-off waits for the bank chunk (B1).
	 */
	async purchaseReturnSettled(
		doc: Pick<PurchaseReturn, 'id' | 'number' | 'supplierName'>,
		settlement: PurchaseReturn['settlements'][number],
		context: TransactionContext,
		by: string | null,
	) {
		if (settlement.how !== 'refund') return null;
		const landed = await this.lands(bankLanding);
		return this.post(
			supplierRefundPosting(settlement.amountINR, landed),
			{
				date: settlement.date,
				narration: `Refund from ${doc.supplierName} on debit note ${doc.number}`,
				source: { type: 'purchaseReturn', id: doc.id, number: doc.number },
				key: `purchaseReturn:${doc.id}:refund:${settlement.id}`,
			},
			await this.stockLocation(),
			context,
			by,
		);
	}

	/* ---------------------------------------------------------------- receipts */

	/** An order that has a tax invoice is in the customer's debt; before that, money is their advance. */
	private async invoiced(orderId: string): Promise<boolean> {
		return (await this.invoices.listForOrder(orderId)).some((invoice) => invoice.status === 'issued');
	}

	/**
	 * A payment received on an order: where it landed against the customer's advance, or their debt once invoiced. On
	 * account and set off post nothing. A payment the customer made through the gateway is kept even when the books
	 * can't take it; it stays unposted for "Post them" (AP-D2).
	 */
	async paymentReceived(
		payment: OrderPayment,
		order: ReceiptOrder,
		context: TransactionContext,
		by: string | null,
		/** "Post them" wants every failure back, to list it. */
		options: { keepCustomerPayment: boolean } = { keepCustomerPayment: true },
	) {
		if (payment.state !== 'received') return null;
		const work = async () => {
			const landed = await this.lands((landing) => receiptLanding(payment.method, landing));
			if (!landed) return null;
			const locationId = order.shipsFromLocationId ?? (await this.stockLocation());
			return this.post(
				receiptPosting(
					payment.amountINR,
					landed,
					(await this.invoiced(order.id)) ? await this.advanceOwedINR(order.id) : payment.amountINR,
				),
				{
					date: payment.receivedOn ?? istDay(payment.recordedAt),
					narration: `Payment received on order ${order.orderNumber}`,
					source: {
						type: 'orderPayment',
						id: payment.id,
						number: payment.receiptNumber ?? order.orderNumber,
					},
					key: `receipt:${payment.id}`,
				},
				locationId,
				context,
				by,
			);
		};
		const customerPaid = payment.method === 'gateway' && payment.recordedBy === null;
		if (!customerPaid || !options.keepCustomerPayment) return work();
		return work().catch((error: unknown) => {
			this.logger.warn(`Payment ${payment.id} kept unposted for staff: ${(error as Error).message}`);
			return null;
		});
	}

	/** A received payment voided or failed afterwards: its posting reversed on that day. */
	async paymentUndone(payment: OrderPayment, day: string, context: TransactionContext, by: string | null) {
		return this.reverse(
			`receipt:${payment.id}`,
			{
				date: day,
				narration: `Reversal of a payment received on ${payment.receivedOn ?? istDay(payment.recordedAt)}`,
				source: { type: 'orderPayment', id: payment.id, number: payment.receiptNumber },
				key: `receipt:${payment.id}:void`,
			},
			context,
			by,
		);
	}

	/** A business's receipt on its customer account: where it landed against what the business owes. */
	async businessReceipt(
		receipt: { id: string; number: string | null; businessName: string },
		input: Pick<BusinessReceiptWrite, 'method' | 'amountINR' | 'receivedOn'>,
		context: TransactionContext,
		by: string | null,
	) {
		const landed: LedgerRef =
			input.method === 'cash'
				? { role: 'cash' }
				: await this.lands((landing) => (input.method === 'upi' ? upiLanding(landing) : bankLanding(landing)));
		return this.post(
			receiptPosting(input.amountINR, landed, 0),
			{
				date: input.receivedOn,
				narration: `Receipt ${receipt.number} · ${receipt.businessName}`,
				source: { type: 'businessReceipt', id: receipt.id, number: receipt.number },
				key: `businessReceipt:${receipt.id}`,
			},
			await this.stockLocation(),
			context,
			by,
		);
	}

	/** The ledger playing Customer advance; none (or several) means nothing can be held there. */
	private async advancesLedger(): Promise<string | null> {
		const chart = await this.ledger.chart();
		try {
			return resolveRole(chart.ledgers, 'customer_advances').id;
		} catch {
			return null;
		}
	}

	/**
	 * An order's Customer advance in the books, in paise: its receipts' credits less what its invoices and refund
	 * vouchers took. Below zero when an invoice took an advance whose receipt was never posted (saved before the books).
	 */
	private async advanceBalancePaise(orderId: string): Promise<number> {
		const advances = await this.advancesLedger();
		if (!advances) return 0;
		const [payments, invoices, refunds] = await Promise.all([
			this.payments.listByOrder(orderId),
			this.invoices.listForOrder(orderId),
			this.refunds.listForOrder(orderId),
		]);
		const keys = [
			...payments.flatMap((p) => [`receipt:${p.id}`, `receipt:${p.id}:void`]),
			...invoices.map((i) => `taxInvoice:${i.id}`),
			...refunds.map((r) => `refundVoucher:${r.id}`),
		];
		const vouchers = await Promise.all(keys.map((key) => this.ledger.voucherByKey(key)));
		return vouchers
			.flatMap((voucher) => voucher?.lines ?? [])
			.filter((line) => line.ledgerId === advances)
			.reduce((sum, line) => sum + line.creditPaise - line.debitPaise, 0);
	}

	/** What an order's customer still has as an advance: a tax invoice uses this much of it; the rest is debt. */
	async advanceHeldINR(orderId: string): Promise<number> {
		return Math.max(0, await this.advanceBalancePaise(orderId)) / 100;
	}

	/** What an order's invoices took from the advance with no receipt behind it: a late receipt fills this first. */
	private async advanceOwedINR(orderId: string): Promise<number> {
		return Math.max(0, -(await this.advanceBalancePaise(orderId))) / 100;
	}
}
