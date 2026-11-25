import { z } from 'zod';

/**
 * Export any list or report (brief 25 EX1, EX2; approved 2026-11-25): the screen sends what it shows (every row its
 * filters match, the columns in view), and the API writes it as CSV, Excel or PDF. Money arrives in rupees as numbers,
 * dates as `YYYY-MM-DD`.
 */
export const ExportFormat = z.enum(['csv', 'xlsx', 'pdf']);
export type ExportFormat = z.infer<typeof ExportFormat>;

export const ExportColumn = z.object({
	key: z.string().min(1).max(60),
	label: z.string().max(120),
	kind: z.enum(['text', 'number', 'money', 'date']).default('text'),
});
export type ExportColumn = z.infer<typeof ExportColumn>;

const Cell = z.union([z.string().max(2000), z.number(), z.null()]);

export const ExportRequest = z.object({
	format: ExportFormat,
	title: z.string().trim().min(1).max(120),
	/** The file's name without its extension. */
	fileName: z.string().regex(/^[a-z0-9-]{1,80}$/),
	/** The filters the screen had, written above the table ("Period · 1 Apr 2026 to 31 Mar 2027"). */
	filters: z
		.array(z.object({ label: z.string().max(80), value: z.string().max(200) }))
		.max(20)
		.default([]),
	columns: z.array(ExportColumn).min(1).max(40),
	rows: z.array(z.record(z.string(), Cell)).max(20_000),
	/** A totals row, by column key, written last in bold. */
	totals: z.record(z.string(), Cell).nullable().default(null),
	/** Accounts exports are written to the edit log (who, what, which filters). */
	area: z.enum(['accounts', 'other']).default('other'),
});
export type ExportRequest = z.infer<typeof ExportRequest>;
export type ExportRequestInput = z.input<typeof ExportRequest>;
