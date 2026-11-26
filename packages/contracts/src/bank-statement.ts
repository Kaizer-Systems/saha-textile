import { z } from 'zod';

import { Id, IsoDateTime } from './common';
import { IsoDate } from './purchasing';

/**
 * Bank statements (accounts brief BA4–BA7): a bank's layout matched once and saved, the lines read from a statement
 * file and checked before saving, each line kept once, and later matched to the books.
 */

export const StatementDateFormat = z.enum(['DD/MM/YY', 'DD/MM/YYYY', 'DD-MM-YYYY', 'YYYY-MM-DD', 'DD MMM YYYY']);
export type StatementDateFormat = z.infer<typeof StatementDateFormat>;

const Column = z.number().int().min(0).max(60).nullable();

/** BA5: which column of the file is which, once per bank layout. */
export const BankLayout = z.object({
	id: Id,
	name: z.string().trim().min(2).max(60),
	skipRows: z.number().int().min(0).max(200),
	dateFormat: StatementDateFormat,
	/** Separate withdrawal and deposit columns, or one amount with a Dr/Cr column. */
	money: z.enum(['split', 'signed_drcr']),
	columns: z.object({
		date: Column,
		description: Column,
		reference: Column,
		withdrawal: Column,
		deposit: Column,
		amount: Column,
		drcr: Column,
		balance: Column,
		/** The bank's value date: matched so the column is named, not read into the line (BA5). */
		valueDate: Column.optional(),
	}),
	updatedAt: IsoDateTime,
});
export type BankLayout = z.infer<typeof BankLayout>;

export const BankLayoutWrite = BankLayout.omit({ id: true, updatedAt: true }).extend({
	id: Id.nullable().default(null),
});
export type BankLayoutWrite = z.infer<typeof BankLayoutWrite>;

export const BankLineStatus = z.enum(['unmatched', 'suggested', 'accepted', 'rejected']);
export type BankLineStatus = z.infer<typeof BankLineStatus>;

export const BankLine = z.object({
	id: Id,
	bankAccountId: Id,
	date: IsoDate,
	description: z.string(),
	reference: z.string(),
	outPaise: z.number().int().nonnegative(),
	inPaise: z.number().int().nonnegative(),
	balancePaise: z.number().int().nullable().default(null),
	/** The same line imported again is skipped by this. */
	key: z.string(),
	importId: Id,
	status: BankLineStatus.default('unmatched'),
	/**
	 * What it is matched to in the books (B1c, BA7): the entries suggested or accepted, why, and how sure; or an entry
	 * a rule makes on Accept (bank charges, interest), with its GST rate.
	 */
	match: z
		.object({
			voucherIds: z.array(Id),
			why: z.string(),
			sure: z.boolean(),
			by: Id.nullable(),
			at: IsoDateTime.nullable(),
			entry: z.enum(['bank_charge', 'interest']).nullable().default(null),
			gstPercent: z.number().nonnegative().max(28).nullable().default(null),
			ruleId: Id.nullable().default(null),
		})
		.nullable()
		.default(null),
	/** Suggestions turned down (voucher ids or rule ids), never offered again for this line. */
	rejectedKeys: z.array(z.string()).max(100).default([]),
	createdAt: IsoDateTime,
});
export type BankLine = z.infer<typeof BankLine>;

/** BA6: a line as checked before saving, every cell open to correction. */
export const StatementLineWrite = z.object({
	date: IsoDate,
	description: z.string().trim().max(300),
	reference: z.string().trim().max(80).default(''),
	outPaise: z.number().int().nonnegative(),
	inPaise: z.number().int().nonnegative(),
	balancePaise: z.number().int().nullable().default(null),
});
export type StatementLineWrite = z.infer<typeof StatementLineWrite>;

/** BA4 → BA6: the rows read from the file, with the layout to read them by. */
export const StatementPreviewWrite = z.object({
	layoutId: Id,
	rows: z.array(z.array(z.string().max(500)).max(60)).max(5000),
});
export type StatementPreviewWrite = z.infer<typeof StatementPreviewWrite>;

export const StatementPreview = z.object({
	lines: z.array(StatementLineWrite.extend({ row: z.number().int(), already: z.boolean() })),
	problems: z.array(z.object({ row: z.number().int(), problem: z.string() })),
});
export type StatementPreview = z.infer<typeof StatementPreview>;

export const StatementSaveWrite = z.object({
	fileName: z.string().trim().max(200).default(''),
	openingPaise: z.number().int(),
	closingPaise: z.number().int(),
	lines: z.array(StatementLineWrite).min(1).max(5000),
});
export type StatementSaveWrite = z.infer<typeof StatementSaveWrite>;

export const BankImport = z.object({
	id: Id,
	bankAccountId: Id,
	fileName: z.string(),
	openingPaise: z.number().int(),
	closingPaise: z.number().int(),
	saved: z.number().int().nonnegative(),
	skipped: z.number().int().nonnegative(),
	lastDate: IsoDate,
	at: IsoDateTime,
	by: Id.nullable(),
});
export type BankImport = z.infer<typeof BankImport>;

export const BankLineQuery = z.object({
	from: IsoDate,
	to: IsoDate,
	status: BankLineStatus.nullable().default(null),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type BankLineQuery = z.infer<typeof BankLineQuery>;

export const BankLinePage = z.object({
	items: z.array(BankLine),
	total: z.number().int().nonnegative(),
	counts: z.record(z.string(), z.number().int().nonnegative()),
});
export type BankLinePage = z.infer<typeof BankLinePage>;
