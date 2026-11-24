import { z } from 'zod';

import { Id, IsoDateTime } from './common';
import { IsoDate } from './purchasing';

/**
 * Bank accounts (accounts brief BA1–BA3, addendum AD1): each is a ledger in the books with the bank's details beside it.
 * A cash credit or overdraft sits under the bank overdraft group with its limit; a fixed deposit keeps its rate and
 * maturity. The account number is kept whole for the owner and the accountant, masked for everyone else.
 */

export const BankAccountKind = z.enum(['current', 'savings', 'cash_credit', 'overdraft', 'fixed_deposit']);
export type BankAccountKind = z.infer<typeof BankAccountKind>;

/** RBI's IFSC: four letters for the bank, a zero, six letters or digits for the branch. */
export const Ifsc = z
	.string()
	.trim()
	.toUpperCase()
	.regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, { message: 'ifsc_shape' });

export const BankAccountWrite = z.object({
	kind: BankAccountKind,
	ifsc: Ifsc,
	bankName: z.string().trim().min(2).max(80),
	branch: z.string().trim().max(80).default(''),
	holder: z.string().trim().min(2).max(120),
	/** The whole number as the bank gives it. */
	number: z
		.string()
		.trim()
		.regex(/^[0-9A-Z]{6,20}$/, { message: 'account_number_shape' }),
	shortName: z.string().trim().min(2).max(60),
	/** Cash credit or overdraft: the sanctioned limit. */
	limitINR: z.number().nonnegative().nullable().default(null),
	/** Fixed deposit: the rate and the day it matures. */
	ratePercent: z.number().nonnegative().max(100).nullable().default(null),
	maturesOn: IsoDate.nullable().default(null),
	locationId: Id.nullable().default(null),
	/** Money in it on the opening day: negative for an overdrawn or borrowed balance. */
	openingINR: z.number().default(0),
	openingOn: IsoDate.nullable().default(null),
	chequeFrom: z.string().trim().max(12).default(''),
	chequeTo: z.string().trim().max(12).default(''),
	upiIds: z.array(z.string().trim().min(3).max(80)).max(10).default([]),
	active: z.boolean().default(true),
});
export type BankAccountWrite = z.infer<typeof BankAccountWrite>;

export const BankAccount = BankAccountWrite.extend({
	id: Id,
	ledgerId: Id,
	/** The opening voucher, when there was an opening balance. */
	openingVoucherId: Id.nullable().default(null),
	version: z.number().int().nonnegative().default(0),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
	updatedBy: Id.nullable().default(null),
});
export type BankAccount = z.infer<typeof BankAccount>;

/** BA1: an account as the list shows it; the number is masked unless the person may see it whole. */
export const BankAccountRow = BankAccount.extend({
	numberShown: z.string(),
	/** Debit less credit in the books, in paise. */
	balancePaise: z.number().int(),
	/** Filled by statement imports (BA4–BA6). */
	lastStatementOn: IsoDate.nullable().default(null),
	toMatch: z.number().int().nonnegative().default(0),
	/** What lands here, from Where money lands. */
	lands: z.array(z.string()).default([]),
});
export type BankAccountRow = z.infer<typeof BankAccountRow>;

export const BANK_CHIPS = ['all', 'current', 'credit', 'deposits'] as const;
export const BankChip = z.enum(BANK_CHIPS);
export type BankChip = z.infer<typeof BankChip>;

export const BankAccountList = z.object({
	items: z.array(BankAccountRow),
	counts: z.record(BankChip, z.number().int().nonnegative()),
	/** The person may add and edit accounts and see numbers whole. */
	manage: z.boolean(),
});
export type BankAccountList = z.infer<typeof BankAccountList>;

/** BA2's IFSC lookup: the bank the code's first four letters name, from the app's own list. */
export const IfscLookup = z.object({ ifsc: z.string(), bankName: z.string().nullable() });
export type IfscLookup = z.infer<typeof IfscLookup>;
