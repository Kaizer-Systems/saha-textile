import { z } from 'zod';

import { Id, IsoDateTime } from './common';
import { IsoDate } from './purchasing';

/** Bringing books in from another program (accounts brief I1, W1–W3) and taking them out (W4). */

export const ImportSource = z.enum(['tally_xml', 'template_csv', 'zoho_csv', 'busy_csv']);
export type ImportSource = z.infer<typeof ImportSource>;

export const ImportStart = z.enum(['year_start', 'date']);
export type ImportStart = z.infer<typeof ImportStart>;

/** W1: the file read, and the day the books start (balances are as at the day before). */
export const ImportInput = z.object({
	source: ImportSource,
	start: ImportStart.default('year_start'),
	startOn: IsoDate,
	fileName: z.string().trim().max(200).default(''),
	text: z.string().min(1).max(5_000_000),
});
export type ImportInput = z.infer<typeof ImportInput>;
export type ImportInputValue = z.input<typeof ImportInput>;

export const ImportMatchHow = z.enum(['by_name', 'by_tax_head', 'party', 'new', 'choose']);
export type ImportMatchHow = z.infer<typeof ImportMatchHow>;

export const ImportRow = z.object({
	name: z.string(),
	group: z.string(),
	primary: z.string().nullable(),
	openingPaise: z.number().int(),
	how: ImportMatchHow,
	ledgerId: Id.nullable(),
	groupKey: z.string().nullable(),
});
export type ImportRow = z.infer<typeof ImportRow>;

/** W2–W3: every ledger read with where it goes, and the checks before bringing in. */
export const ImportPreview = z.object({
	rows: z.array(ImportRow),
	matched: z.number().int(),
	toCheck: z.number().int(),
	debitPaise: z.number().int(),
	creditPaise: z.number().int(),
	balanced: z.boolean(),
	toChoose: z.number().int(),
});
export type ImportPreview = z.infer<typeof ImportPreview>;

/** W3 Bring in: the file again, the location the balances sit at, and the person's choices for some ledgers. */
export const ImportBringIn = ImportInput.extend({
	locationId: Id,
	choices: z
		.array(
			z.object({
				name: z.string(),
				ledgerId: Id.nullable().default(null),
				groupKey: z.string().nullable().default(null),
			}),
		)
		.max(5_000)
		.default([]),
});
export type ImportBringIn = z.infer<typeof ImportBringIn>;
export type ImportBringInValue = z.input<typeof ImportBringIn>;

export const BooksImport = z.object({
	id: Id,
	source: ImportSource,
	fileName: z.string(),
	startOn: IsoDate,
	locationId: Id,
	voucherId: Id,
	ledgersMade: z.array(Id),
	debitPaise: z.number().int(),
	createdBy: Id.nullable(),
	createdAt: IsoDateTime,
	undoneAt: IsoDateTime.nullable().default(null),
	undoneBy: Id.nullable().default(null),
});
export type BooksImport = z.infer<typeof BooksImport>;

/** W4: what to export. */
export const BooksExportFormat = z.enum(['tally_xml', 'trial_balance_csv', 'ledger_lines_csv', 'edit_log_csv']);
export type BooksExportFormat = z.infer<typeof BooksExportFormat>;

export const BooksExportQuery = z.object({
	format: BooksExportFormat,
	from: IsoDate,
	to: IsoDate,
	locationId: Id.optional(),
});
export type BooksExportQuery = z.infer<typeof BooksExportQuery>;

export const BooksExportFile = z.object({ fileName: z.string(), text: z.string() });
export type BooksExportFile = z.infer<typeof BooksExportFile>;
