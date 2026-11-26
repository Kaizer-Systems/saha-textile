import { z } from 'zod';

import { Id, IsoDateTime } from './common';
import { IsoDate } from './purchasing';
import { TaxInvoiceLine, TaxInvoiceParty } from './tax-invoice';

/**
 * Returns, credit notes and debit notes (accounts brief B1–B11, decisions D4, D9; owner-approved 2026-11-23). A return
 * changes nothing in stock or the books until its pieces are back and checked; the credit note does that when issued.
 * A credit note quotes one invoice and takes its lines and tax from that invoice, never from today's product.
 */

export const ReturnReason = z.enum([
	'damaged_on_arrival',
	'wrong_item',
	'not_as_described',
	'size_or_fit',
	'changed_mind',
	'other',
]);
export type ReturnReason = z.infer<typeof ReturnReason>;

/** How the pieces come back: our pickup (Shiprocket, once connected) or the customer sends them. */
export const ReturnHow = z.enum(['pickup', 'customer_sends']);
export type ReturnHow = z.infer<typeof ReturnHow>;

/** Where the money goes: back to the original payment, a bank transfer, or kept on the customer's account. */
export const RefundTo = z.enum(['original_payment', 'bank_transfer', 'customer_account']);
export type RefundTo = z.infer<typeof RefundTo>;

/** What happens to a returned piece once checked (B3). */
export const ReturnOutcome = z.enum(['restock', 'damaged', 'write_off']);
export type ReturnOutcome = z.infer<typeof ReturnOutcome>;

export const ReturnStatus = z.enum([
	'asked',
	'pickup_booked',
	'received',
	'checked',
	'credit_note',
	'refunded',
	'cancelled',
]);
export type ReturnStatus = z.infer<typeof ReturnStatus>;

export const ReturnLine = z.object({
	lineId: z.string(),
	sku: z.string(),
	title: z.string(),
	quantity: z.number().int().positive(),
	/** Pieces, or fabric by the metre (MTR) counted in tenths of a metre, as the invoice line counts it. */
	unit: z.enum(['PCS', 'MTR']).default('PCS'),
	/** What the buyer paid a piece (or a tenth of a metre), tax included, as on the invoice. */
	unitPriceINR: z.number().nonnegative(),
	outcome: ReturnOutcome.nullable().default(null),
	note: z.string().trim().max(300).default(''),
});
export type ReturnLine = z.infer<typeof ReturnLine>;

export const OrderReturn = z.object({
	id: Id,
	/** The order's child number: ST-2611-482190/R1. */
	number: z.string().min(1),
	orderId: Id,
	orderNumber: z.string(),
	invoiceId: Id,
	invoiceNumber: z.string(),
	status: ReturnStatus,
	timeline: z.array(z.object({ status: ReturnStatus, at: IsoDateTime, by: Id.nullable() })).default([]),
	lines: z.array(ReturnLine).min(1),
	reason: ReturnReason,
	how: ReturnHow,
	refundTo: RefundTo,
	note: z.string().trim().max(500).default(''),
	creditNoteId: Id.nullable().default(null),
	createdAt: IsoDateTime,
	createdBy: Id.nullable().default(null),
	updatedAt: IsoDateTime,
});
export type OrderReturn = z.infer<typeof OrderReturn>;

export const ReturnStart = z.object({
	lines: z.array(z.object({ lineId: z.string(), quantity: z.number().int().nonnegative() })).min(1),
	reason: ReturnReason,
	how: ReturnHow,
	refundTo: RefundTo,
	note: z.string().trim().max(500).default(''),
});
export type ReturnStart = z.infer<typeof ReturnStart>;

/** Pickup booked or Received, one step at a time. */
export const ReturnStep = z.object({ to: z.enum(['pickup_booked', 'received']) });
export type ReturnStep = z.infer<typeof ReturnStep>;

export const ReturnCheck = z.object({
	lines: z.array(
		z.object({ lineId: z.string(), outcome: ReturnOutcome, note: z.string().trim().max(300).default('') }),
	),
});
export type ReturnCheck = z.infer<typeof ReturnCheck>;

/** Goods returned, a price agreed lower after the sale (no goods back), or a parcel the courier brought back. */
export const CreditNoteKind = z.enum(['goods_returned', 'price_adjustment', 'undelivered']);
export type CreditNoteKind = z.infer<typeof CreditNoteKind>;

export const CreditNoteStatus = z.enum(['draft', 'issued', 'cancelled']);
export type CreditNoteStatus = z.infer<typeof CreditNoteStatus>;

export const CreditNoteLine = TaxInvoiceLine.extend({
	/** For returned goods: where the piece went; null for a price adjustment or the delivery line. */
	outcome: ReturnOutcome.nullable().default(null),
	/** The piece's cost, to put it back in stock at what it cost (FIFO layer). */
	unitCostINR: z.number().nonnegative().nullable().default(null),
	/** The cost layer the pieces went back into on Issue, so a cancel or debit note takes them out of it again. */
	layerId: Id.nullable().default(null),
	/** The hold a damaged piece went into on Issue, closed again when the note is undone. */
	holdId: Id.nullable().default(null),
	/** The delivery share line (CA B7.3): ₹0 until the CA answers. */
	delivery: z.boolean().default(false),
	note: z.string().default(''),
});
export type CreditNoteLine = z.infer<typeof CreditNoteLine>;

export const CreditNoteRefund = z.object({
	status: z.enum(['due', 'paid', 'kept']),
	paidAt: IsoDateTime.nullable().default(null),
	paidBy: Id.nullable().default(null),
	/** How it was paid: the gateway's refund, a bank transfer or UPI typed by hand, or cash from a till (P3). */
	method: z.enum(['gateway', 'bank_transfer', 'upi', 'cash']).nullable().default(null),
	reference: z.string().nullable().default(null),
	voucherId: Id.nullable().default(null),
});
export type CreditNoteRefund = z.infer<typeof CreditNoteRefund>;

export const CreditNote = z.object({
	id: Id,
	/** Given on Issue; null while a draft. */
	number: z.string().nullable().default(null),
	status: CreditNoteStatus,
	kind: CreditNoteKind,
	date: IsoDate,
	invoiceId: Id,
	invoiceNumber: z.string(),
	invoiceDate: IsoDate,
	gstRegistrationId: Id,
	gstin: z.string(),
	locationId: Id,
	orderId: Id,
	orderNumber: z.string(),
	returnId: Id.nullable().default(null),
	shipmentId: Id.nullable().default(null),
	buyer: TaxInvoiceParty,
	placeOfSupply: z.string().regex(/^\d{2}$/),
	interState: z.boolean(),
	reason: z.string().trim().min(1).max(300),
	refundTo: RefundTo,
	lines: z.array(CreditNoteLine).min(1),
	taxableINR: z.number().nonnegative(),
	cgstINR: z.number().nonnegative(),
	sgstINR: z.number().nonnegative(),
	igstINR: z.number().nonnegative(),
	roundOffINR: z.number(),
	totalINR: z.number().nonnegative(),
	/** CGST Act s.34: 30 November after the end of the invoice's financial year. */
	deadline: IsoDate,
	ratesPendingCa: z.boolean().default(true),
	voucherId: Id.nullable().default(null),
	refund: CreditNoteRefund.nullable().default(null),
	cancellation: z.object({ at: IsoDateTime, by: Id.nullable(), reason: z.string() }).nullable().default(null),
	/** Undone by this debit note (B9). */
	debitNoteId: Id.nullable().default(null),
	version: z.number().int().nonnegative().default(0),
	createdAt: IsoDateTime,
	createdBy: Id.nullable().default(null),
	issuedAt: IsoDateTime.nullable().default(null),
	issuedBy: Id.nullable().default(null),
});
export type CreditNote = z.infer<typeof CreditNote>;

/** A draft's changes before Issue: fewer pieces on a line, or none (the line leaves the note). */
export const CreditNoteDraftWrite = z.object({
	version: z.number().int().nonnegative(),
	lines: z.array(z.object({ lineId: z.string(), quantity: z.number().int().nonnegative() })).default([]),
	reason: z.string().trim().min(1).max(300).optional(),
});
export type CreditNoteDraftWrite = z.infer<typeof CreditNoteDraftWrite>;

/** B10: lower a line's price by an amount, tax included. */
export const PriceAdjustmentWrite = z.object({
	lines: z.array(z.object({ lineId: z.string(), lowerByINR: z.number().nonnegative() })).min(1),
	reason: z.string().trim().min(1).max(300),
	refundTo: z.enum(['original_payment', 'customer_account']),
});
export type PriceAdjustmentWrite = z.infer<typeof PriceAdjustmentWrite>;

/**
 * Refund now (B5): back through the gateway the order was paid with, or paid by hand (bank transfer or UPI) from a
 * cash or bank ledger, with its reference.
 */
export const CreditNoteRefundWrite = z.discriminatedUnion('how', [
	z.object({ how: z.literal('gateway') }),
	z.object({
		how: z.literal('by_hand'),
		method: z.enum(['bank_transfer', 'upi', 'cash']),
		ledgerId: Id,
		reference: z.string().trim().min(4).max(60),
	}),
]);
export type CreditNoteRefundWrite = z.infer<typeof CreditNoteRefundWrite>;

export const CreditNoteCancel = z.object({ reason: z.string().trim().min(5).max(300) });
export type CreditNoteCancel = z.infer<typeof CreditNoteCancel>;

/** Issuing a draft credit note: the version the screen last read, so a change made meanwhile is never issued unseen. */
export const CreditNoteIssue = z.object({ version: z.number().int().nonnegative() });
export type CreditNoteIssue = z.infer<typeof CreditNoteIssue>;

/** Accounts › Credit notes: the period, a search, a status and the page. */
export const CreditNoteListQuery = z.object({
	from: IsoDate,
	to: IsoDate,
	search: z.string().trim().max(80).default(''),
	status: CreditNoteStatus.nullable().default(null),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type CreditNoteListQuery = z.infer<typeof CreditNoteListQuery>;

/** B8's checks: why a credit note may (or may not) be cancelled. */
export const CreditNoteCancelChecks = z.object({
	monthFiled: z.boolean(),
	booksClosed: z.boolean(),
	refundPaid: z.boolean(),
	superAdmin: z.boolean(),
	allowed: z.boolean(),
	month: z.string(),
});
export type CreditNoteCancelChecks = z.infer<typeof CreditNoteCancelChecks>;

export const DebitNote = z.object({
	id: Id,
	number: z.string().min(1),
	date: IsoDate,
	gstRegistrationId: Id,
	gstin: z.string(),
	locationId: Id,
	orderId: Id,
	orderNumber: z.string(),
	invoiceId: Id,
	invoiceNumber: z.string(),
	/** The credit note it undoes. */
	creditNoteId: Id,
	creditNoteNumber: z.string(),
	buyer: TaxInvoiceParty,
	placeOfSupply: z.string().regex(/^\d{2}$/),
	interState: z.boolean(),
	reason: z.string().trim().min(5).max(300),
	lines: z.array(CreditNoteLine).min(1),
	taxableINR: z.number().nonnegative(),
	cgstINR: z.number().nonnegative(),
	sgstINR: z.number().nonnegative(),
	igstINR: z.number().nonnegative(),
	roundOffINR: z.number(),
	totalINR: z.number().nonnegative(),
	voucherId: Id.nullable().default(null),
	createdAt: IsoDateTime,
	createdBy: Id.nullable().default(null),
});
export type DebitNote = z.infer<typeof DebitNote>;

export const DebitNoteWrite = z.object({ reason: z.string().trim().min(5).max(300) });
export type DebitNoteWrite = z.infer<typeof DebitNoteWrite>;

/** Settings › Accounts › Returns (D4): days after delivery a return may be started. */
export const ReturnSettings = z.object({ windowDays: z.number().int().min(0).max(90).default(7) });
export type ReturnSettings = z.infer<typeof ReturnSettings>;

/** B1 Documents card: every document of the order, each with what it can open and print. */
export const OrderDocumentKind = z.enum([
	'taxInvoice',
	'receipt',
	'packingSlip',
	'return',
	'creditNote',
	'debitNote',
	'refundVoucher',
]);
export type OrderDocumentKind = z.infer<typeof OrderDocumentKind>;

export const OrderDocumentRow = z.object({
	kind: OrderDocumentKind,
	/** The invoice, payment, parcel, return, credit note or debit note. */
	id: Id,
	number: z.string().nullable(),
	date: IsoDate.nullable(),
	amountINR: z.number().nullable(),
	/** Draft, cancelled and the like; null when it is simply in force. */
	status: z.string().nullable(),
	/** A debit note opens the credit note it undoes. */
	creditNoteId: Id.nullable().default(null),
});
export type OrderDocumentRow = z.infer<typeof OrderDocumentRow>;

/** The order page's Returns and credit notes card (B1). */
export const OrderReturnsView = z.object({
	invoiceId: Id.nullable(),
	invoiceNumber: z.string().nullable(),
	deliveredOn: IsoDate.nullable(),
	windowEnds: IsoDate.nullable(),
	windowOpen: z.boolean(),
	deadline: IsoDate.nullable(),
	returnable: z.array(
		z.object({
			lineId: z.string(),
			sku: z.string(),
			title: z.string(),
			bought: z.number().int().nonnegative(),
			returnedBefore: z.number().int().nonnegative(),
			/** Pieces, or tenths of a metre for fabric (MTR); bought, returned and the price follow it. */
			unit: z.enum(['PCS', 'MTR']).default('PCS'),
			returnable: z.boolean(),
			categoryName: z.string().nullable(),
			unitPriceINR: z.number().nonnegative(),
		}),
	),
	/** The order's parcels: one not delivered can be brought back with a credit note (B11). */
	parcels: z.array(z.object({ shipmentId: Id, number: z.string(), courier: z.string(), delivered: z.boolean() })),
	returns: z.array(OrderReturn),
	creditNotes: z.array(CreditNote),
	debitNotes: z.array(DebitNote),
	documents: z.array(OrderDocumentRow).default([]),
});
export type OrderReturnsView = z.infer<typeof OrderReturnsView>;
