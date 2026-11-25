import { describe, expect, it } from 'vitest';

import { isdBooksProblems, type Gstr6aLine } from '../src/gst/gst-schemes';

/** Brief 25 EB2: GSTR-6A's invoices must be expense bills booked to the ISD, with the same tax. */

const line = (patch: Partial<Gstr6aLine> = {}): Gstr6aLine => ({
	key: 'k1',
	kind: 'invoice',
	supplierGstin: '27aakfr1234m1z2',
	number: 'rent-1126',
	date: '2026-11-05',
	taxable: 100_000,
	igst: 0,
	cgst: 9_000,
	sgst: 9_000,
	...patch,
});
const bill = { supplierGstin: '27AAKFR1234M1Z2', billNumber: 'RENT/1126', igst: 0, cgst: 9_000, sgst: 9_000 };

describe('GSTR-6A against the books', () => {
	it('finds a bill by supplier GSTIN and bill number however they are written, within ₹1 a head', () => {
		expect(isdBooksProblems([line()], [bill])).toEqual([]);
		expect(isdBooksProblems([line({ cgst: 9_100, sgst: 8_900 })], [bill])).toEqual([]);
	});

	it('names a missing bill and one whose tax differs; credit notes are not looked for', () => {
		expect(
			isdBooksProblems(
				[line(), line({ key: 'k2', number: 'RENT-1226' }), line({ key: 'k3', kind: 'credit', number: 'CN-1' })],
				[{ ...bill, igst: 200 }],
			),
		).toEqual([
			{ table: 'isd', problem: 'isd_bill_tax_differs', document: '27aakfr1234m1z2 rent-1126' },
			{ table: 'isd', problem: 'isd_bill_not_in_books', document: '27aakfr1234m1z2 RENT-1226' },
		]);
	});
});
