import { z } from 'zod';

import { ReportPreview } from './accounts-templates';
import { Id, IsoDateTime } from './common';
import { IsoDate } from './purchasing';

/**
 * Reports (accounts brief U, V): the financial statements from the installed report layouts, by location, and the
 * custom report builder's definitions.
 */

export const StatementKind = z.enum(['balanceSheet', 'profitLoss']);
export type StatementKind = z.infer<typeof StatementKind>;

/** U2: a statement as at a day, at one location or every one the person may see. */
export const StatementQuery = z.object({ asAt: IsoDate.optional(), locationId: Id.optional() });
export type StatementQuery = z.infer<typeof StatementQuery>;

/** A statement from the installed layout for the kind of business, with the layout it came from. */
export const FinancialStatement = ReportPreview.extend({
	code: z.string(),
	name: z.string(),
	version: z.number().int(),
});
export type FinancialStatement = z.infer<typeof FinancialStatement>;

/** U3: profit and loss for a period, one column per location. */
export const PlByLocationQuery = z.object({ from: IsoDate, to: IsoDate });
export type PlByLocationQuery = z.infer<typeof PlByLocationQuery>;

export const PlByLocation = z.object({
	from: IsoDate,
	to: IsoDate,
	code: z.string(),
	name: z.string(),
	locations: z.array(z.object({ id: Id, name: z.string() })),
	rows: z.array(
		z.object({
			key: z.string(),
			label: z.string(),
			depth: z.number().int().nonnegative(),
			side: z.enum(['debit', 'credit']),
			/** Paise by location id. */
			byLocation: z.record(z.string(), z.number().int()),
			totalPaise: z.number().int(),
		}),
	),
	problems: z.array(z.string()),
});
export type PlByLocation = z.infer<typeof PlByLocation>;

/* V1, V2: the custom report builder. */

export const ReportDataset = z.enum(['ledgerLines', 'invoiceLines', 'invoices']);
export type ReportDataset = z.infer<typeof ReportDataset>;

export const ReportFieldType = z.enum(['text', 'number', 'money', 'date', 'percent']);
export type ReportFieldType = z.infer<typeof ReportFieldType>;

/** A field a kind of data offers (V1 "Columns"). */
export const ReportFieldInfo = z.object({ key: z.string(), type: ReportFieldType, summable: z.boolean() });
export type ReportFieldInfo = z.infer<typeof ReportFieldInfo>;

export const ReportCatalogue = z.record(ReportDataset, z.array(ReportFieldInfo));
export type ReportCatalogue = z.infer<typeof ReportCatalogue>;

const FieldKey = z.string().trim().min(1).max(40);

export const ReportFilter = z.object({
	field: FieldKey,
	op: z.enum(['is', 'isNot', 'in', 'contains', 'gt', 'lt', 'between']),
	values: z.array(z.string().max(80)).max(50),
});
export type ReportFilter = z.infer<typeof ReportFilter>;

/** What a report shows: the data, the columns, filters, groups, totals and sort (never the figures). */
export const ReportSpec = z.object({
	dataset: ReportDataset,
	columns: z.array(FieldKey).min(1).max(20),
	filters: z.array(ReportFilter).max(10).default([]),
	groupBy: z.array(FieldKey).max(3).default([]),
	totals: z.array(FieldKey).max(12).default([]),
	sort: z
		.object({ field: FieldKey, direction: z.enum(['asc', 'desc']) })
		.nullable()
		.default(null),
});
export type ReportSpec = z.infer<typeof ReportSpec>;
export type ReportSpecInput = z.input<typeof ReportSpec>;

/** Run a spec over a period: the preview shows the first 50 rows, a run up to 5,000. */
export const ReportRun = z.object({
	spec: ReportSpec,
	from: IsoDate,
	to: IsoDate,
	preview: z.boolean().default(false),
});
export type ReportRun = z.infer<typeof ReportRun>;
export type ReportRunInput = z.input<typeof ReportRun>;

export const ReportTable = z.object({
	columns: z.array(z.object({ key: z.string(), type: ReportFieldType })),
	rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
	totals: z.array(z.number().nullable()),
	count: z.number().int().nonnegative(),
	truncated: z.boolean(),
});
export type ReportTable = z.infer<typeof ReportTable>;

/** V2 Save as template: the choices, never the figures; who can open it; and whether the period moves. */
export const ReportDefinitionWrite = z.object({
	name: z.string().trim().min(1).max(80),
	folder: z.string().trim().min(1).max(60).default('Saved by you'),
	spec: ReportSpec,
	/** A moving period's preset (`this_month`), or null to keep the days saved. */
	periodPreset: z.string().trim().max(30).nullable().default(null),
	from: IsoDate,
	to: IsoDate,
	openTo: z.enum(['me', 'roles', 'all']).default('me'),
	roleIds: z.array(Id).max(20).default([]),
});
export type ReportDefinitionWrite = z.infer<typeof ReportDefinitionWrite>;
export type ReportDefinitionWriteInput = z.input<typeof ReportDefinitionWrite>;

export const ReportDefinition = ReportDefinitionWrite.extend({
	id: Id,
	createdBy: Id.nullable(),
	createdByName: z.string(),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
	version: z.number().int().nonnegative(),
});
export type ReportDefinition = z.infer<typeof ReportDefinition>;

export const ReportDefinitionEdit = ReportDefinitionWrite.extend({ version: z.number().int().nonnegative() });
export type ReportDefinitionEdit = z.infer<typeof ReportDefinitionEdit>;

/* U5: outstanding with ageing; U8: the audit report. */

export const AgeingSide = z.enum(['customers', 'suppliers']);
export type AgeingSide = z.infer<typeof AgeingSide>;

const Buckets = z.object({
	notDue: z.number().int(),
	days1to30: z.number().int(),
	days31to60: z.number().int(),
	days61to90: z.number().int(),
	over90: z.number().int(),
	total: z.number().int(),
});

export const OutstandingAgeing = z.object({
	side: AgeingSide,
	asAt: IsoDate,
	rows: z.array(Buckets.extend({ partyId: Id, name: z.string() })),
	totals: Buckets,
});
export type OutstandingAgeing = z.infer<typeof OutstandingAgeing>;

export const AuditChip = z.enum(['all', 'edits', 'backdated', 'cancelled', 'unlocks', 'takeovers', 'superAdmin']);
export type AuditChip = z.infer<typeof AuditChip>;

export const AuditReportQuery = z.object({
	from: IsoDate,
	to: IsoDate,
	chip: AuditChip.default('all'),
	q: z.string().trim().max(80).optional(),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(500).default(50),
});
export type AuditReportQuery = z.infer<typeof AuditReportQuery>;

export const AuditReportRow = z.object({
	id: Id,
	at: IsoDateTime,
	who: z.string(),
	action: z.string(),
	entityType: z.string().nullable(),
	entityId: z.string().nullable(),
	/** The fields changed, before and after, as one line. */
	detail: z.string(),
	categories: z.array(AuditChip.exclude(['all'])),
});
export type AuditReportRow = z.infer<typeof AuditReportRow>;

export const AuditReport = z.object({
	rows: z.array(AuditReportRow),
	total: z.number().int().nonnegative(),
	counts: z.record(AuditChip, z.number().int().nonnegative()),
});
export type AuditReport = z.infer<typeof AuditReport>;

/* Cash flow (indirect method) and ratios. */

export const PeriodQuery = z.object({ from: IsoDate, to: IsoDate });
export type PeriodQuery = z.infer<typeof PeriodQuery>;

export const CashFlow = z.object({
	from: IsoDate,
	to: IsoDate,
	lines: z.array(
		z.object({
			section: z.enum(['operating', 'investing', 'financing']),
			key: z.string(),
			paise: z.number().int(),
		}),
	),
	sections: z.object({ operating: z.number().int(), investing: z.number().int(), financing: z.number().int() }),
	netChange: z.number().int(),
	openingCash: z.number().int(),
	closingCash: z.number().int(),
});
export type CashFlow = z.infer<typeof CashFlow>;

export const Ratios = z.object({
	from: IsoDate,
	to: IsoDate,
	values: z.record(z.string(), z.number().nullable()),
});
export type Ratios = z.infer<typeof Ratios>;

/** CARO 2020 3(ii)(a): each posted count's discrepancy by class of stock, flagged at 10% or more. */
export const CaroClassRow = z.object({
	soldBy: z.enum(['piece', 'metre']),
	bookQty: z.number().int(),
	countedQty: z.number().int(),
	differenceQty: z.number().int(),
	percent: z.number().nullable(),
	differenceINR: z.number(),
	reportable: z.boolean(),
});
export type CaroClassRow = z.infer<typeof CaroClassRow>;

/** Brief 25 SC2: the CARO report for a period, for one location's counts or every count. */
export const CaroStockQuery = z.object({
	from: IsoDate,
	to: IsoDate,
	locationId: Id.nullable().default(null),
});
export type CaroStockQuery = z.infer<typeof CaroStockQuery>;

export const CaroStockReport = z.object({
	from: IsoDate,
	to: IsoDate,
	locationId: Id.nullable().default(null),
	counts: z.array(
		z.object({
			id: Id,
			number: z.string(),
			label: z.string(),
			/** The location counted; null for a count of every location. */
			locationId: Id.nullable().default(null),
			postedAt: IsoDateTime,
			classes: z.array(CaroClassRow),
		}),
	),
	reportable: z.number().int(),
});
export type CaroStockReport = z.infer<typeof CaroStockReport>;
