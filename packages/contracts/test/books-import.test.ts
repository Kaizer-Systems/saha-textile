import { describe, expect, it } from 'vitest';

import {
	BooksExportFile,
	BooksExportFormat,
	BooksExportQuery,
	BooksImport,
	ImportBringIn,
	ImportInput,
	ImportMatchHow,
	ImportPreview,
	ImportRow,
	ImportSource,
	ImportStart,
} from '../src/books-import';

/** Bringing books in from another program (accounts brief I1, W1–W3) and taking them out (W4). */

const accepted = (input: unknown) => expect(input).toBe(true);
const refused = (input: unknown) => expect(input).toBe(false);

const input = { source: 'tally_xml', startOn: '2026-04-01', text: '<ENVELOPE></ENVELOPE>' };

describe('bringing books in', () => {
	it('reads Tally XML, our template, Zoho or Busy, from the year’s start or a day', () => {
		expect(ImportSource.options).toEqual(['tally_xml', 'template_csv', 'zoho_csv', 'busy_csv']);
		expect(ImportStart.options).toEqual(['year_start', 'date']);
		expect(ImportMatchHow.options).toEqual(['by_name', 'by_tax_head', 'party', 'new', 'choose']);
	});

	it('takes a file’s text, from the year’s start with no file name unless given', () => {
		expect(ImportInput.parse(input)).toEqual({ ...input, start: 'year_start', fileName: '' });
		expect(ImportInput.parse({ ...input, start: 'date', fileName: ' Master.xml ' })).toMatchObject({
			start: 'date',
			fileName: 'Master.xml',
		});
	});

	it('refuses an empty file, one over five million letters, a long name, an unknown source or a bad day', () => {
		refused(ImportInput.safeParse({ ...input, text: '' }).success);
		accepted(ImportInput.safeParse({ ...input, text: 'x'.repeat(5_000_000) }).success);
		refused(ImportInput.safeParse({ ...input, text: 'x'.repeat(5_000_001) }).success);
		refused(ImportInput.safeParse({ ...input, fileName: 'x'.repeat(201) }).success);
		refused(ImportInput.safeParse({ ...input, source: 'quickbooks' }).success);
		refused(ImportInput.safeParse({ ...input, start: 'today' }).success);
		refused(ImportInput.safeParse({ ...input, startOn: '01-04-2026' }).success);
	});

	it('previews each ledger with where it goes, and whether the books balance with nothing left to place', () => {
		const row = {
			name: 'Ravi & Sons',
			group: 'Sundry Debtors',
			primary: 'Sundry Debtors',
			openingPaise: 2_250_000,
			how: 'party',
			ledgerId: 'l_dc',
			groupKey: null,
		};
		expect(ImportRow.parse(row)).toEqual(row);
		accepted(ImportRow.safeParse({ ...row, primary: null, how: 'choose', ledgerId: null }).success);
		refused(ImportRow.safeParse({ ...row, how: 'guess' }).success);
		refused(ImportRow.safeParse({ ...row, openingPaise: 0.5 }).success);
		const preview = {
			rows: [row],
			matched: 1,
			toCheck: 0,
			debitPaise: 35_292_000,
			creditPaise: 35_292_000,
			balanced: true,
			toChoose: 0,
		};
		expect(ImportPreview.parse(preview)).toEqual(preview);
		refused(ImportPreview.safeParse({ ...preview, balanced: undefined }).success);
	});

	it('brings in at a location with the person’s choices, none by default, each to a ledger or a group', () => {
		const bringIn = { ...input, locationId: 'loc_kolkata' };
		expect(ImportBringIn.parse(bringIn)).toMatchObject({ locationId: 'loc_kolkata', choices: [] });
		expect(
			ImportBringIn.parse({
				...bringIn,
				choices: [{ name: 'Machinery' }, { name: 'Tea', groupKey: 'indirect_expenses' }],
			}).choices,
		).toEqual([
			{ name: 'Machinery', ledgerId: null, groupKey: null },
			{ name: 'Tea', ledgerId: null, groupKey: 'indirect_expenses' },
		]);
		accepted(
			ImportBringIn.safeParse({ ...bringIn, choices: Array.from({ length: 5_000 }, () => ({ name: 'x' })) })
				.success,
		);
		refused(
			ImportBringIn.safeParse({ ...bringIn, choices: Array.from({ length: 5_001 }, () => ({ name: 'x' })) })
				.success,
		);
		refused(ImportBringIn.safeParse(input).success);
	});

	it('keeps the import with its opening voucher and the ledgers it made, not undone until it is', () => {
		const made = {
			id: 'bi_1',
			source: 'tally_xml',
			fileName: 'Master.xml',
			startOn: '2026-04-01',
			locationId: 'loc_kolkata',
			voucherId: 'vch_opening',
			ledgersMade: ['l_hdfc', 'l_tea'],
			debitPaise: 35_292_000,
			createdBy: 'adm_1',
			createdAt: '2026-11-24T10:00:00.000Z',
		};
		expect(BooksImport.parse(made)).toEqual({ ...made, undoneAt: null, undoneBy: null });
		expect(BooksImport.parse({ ...made, undoneAt: '2026-11-24T11:00:00.000Z', undoneBy: 'adm_1' })).toMatchObject({
			undoneAt: '2026-11-24T11:00:00.000Z',
			undoneBy: 'adm_1',
		});
		refused(BooksImport.safeParse({ ...made, ledgersMade: [''] }).success);
	});
});

describe('taking books out', () => {
	it('exports Tally XML, the trial balance, ledger lines or the edit log, for a period, at a location or all', () => {
		expect(BooksExportFormat.options).toEqual([
			'tally_xml',
			'trial_balance_csv',
			'ledger_lines_csv',
			'edit_log_csv',
		]);
		const query = { format: 'trial_balance_csv', from: '2026-04-01', to: '2027-03-31' };
		expect(BooksExportQuery.parse(query)).toEqual(query);
		expect(BooksExportQuery.parse({ ...query, locationId: 'loc_kolkata' }).locationId).toBe('loc_kolkata');
		refused(BooksExportQuery.safeParse({ ...query, format: 'pdf' }).success);
		refused(BooksExportQuery.safeParse({ ...query, locationId: '' }).success);
		refused(BooksExportQuery.safeParse({ ...query, to: undefined }).success);
	});

	it('gives the file’s name and text', () => {
		const file = { fileName: 'trial-balance-2026-27.csv', text: 'Ledger,Group,Debit,Credit' };
		expect(BooksExportFile.parse(file)).toEqual(file);
		refused(BooksExportFile.safeParse({ text: 'x' }).success);
	});
});
