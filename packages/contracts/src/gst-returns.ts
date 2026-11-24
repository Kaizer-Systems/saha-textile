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

export const GstReturnSummaryRow = z.object({
	table: z.string(),
	records: z.number().int().nonnegative(),
	taxable: z.number(),
	tax: z.number(),
});
export type GstReturnSummaryRow = z.infer<typeof GstReturnSummaryRow>;

export const GstReturnProblem = z.object({ table: z.string(), problem: z.string(), document: z.string() });
export type GstReturnProblem = z.infer<typeof GstReturnProblem>;

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
	version: z.number().int().nonnegative().default(0),
});
export type GstReturnDraft = z.infer<typeof GstReturnDraft>;

/** Prepare (or prepare again, before approval) a return from the books. */
export const GstReturnPrepare = z.object({ gstRegistrationId: Id, returnType: GstDraftType, month: YearMonth });
export type GstReturnPrepare = z.infer<typeof GstReturnPrepare>;

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
