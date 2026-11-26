import { describe, expect, it } from 'vitest';

import { StockCount, StockCountStart } from '../src/inventory';
import { CaroClassRow, CaroStockQuery, CaroStockReport } from '../src/reports';

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
		expect(CaroStockReport.parse(report)).toEqual({
			...report,
			locationId: null,
			counts: [{ ...report.counts[0], locationId: null }],
		});
		accepted(CaroStockReport.safeParse({ ...report, counts: [], reportable: 0 }).success);
		refused(CaroStockReport.safeParse({ ...report, reportable: 0.5 }).success);
		refused(CaroStockReport.safeParse({ ...report, counts: [{ ...report.counts[0], id: '' }] }).success);
		refused(CaroStockReport.safeParse({ ...report, from: '1 Apr 2026' }).success);
	});
});

describe('counts by location (brief 25 SC1, SC2)', () => {
	it('asks for the report over a period, for one location’s counts or every count', () => {
		const period = { from: '2026-04-01', to: '2027-03-31' };
		expect(CaroStockQuery.parse(period)).toEqual({ ...period, locationId: null });
		expect(CaroStockQuery.parse({ ...period, locationId: 'loc_warehouse' }).locationId).toBe('loc_warehouse');
		refused(CaroStockQuery.safeParse({ ...period, locationId: '' }).success);
		refused(CaroStockQuery.safeParse({ ...period, to: '31-03-2027' }).success);
		refused(CaroStockQuery.safeParse({ from: period.from }).success);
	});

	it('names the location a report and each of its counts are for, null for every location', () => {
		const count = {
			id: 'sc_2',
			number: 'SC/26-27/0004',
			label: 'Year-end count, warehouse',
			locationId: 'loc_warehouse',
			postedAt: '2027-03-31T12:00:00.000Z',
			classes: [pieces],
		};
		const report = {
			from: '2026-04-01',
			to: '2027-03-31',
			locationId: 'loc_warehouse',
			counts: [count],
			reportable: 1,
		};
		expect(CaroStockReport.parse(report)).toEqual(report);
		refused(CaroStockReport.safeParse({ ...report, counts: [{ ...count, locationId: '' }] }).success);
	});

	it('starts a count at a location, or every location as one when none is named', () => {
		const start = { scope: { kind: 'all' } };
		expect(StockCountStart.parse(start)).toEqual({
			scope: { kind: 'all', categoryIds: [], variantIds: [] },
			locationId: null,
			blind: true,
			counterIds: [],
			label: '',
		});
		expect(StockCountStart.parse({ ...start, locationId: 'loc_kolkata' }).locationId).toBe('loc_kolkata');
		refused(StockCountStart.safeParse({ ...start, locationId: '' }).success);
		// A count made before locations reads as every location.
		expect(StockCount.shape.locationId.parse(undefined)).toBeNull();
		expect(StockCount.shape.locationId.parse('loc_kolkata')).toBe('loc_kolkata');
	});
});
