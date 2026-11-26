import { z } from 'zod';

import { Id, IsoDateTime } from './common';
import { IsoDate } from './purchasing';

/**
 * Settlements (accounts brief Q10, D27): the payout files of the payment gateways and the couriers' cash-on-delivery
 * remittances, each payout matched to the order payments it pays and posted as Bank, charges and the input GST on
 * them against what the gateway or courier held. A gateway payment missing from every payout after 7 days is flagged.
 */

export const SettlementKind = z.enum(['gateway', 'cod']);
export type SettlementKind = z.infer<typeof SettlementKind>;

/** One row of a payout file: the payment (gateway id or order number) and its money, in paise. */
export const SettlementRowWrite = z.object({
	payoutReference: z.string().trim().min(1).max(80),
	date: IsoDate,
	reference: z.string().trim().min(1).max(120),
	grossPaise: z.number().int().nonnegative(),
	chargesPaise: z.number().int().nonnegative().default(0),
	gstPaise: z.number().int().nonnegative().default(0),
});
export type SettlementRowWrite = z.infer<typeof SettlementRowWrite>;

export const SettlementImportWrite = z.object({
	kind: SettlementKind,
	/** Who paid out: the gateway or the courier, as named on the screen ("CCAvenue", "Shiprocket"). */
	provider: z.string().trim().min(2).max(40),
	bankAccountId: Id,
	fileName: z.string().trim().max(200).default(''),
	rows: z.array(SettlementRowWrite).min(1).max(5000),
});
export type SettlementImportWrite = z.infer<typeof SettlementImportWrite>;

export const SettlementRow = SettlementRowWrite.omit({ payoutReference: true, date: true }).extend({
	orderId: Id.nullable(),
	orderNumber: z.string().nullable(),
	paymentId: Id.nullable(),
});
export type SettlementRow = z.infer<typeof SettlementRow>;

export const Settlement = z.object({
	id: Id,
	kind: SettlementKind,
	provider: z.string(),
	/** The payout's own reference (the bank UTR), which its statement line carries. */
	payoutReference: z.string(),
	date: IsoDate,
	bankAccountId: Id,
	rows: z.array(SettlementRow),
	grossPaise: z.number().int(),
	chargesPaise: z.number().int(),
	gstPaise: z.number().int(),
	/** What reached the bank: gross less charges and their GST. */
	netPaise: z.number().int(),
	/** Rows matched to an order payment. */
	matched: z.number().int().nonnegative(),
	voucherId: Id.nullable(),
	fileName: z.string(),
	createdAt: IsoDateTime,
	createdBy: Id.nullable(),
});
export type Settlement = z.infer<typeof Settlement>;

/** Q10 before saving: each payout of the file, its rows matched, and whether it was imported already. */
export const SettlementPreview = z.object({
	payouts: z.array(
		Settlement.pick({
			payoutReference: true,
			date: true,
			rows: true,
			grossPaise: true,
			chargesPaise: true,
			gstPaise: true,
			netPaise: true,
			matched: true,
		}).extend({ already: z.boolean() }),
	),
});
export type SettlementPreview = z.infer<typeof SettlementPreview>;

export const SettlementListQuery = z.object({
	kind: SettlementKind.default('gateway'),
	from: IsoDate,
	to: IsoDate,
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type SettlementListQuery = z.infer<typeof SettlementListQuery>;

export const SettlementList = z.object({
	items: z.array(Settlement),
	total: z.number().int().nonnegative(),
	counts: z.record(SettlementKind, z.number().int().nonnegative()),
	/** Gateway payments received more than 7 days ago that no payout has paid yet. */
	unsettled: z.array(
		z.object({
			paymentId: Id,
			orderId: Id,
			gateway: z.string(),
			reference: z.string().nullable(),
			receivedOn: IsoDate,
			amountINR: z.number(),
		}),
	),
});
export type SettlementList = z.infer<typeof SettlementList>;
