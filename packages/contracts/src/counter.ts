import { z } from 'zod';

import { Id } from './common';
import { PriceINR } from './common';
import { IsoDate } from './purchasing';

/**
 * Counter mode (accounts brief P1–P4): a store sells over the counter from the same Create order screen. The sale is
 * invoiced at once, its stock leaves the store at once, and its payments land in the store's cash box (its open day
 * sheet) or the UPI and card clearing, posted in the same step. An exchange takes items back on a credit note and
 * sells others on a new invoice; the counter summary adds up a store's day.
 */

export const CounterPaymentMethod = z.enum(['cash', 'upi', 'card']);
export type CounterPaymentMethod = z.infer<typeof CounterPaymentMethod>;

export const CounterPaymentWrite = z.object({
	method: CounterPaymentMethod,
	amountINR: PriceINR.positive().max(100_000_000),
	/** UPI or card reference; none for cash. */
	reference: z.string().trim().max(120).default(''),
});
export type CounterPaymentWrite = z.infer<typeof CounterPaymentWrite>;

export const CounterLineWrite = z.object({
	productId: Id,
	variationId: Id.nullable().default(null),
	quantity: z.number().int().min(1).max(999),
	/** Found by scanning its SKU (shown on the line, P1). */
	scanned: z.boolean().default(false),
});
export type CounterLineWrite = z.infer<typeof CounterLineWrite>;

export const CounterBuyerWrite = z.object({
	phone: z.string().trim().max(20).default(''),
	name: z.string().trim().max(120).default(''),
	/** Optional under ₹50,000 for a buyer without a GSTIN (CGST rule 46). */
	address: z.string().trim().max(500).default(''),
	gstin: z
		.string()
		.trim()
		.toUpperCase()
		.regex(/^(\d{2}[A-Z0-9]{13})?$/, { message: 'gstin_shape' })
		.default(''),
});
export type CounterBuyerWrite = z.infer<typeof CounterBuyerWrite>;

export const CounterSaleWrite = z.object({
	locationId: Id,
	lines: z.array(CounterLineWrite).min(1).max(200),
	buyer: CounterBuyerWrite,
	payments: z.array(CounterPaymentWrite).min(1).max(5),
	/** The cash the buyer handed over; the change is worked out and is never a line on the sheet. */
	cashHandedINR: PriceINR.nonnegative().max(100_000_000).default(0),
	/** The full tax invoice on its format's paper (A4 by default, Settings › Document formats), or the 80 mm roll. */
	print: z.enum(['a4', 'roll80']).default('roll80'),
	/** The total the screen showed, so a price that changed meanwhile is refused instead of charged. */
	expectedTotalINR: PriceINR.nonnegative(),
});
export type CounterSaleWrite = z.infer<typeof CounterSaleWrite>;

export const CounterSale = z.object({
	orderId: Id,
	orderNumber: z.string(),
	invoiceId: Id,
	invoiceNumber: z.string(),
	totalINR: PriceINR,
	changeINR: PriceINR,
	receiptNumbers: z.array(z.string()),
	print: z.enum(['a4', 'roll80']),
});
export type CounterSale = z.infer<typeof CounterSale>;

export const CounterExchangeWrite = z.object({
	/** What comes back, from the bill's lines. */
	back: z
		.array(z.object({ lineId: Id, quantity: z.number().int().min(1), goes: z.enum(['stock', 'damaged']) }))
		.min(1)
		.max(50),
	/** What goes out instead (may be none: a plain return). */
	out: z.array(CounterLineWrite).max(50).default([]),
	/** How a difference is settled: money paid or given back at the counter, or kept on the buyer's account. */
	settle: z.enum(['cash', 'upi', 'card', 'store_credit']),
	reference: z.string().trim().max(120).default(''),
	expectedDifferenceINR: z.number(),
});
export type CounterExchangeWrite = z.infer<typeof CounterExchangeWrite>;

export const CounterSummaryQuery = z.object({ date: IsoDate, locationId: Id });
export type CounterSummaryQuery = z.infer<typeof CounterSummaryQuery>;

/** P4: a store's day at the counter; the cashier's copy leaves out cash. */
export const CounterSummary = z.object({
	date: IsoDate,
	locationId: Id,
	locationName: z.string(),
	byMethod: z.array(
		z.object({ method: CounterPaymentMethod, bills: z.number().int(), amountINR: z.number().nullable() }),
	),
	returns: z.object({ notes: z.number().int(), amountINR: z.number() }),
	exchangeNew: z.object({ bills: z.number().int(), amountINR: z.number() }),
	netSalesINR: z.number().nullable(),
	billNumbers: z.array(z.string()),
	firstAt: z.string().nullable(),
	lastAt: z.string().nullable(),
	discountsINR: z.number(),
	sheetStatus: z.string().nullable(),
	/** False on the cashier's copy (no cash figures). */
	cash: z.boolean(),
});
export type CounterSummary = z.infer<typeof CounterSummary>;
