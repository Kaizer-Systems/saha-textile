import { z } from 'zod';

import { Id, IsoDateTime } from './common';
import { IsoDate } from './purchasing';

/**
 * Bills for services and expenses with their GST credit (brief 25 EB1, EB2; approved 2026-11-25): shop rent from a
 * registered landlord, software, the CA's fees, courier charges. Each line names its expense ledger, the SAC, the
 * taxable value and GST rate, and whether its credit can be claimed or is blocked (s.17(5)); posted, the expense (with
 * any blocked tax in its cost) and the claimable input tax are debited at the billed location and the supplier credited.
 */
export const ExpenseCredit = z.enum(['claim', 'blocked']);
export type ExpenseCredit = z.infer<typeof ExpenseCredit>;

export const ExpenseBillLine = z.object({
	expenseLedgerId: Id,
	what: z.string().trim().min(1).max(200),
	sac: z
		.string()
		.trim()
		.regex(/^(\d{4}|\d{6}|\d{8})?$/, { message: 'sac_shape' })
		.default(''),
	taxableINR: z.number().nonnegative().max(1e10),
	gstRatePct: z.number().min(0).max(28),
	credit: ExpenseCredit.default('claim'),
	/** Blocked lines: the clause of s.17(5) (e.g. `b` for food and staff welfare). */
	blockedClause: z.string().trim().max(10).default(''),
});
export type ExpenseBillLine = z.infer<typeof ExpenseBillLine>;

export const ExpenseBillStatus = z.enum(['draft', 'posted', 'cancelled']);
export type ExpenseBillStatus = z.infer<typeof ExpenseBillStatus>;

export const ExpenseBillWrite = z.object({
	supplierId: Id,
	billNumber: z.string().trim().min(1).max(40),
	billDate: IsoDate,
	/** Billed to: the location and through it the GSTIN whose credit this is. */
	locationId: Id,
	lines: z.array(ExpenseBillLine).min(1).max(50),
	note: z.string().trim().max(500).default(''),
});
export type ExpenseBillWrite = z.infer<typeof ExpenseBillWrite>;

export const ExpenseBill = ExpenseBillWrite.extend({
	id: Id,
	/** EB/26-27/000001, given when it is posted. */
	number: z.string().nullable().default(null),
	status: ExpenseBillStatus,
	/** Worked out on save: in-State bills split CGST and SGST, other States IGST. */
	interState: z.boolean(),
	taxableINR: z.number(),
	cgstINR: z.number(),
	sgstINR: z.number(),
	igstINR: z.number(),
	blockedTaxINR: z.number(),
	totalINR: z.number(),
	voucherId: Id.nullable().default(null),
	postedAt: IsoDateTime.nullable().default(null),
	postedBy: Id.nullable().default(null),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
	version: z.number().int().nonnegative(),
});
export type ExpenseBill = z.infer<typeof ExpenseBill>;

/** What the expense bill form offers: where a bill can be billed to (with its GSTIN), and the expense ledgers. */
export const ExpenseBillForm = z.object({
	locations: z.array(
		z.object({
			id: Id,
			name: z.string(),
			stateCode: z.string(),
			gstin: z.string().nullable(),
			/** A composition GSTIN takes no input credit, so every line's tax joins its cost. */
			composition: z.boolean(),
		}),
	),
	ledgers: z.array(z.object({ id: Id, name: z.string() })),
});
export type ExpenseBillForm = z.infer<typeof ExpenseBillForm>;
