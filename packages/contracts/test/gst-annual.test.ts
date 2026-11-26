import { describe, expect, it } from 'vitest';

import {
	FinancialYear,
	GstAnnual,
	GstAnnualNoteWrite,
	GstAnnualQuery,
	GstAnnualRow,
	GstMonthCheck,
} from '../src/gst-returns';

/** GSTR-9 against the books and the monthly books-to-returns check (accounts brief G9, G7): what the screens send. */

const accepted = (input: unknown) => expect(input).toBe(true);
const refused = (input: unknown) => expect(input).toBe(false);
const message = (result: { error?: { issues: { message: string }[] } }) => result.error?.issues[0]?.message;

const annualRow = { table: '4', returns: 25_042_758, books: 25_042_758, unit: 'paise', note: '' };
const monthCheck = {
	month: '2026-04',
	gstr1Tax: 1_250_000,
	gstr3bTax: 1_250_000,
	booksTax: 1_250_000,
	gstr3bCredit: 980_000,
	booksCredit: 980_000,
};

describe('a financial year', () => {
	it('is YYYY-YY with the second year following the first, across a century too', () => {
		accepted(FinancialYear.safeParse('2025-26').success);
		accepted(FinancialYear.safeParse('2099-00').success);
		for (const year of ['2025-27', '2025-6', 'abcd-ef', '2025-2026', '2025/26'])
			expect(message(FinancialYear.safeParse(year))).toBe('year_shape');
	});
});

describe('GSTR-9 against the books', () => {
	it('opens a registration’s year', () => {
		const query = { gstRegistrationId: 'gst_wb', year: '2025-26' };
		expect(GstAnnualQuery.parse(query)).toEqual(query);
		refused(GstAnnualQuery.safeParse({ ...query, year: '2025-27' }).success);
		refused(GstAnnualQuery.safeParse({ ...query, gstRegistrationId: '' }).success);
	});

	it('shows tables 4, 5, 6, 7 and 17, in paise or a count of codes, signed, with the accountant’s note', () => {
		expect(GstAnnualRow.parse(annualRow)).toEqual(annualRow);
		for (const table of ['5', '6', '7', '17']) accepted(GstAnnualRow.safeParse({ ...annualRow, table }).success);
		accepted(GstAnnualRow.safeParse({ ...annualRow, table: '17', returns: 4, books: 3, unit: 'count' }).success);
		accepted(GstAnnualRow.safeParse({ ...annualRow, returns: -500 }).success);
		refused(GstAnnualRow.safeParse({ ...annualRow, table: '9' }).success);
		refused(GstAnnualRow.safeParse({ ...annualRow, unit: 'rupees' }).success);
		refused(GstAnnualRow.safeParse({ ...annualRow, books: 0.5 }).success);
		refused(GstAnnualRow.safeParse({ ...annualRow, note: undefined }).success);
	});

	it('checks each month’s returns against the books, a return not filed yet as none', () => {
		expect(GstMonthCheck.parse(monthCheck)).toEqual(monthCheck);
		const unfiled = { ...monthCheck, gstr1Tax: null, gstr3bTax: null, gstr3bCredit: null };
		expect(GstMonthCheck.parse(unfiled)).toEqual(unfiled);
		refused(GstMonthCheck.safeParse({ ...monthCheck, booksTax: null }).success);
		refused(GstMonthCheck.safeParse({ ...monthCheck, booksCredit: null }).success);
		refused(GstMonthCheck.safeParse({ ...monthCheck, gstr1Tax: 1.5 }).success);
		refused(GstMonthCheck.safeParse({ ...monthCheck, month: '2026-4' }).success);
	});

	it('gives the year’s rows and months at a version', () => {
		const annual = {
			gstin: '19DBYPS6736R1ZZ',
			year: '2025-26',
			rows: [annualRow],
			months: [monthCheck],
			version: 2,
		};
		expect(GstAnnual.parse(annual)).toEqual(annual);
		refused(GstAnnual.safeParse({ ...annual, year: '2025' }).success);
		refused(GstAnnual.safeParse({ ...annual, version: -1 }).success);
	});

	it('keeps a note on why a table differs, trimmed, up to 300 letters, or none', () => {
		const note = {
			gstRegistrationId: 'gst_wb',
			year: '2025-26',
			table: '7',
			note: '  Loss written off in March ',
			version: 2,
		};
		expect(GstAnnualNoteWrite.parse(note).note).toBe('Loss written off in March');
		expect(GstAnnualNoteWrite.parse({ ...note, note: '   ' }).note).toBe('');
		accepted(GstAnnualNoteWrite.safeParse({ ...note, note: 'x'.repeat(300) }).success);
		refused(GstAnnualNoteWrite.safeParse({ ...note, note: 'x'.repeat(301) }).success);
		refused(GstAnnualNoteWrite.safeParse({ ...note, table: '8' }).success);
		refused(GstAnnualNoteWrite.safeParse({ ...note, year: '2025-27' }).success);
		refused(GstAnnualNoteWrite.safeParse({ ...note, version: 1.5 }).success);
	});
});
