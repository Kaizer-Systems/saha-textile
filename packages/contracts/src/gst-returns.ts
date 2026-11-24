import { z } from 'zod';

import { Id, IsoDateTime } from './common';
import { YearMonth } from './ledger';
import { IsoDate } from './purchasing';

/**
 * GST returns from the books (accounts brief G3, G4, G6): a return is prepared from the books for a GSTIN and month,
 * checked by the accountant, approved by the CA (or owner), then filed on the portal and its ARN entered, which locks
 * the month's sales for that GSTIN.
 */

export const GstDraftType = z.enum(['GSTR-1', 'GSTR-3B']);
export type GstDraftType = z.infer<typeof GstDraftType>;

export const GstDraftStatus = z.enum(['prepared', 'checked', 'approved', 'filed']);
export type GstDraftStatus = z.infer<typeof GstDraftStatus>;

/** One table of a return: how many records, and its taxable value and tax in rupees. */
export const GstReturnSummaryRow = z.object({
	table: z.string(),
	records: z.number().int().nonnegative(),
	taxable: z.number(),
	tax: z.number(),
});
export type GstReturnSummaryRow = z.infer<typeof GstReturnSummaryRow>;

export const GstReturnProblem = z.object({ table: z.string(), problem: z.string(), document: z.string() });
export type GstReturnProblem = z.infer<typeof GstReturnProblem>;

/** Tax by head, in paise. */
export const GstTaxHeads = z.object({ igst: z.number().int(), cgst: z.number().int(), sgst: z.number().int() });
export type GstTaxHeads = z.infer<typeof GstTaxHeads>;

/** Q7: each credit's use against output tax (s.49, rule 88A), what is paid in cash and what is carried forward. */
export const GstSetOff = z.object({
	liability: GstTaxHeads,
	credit: GstTaxHeads,
	igstUsed: GstTaxHeads,
	cgstUsed: z.object({ cgst: z.number().int(), igst: z.number().int() }),
	sgstUsed: z.object({ sgst: z.number().int(), igst: z.number().int() }),
	cash: GstTaxHeads,
	carried: GstTaxHeads,
	/** Reverse-charge tax, always paid in cash. */
	reverseChargeCash: GstTaxHeads,
});
export type GstSetOff = z.infer<typeof GstSetOff>;

/** A change the accountant makes to a GSTR-3B table (G6 "Can change here"), kept with its reason. */
export const Gstr3bAdjustment = GstTaxHeads.extend({
	table: z.enum(['3.1d', '4A', '4B']),
	reason: z.string().trim().min(1).max(200),
});
export type Gstr3bAdjustment = z.infer<typeof Gstr3bAdjustment>;

/** The challan a GSTR-3B's cash was paid with. */
export const GstChallan = z.object({
	number: z.string(),
	paidOn: IsoDate,
	bankAccountId: Id,
	amountPaise: z.number().int().nonnegative(),
	setOffNumber: z.string().nullable(),
	challanNumber: z.string().nullable(),
});
export type GstChallan = z.infer<typeof GstChallan>;

export const GstReturnDraft = z.object({
	id: Id,
	gstRegistrationId: Id,
	gstin: z.string(),
	returnType: GstDraftType,
	month: YearMonth,
	status: GstDraftStatus,
	summary: z.array(GstReturnSummaryRow),
	problems: z.array(GstReturnProblem),
	/** The file the GST portal takes, as prepared. */
	portal: z.record(z.string(), z.unknown()),
	preparedBy: Id.nullable(),
	preparedAt: IsoDateTime,
	checkedBy: Id.nullable().default(null),
	checkedAt: IsoDateTime.nullable().default(null),
	approvedBy: Id.nullable().default(null),
	approvedAt: IsoDateTime.nullable().default(null),
	/** Who took each step, by name, as G4's subtitle says it. */
	preparedByName: z.string().default(''),
	checkedByName: z.string().default(''),
	approvedByName: z.string().default(''),
	/** Once filed on the portal: its ARN and day, from the filing (G8). */
	arn: z.string().nullable().default(null),
	filedOn: IsoDate.nullable().default(null),
	/** GSTR-3B only: the set-off and cash to pay (Q7), and the accountant's changes with their reasons. */
	setOff: GstSetOff.nullable().default(null),
	adjustments: z.array(Gstr3bAdjustment).default([]),
	/** GSTR-3B only: the set-off journal and the challan's payment, once posted (Q7 Post the set-off). */
	setOffVoucherId: Id.nullable().default(null),
	challanVoucherId: Id.nullable().default(null),
	/** GSTR-3B only: the challan paid (PMT-06), once posted. */
	challan: GstChallan.nullish(),
	version: z.number().int().nonnegative().default(0),
});
export type GstReturnDraft = z.infer<typeof GstReturnDraft>;

/** Q7 Post the set-off: the challan paid on the portal and the bank account it was paid from. */
export const GstSetOffPost = z.object({
	bankAccountId: Id,
	paidOn: IsoDate,
	/** The challan's CPIN or CIN, as the portal shows it. */
	challan: z
		.string()
		.trim()
		.transform((value) => value.toUpperCase().replace(/\s+/g, ''))
		.pipe(z.string().regex(/^[A-Z0-9]{6,20}$/, { message: 'challan_shape' })),
	version: z.number().int().nonnegative(),
});
export type GstSetOffPost = z.infer<typeof GstSetOffPost>;
export type GstSetOffPostInput = z.input<typeof GstSetOffPost>;

/** Prepare (or prepare again, before approval) a return from the books; a GSTR-3B carries the accountant's changes. */
export const GstReturnPrepare = z.object({
	gstRegistrationId: Id,
	returnType: GstDraftType,
	month: YearMonth,
	adjustments: z.array(Gstr3bAdjustment).max(30).default([]),
});
export type GstReturnPrepare = z.infer<typeof GstReturnPrepare>;
export type GstReturnPrepareInput = z.input<typeof GstReturnPrepare>;

/** The next step: the accountant has checked it, or the CA approves it. */
export const GstReturnStep = z.object({
	to: z.enum(['checked', 'approved']),
	version: z.number().int().nonnegative(),
});
export type GstReturnStep = z.infer<typeof GstReturnStep>;

export const GstCalendarChip = z.enum(['due', 'filed', 'all']);
export type GstCalendarChip = z.infer<typeof GstCalendarChip>;

export const GstCalendarQuery = z.object({ gstRegistrationId: Id, chip: GstCalendarChip.default('due') });
export type GstCalendarQuery = z.infer<typeof GstCalendarQuery>;

export const GstCalendarRow = z.object({
	returnType: z.enum(['GSTR-1', 'GSTR-3B', 'GSTR-9']),
	/** `YYYY-MM`, or the financial year (`2025-26`) for the annual return. */
	period: z.string(),
	dueOn: IsoDate,
	status: z.enum(['not_started', 'prepared', 'checked', 'approved', 'filed']),
	arn: z.string().nullable(),
	draftId: Id.nullable(),
});
export type GstCalendarRow = z.infer<typeof GstCalendarRow>;

export const GstCalendar = z.object({
	gstin: z.string(),
	rows: z.array(GstCalendarRow),
	counts: z.record(GstCalendarChip, z.number().int().nonnegative()),
});
export type GstCalendar = z.infer<typeof GstCalendar>;

/* GSTR-2B against our purchases (G5). */

export const ImsAction = z.enum(['accept', 'reject', 'pending', 'held']);
export type ImsAction = z.infer<typeof ImsAction>;

export const Gstr2bResult = z.enum(['matched', 'different', 'only_2b', 'only_books', 'note']);
export type Gstr2bResult = z.infer<typeof Gstr2bResult>;

export const Gstr2bChip = z.enum(['all', 'matched', 'different', 'only_2b', 'only_books', 'note']);
export type Gstr2bChip = z.infer<typeof Gstr2bChip>;

/** Taxable value and tax by head, in paise. */
const Gstr2bMoney = GstTaxHeads.extend({ taxable: z.number().int() });

/** A supplier's document as GSTR-2B shows it (paise). */
export const Gstr2bLine = Gstr2bMoney.extend({
	key: z.string(),
	kind: z.enum(['invoice', 'credit', 'debit']),
	supplierGstin: z.string(),
	supplierName: z.string(),
	number: z.string(),
	date: IsoDate,
	supplierPeriod: YearMonth.nullable(),
	filedOn: IsoDate.nullable(),
	reverseCharge: z.boolean(),
	itcAvailable: z.boolean(),
	reason: z.string().nullable(),
});
export type Gstr2bLine = z.infer<typeof Gstr2bLine>;

/** An imported 2B for a GSTIN and month, with what was done on the portal for each line (IMS). */
export const Gstr2bImport = z.object({
	id: Id,
	gstRegistrationId: Id,
	gstin: z.string(),
	month: YearMonth,
	generatedOn: IsoDate.nullable(),
	lines: z.array(Gstr2bLine),
	notRead: z.array(z.object({ section: z.string(), count: z.number().int().nonnegative() })),
	decisions: z.record(z.string(), z.enum(['accept', 'reject', 'pending'])),
	importedBy: Id.nullable(),
	importedByName: z.string(),
	importedAt: IsoDateTime,
	version: z.number().int().nonnegative(),
});
export type Gstr2bImport = z.infer<typeof Gstr2bImport>;

/** Import: the 2B file as downloaded from the portal (JSON), for a GSTIN; its month is read from the file. */
export const Gstr2bImportWrite = z.object({ gstRegistrationId: Id, file: z.record(z.string(), z.unknown()) });
export type Gstr2bImportWrite = z.infer<typeof Gstr2bImportWrite>;

export const Gstr2bQuery = z.object({ gstRegistrationId: Id, month: YearMonth, chip: Gstr2bChip.default('all') });
export type Gstr2bQuery = z.infer<typeof Gstr2bQuery>;

export const Gstr2bRow = z.object({
	key: z.string(),
	result: Gstr2bResult,
	kind: z.enum(['invoice', 'credit', 'debit']),
	supplierGstin: z.string(),
	supplierName: z.string(),
	number: z.string(),
	date: IsoDate,
	reverseCharge: z.boolean(),
	itcAvailable: z.boolean(),
	books: Gstr2bMoney.nullable(),
	twoB: Gstr2bMoney.nullable(),
	entryId: Id.nullable(),
	entryNumber: z.string().nullable(),
	action: ImsAction,
});
export type Gstr2bRow = z.infer<typeof Gstr2bRow>;

export const Gstr2bView = z.object({
	gstin: z.string(),
	month: YearMonth,
	/** Null until a 2B is imported for the month. */
	importId: Id.nullable(),
	importedAt: IsoDateTime.nullable(),
	importedByName: z.string(),
	generatedOn: IsoDate.nullable(),
	notRead: z.array(z.object({ section: z.string(), count: z.number().int().nonnegative() })),
	counts: z.record(Gstr2bChip, z.number().int().nonnegative()),
	rows: z.array(Gstr2bRow),
	/** Credit GSTR-3B may claim from the accepted lines (4A(5)). */
	claim: GstTaxHeads,
	/** True once the month's GSTR-3B is filed: nothing more can change. */
	locked: z.boolean(),
	version: z.number().int().nonnegative(),
});
export type Gstr2bView = z.infer<typeof Gstr2bView>;

/** What was done on the portal (IMS) for one line. */
export const Gstr2bDecision = z.object({
	gstRegistrationId: Id,
	month: YearMonth,
	key: z.string().min(1).max(120),
	action: z.enum(['accept', 'reject', 'pending']),
	version: z.number().int().nonnegative(),
});
export type Gstr2bDecision = z.infer<typeof Gstr2bDecision>;

/* GSTR-9 against the books, and the monthly books-to-returns check (G9, G7). */

/** A financial year, `2025-26`. */
export const FinancialYear = z
	.string()
	.regex(/^\d{4}-\d{2}$/, { message: 'year_shape' })
	.refine((year) => (Number(year.slice(0, 4)) + 1) % 100 === Number(year.slice(5)), { message: 'year_shape' });

export const GstAnnualQuery = z.object({ gstRegistrationId: Id, year: FinancialYear });
export type GstAnnualQuery = z.infer<typeof GstAnnualQuery>;

export const GstAnnualRow = z.object({
	table: z.enum(['4', '5', '6', '7', '17']),
	/** Paise, or a count for table 17 (HSN codes). */
	returns: z.number().int(),
	books: z.number().int(),
	unit: z.enum(['paise', 'count']),
	/** Why the two differ, as the accountant wrote it. */
	note: z.string(),
});
export type GstAnnualRow = z.infer<typeof GstAnnualRow>;

/** A month's returns against the books (paise); a return's figures are null until it is filed. */
export const GstMonthCheck = z.object({
	month: YearMonth,
	gstr1Tax: z.number().int().nullable(),
	gstr3bTax: z.number().int().nullable(),
	booksTax: z.number().int(),
	gstr3bCredit: z.number().int().nullable(),
	booksCredit: z.number().int(),
});
export type GstMonthCheck = z.infer<typeof GstMonthCheck>;

export const GstAnnual = z.object({
	gstin: z.string(),
	year: FinancialYear,
	rows: z.array(GstAnnualRow),
	months: z.array(GstMonthCheck),
	version: z.number().int().nonnegative(),
});
export type GstAnnual = z.infer<typeof GstAnnual>;

/** Why a GSTR-9 table differs from the books (G9's "Explained"). */
export const GstAnnualNoteWrite = z.object({
	gstRegistrationId: Id,
	year: FinancialYear,
	table: z.enum(['4', '5', '6', '7', '17']),
	note: z.string().trim().max(300),
	version: z.number().int().nonnegative(),
});
export type GstAnnualNoteWrite = z.infer<typeof GstAnnualNoteWrite>;
