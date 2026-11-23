import { z } from 'zod';

import { Id, IsoDateTime } from './common';
import { IsoDate } from './purchasing';

/**
 * Tax invoices issued when goods leave (accounts brief D1, D3; owner-approved 2026-11-23). One invoice per dispatch,
 * numbered per GSTIN (TI/26-27/000001), with HSN and GST on every line, stored as its own document and printed as the
 * three Rule 48 copies. Until the CA confirms the rates (round 2, B2.4–B2.6, B2.9) invoices use today's rates and say so.
 */

export const TaxInvoiceLine = z.object({
	lineId: z.string(),
	sku: z.string(),
	title: z.string(),
	hsn: z.string(),
	quantity: z.number().positive(),
	unit: z.enum(['PCS', 'MTR']).default('PCS'),
	/** The price charged per unit, tax included (shop prices include GST). */
	unitPriceINR: z.number().nonnegative(),
	ratePercent: z.number().nonnegative(),
	taxableINR: z.number().nonnegative(),
	cgstINR: z.number().nonnegative().default(0),
	sgstINR: z.number().nonnegative().default(0),
	igstINR: z.number().nonnegative().default(0),
	totalINR: z.number().nonnegative(),
});
export type TaxInvoiceLine = z.infer<typeof TaxInvoiceLine>;

export const TaxInvoiceParty = z.object({
	name: z.string(),
	gstin: z.string().nullable().default(null),
	address: z.string().default(''),
	stateCode: z.string().regex(/^\d{2}$/),
});
export type TaxInvoiceParty = z.infer<typeof TaxInvoiceParty>;

export const TaxInvoiceStatus = z.enum(['issued', 'cancelled']);
export type TaxInvoiceStatus = z.infer<typeof TaxInvoiceStatus>;

export const TaxInvoice = z.object({
	id: Id,
	number: z.string().min(1),
	/** The day it was issued (India): its GST month. */
	date: IsoDate,
	gstRegistrationId: Id,
	gstin: z.string(),
	locationId: Id,
	orderId: Id,
	orderNumber: z.string(),
	shipmentId: Id.nullable().default(null),
	seller: TaxInvoiceParty,
	buyer: TaxInvoiceParty,
	/** Place of supply: the State the goods go to; another State than the seller's means IGST. */
	placeOfSupply: z.string().regex(/^\d{2}$/),
	interState: z.boolean(),
	lines: z.array(TaxInvoiceLine).min(1),
	shippingINR: z.number().nonnegative().default(0),
	taxableINR: z.number().nonnegative(),
	cgstINR: z.number().nonnegative(),
	sgstINR: z.number().nonnegative(),
	igstINR: z.number().nonnegative(),
	roundOffINR: z.number(),
	totalINR: z.number().nonnegative(),
	/** Today's rates, not yet confirmed by the CA: the print says so. */
	ratesPendingCa: z.boolean().default(true),
	status: TaxInvoiceStatus.default('issued'),
	cancellation: z.object({ at: IsoDateTime, by: Id.nullable(), reason: z.string() }).nullable().default(null),
	/** The voucher that posted it to the books. */
	voucherId: Id.nullable().default(null),
	createdBy: Id.nullable().default(null),
	createdAt: IsoDateTime,
});
export type TaxInvoice = z.infer<typeof TaxInvoice>;

/** Rule 48: the three copies of a tax invoice, in the order the rule gives them. */
export const InvoiceCopy = z.enum(['original', 'duplicate', 'triplicate']);
export type InvoiceCopy = z.infer<typeof InvoiceCopy>;
export const INVOICE_COPY_LABELS: Readonly<Record<InvoiceCopy, string>> = {
	original: 'Original for recipient',
	duplicate: 'Duplicate for transporter',
	triplicate: 'Triplicate for supplier',
};

export const TaxInvoiceCancel = z.object({ reason: z.string().trim().min(5).max(300) });
export type TaxInvoiceCancel = z.infer<typeof TaxInvoiceCancel>;

/**
 * Q5's "Checks it passed": what was true when the invoice was issued, each with the facts it shows. `cancel` is
 * never open here: an issued invoice is corrected by a credit note (D2; CA question B6.4 decides the rest).
 */
export const InvoiceCheckKey = z.enum([
	'period_open',
	'number_in_series',
	'place_of_supply',
	'stock_at_cost',
	'rates',
	'cancel',
]);
export type InvoiceCheckKey = z.infer<typeof InvoiceCheckKey>;
export const InvoiceCheck = z.object({
	key: InvoiceCheckKey,
	ok: z.boolean(),
	params: z.record(z.string(), z.string()).default({}),
});
export type InvoiceCheck = z.infer<typeof InvoiceCheck>;

/** Q5, the Accounting tab: the invoice's posted lines with their names, and its checks. */
export const TaxInvoiceAccounting = z.object({
	voucherId: Id.nullable(),
	voucherNumber: z.string().nullable(),
	lines: z.array(
		z.object({
			ledgerId: Id,
			ledgerName: z.string(),
			locationName: z.string(),
			debitPaise: z.number().int().nonnegative(),
			creditPaise: z.number().int().nonnegative(),
		}),
	),
	totalPaise: z.number().int().nonnegative(),
	checks: z.array(InvoiceCheck),
});
export type TaxInvoiceAccounting = z.infer<typeof TaxInvoiceAccounting>;
