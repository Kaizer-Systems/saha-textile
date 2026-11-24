import { describe, expect, it } from 'vitest';

import { CaroClassRow, CaroStockReport } from '../src/reports';

/** CARO 2020 3(ii)(a): each posted count's discrepancy by class of stock, flagged at 10% or more. */

const accepted = (input: unknown) => expect(input).toBe(true);
const refused = (input: unknown) => expect(input).toBe(false);

const pieces = {
	soldBy: 'piece',
	bookQty: 100,
	countedQty: 90,
	differenceQty: -10,
	percent: 10,
	differenceINR: -1_250.5,
	reportable: true,
};

describe('a class of stock in a count', () => {
	it('keeps pieces or metres in whole units, the share to report against and the value of the difference', () => {
		expect(CaroClassRow.parse(pieces)).toEqual(pieces);
		accepted(CaroClassRow.safeParse({ ...pieces, soldBy: 'metre', bookQty: 0, percent: null }).success);
		refused(CaroClassRow.safeParse({ ...pieces, soldBy: 'kilo' }).success);
		refused(CaroClassRow.safeParse({ ...pieces, countedQty: 90.5 }).success);
		refused(CaroClassRow.safeParse({ ...pieces, reportable: undefined }).success);
	});
});

describe('the stock verification report', () => {
	it('lists each posted count in the period with its classes, and how many are reportable', () => {
		const report = {
			from: '2026-04-01',
			to: '2027-03-31',
			counts: [
				{
					id: 'sc_1',
					number: 'SC/26-27/0003',
					label: 'Year-end count, Kolkata',
					postedAt: '2027-03-31T12:00:00.000Z',
					classes: [pieces],
				},
			],
			reportable: 1,
		};
		expect(CaroStockReport.parse(report)).toEqual(report);
		accepted(CaroStockReport.safeParse({ ...report, counts: [], reportable: 0 }).success);
		refused(CaroStockReport.safeParse({ ...report, reportable: 0.5 }).success);
		refused(CaroStockReport.safeParse({ ...report, counts: [{ ...report.counts[0], id: '' }] }).success);
		refused(CaroStockReport.safeParse({ ...report, from: '1 Apr 2026' }).success);
	});
});
