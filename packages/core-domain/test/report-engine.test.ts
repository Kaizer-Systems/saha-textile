import { describe, expect, it } from 'vitest';

import {
	REPORT_DATASETS,
	type ReportRow,
	type ReportSpecLike,
	runReport,
	specProblems,
} from '../src/reports/report-engine';

/** The custom report builder's engine (accounts brief V1): fields, the spec's checks, filters, groups, sort, totals. */

const spec = (over: Partial<ReportSpecLike> = {}): ReportSpecLike => ({
	columns: ['document'],
	filters: [],
	groupBy: [],
	totals: [],
	sort: null,
	...over,
});

/** Four invoices in paise: two in Kolkata in November, one in Barasat, one in Kolkata in December. */
const invoice = (over: Record<string, string | number | null>): ReportRow => ({
	date: '2026-11-03',
	month: '2026-11',
	documentKind: 'taxInvoice',
	gstin: '19DBYPS6736R1ZZ',
	location: 'Kolkata',
	buyerGstin: null,
	order: 'ST-2611-000001',
	...over,
});
const invoices: ReportRow[] = [
	invoice({
		document: 'TI/1',
		buyer: 'Rang Textiles',
		state: 'Maharashtra',
		taxable: 100_000,
		tax: 5_000,
		total: 105_000,
		cost: 60_000,
		margin: 40_000,
	}),
	invoice({
		document: 'TI/2',
		date: '2026-11-10',
		location: 'Barasat',
		buyer: 'Ananya Sen',
		state: 'West Bengal',
		taxable: 200_000,
		tax: 10_000,
		total: 210_000,
		cost: 150_000,
		margin: 50_000,
	}),
	invoice({
		document: 'TI/3',
		date: '2026-11-20',
		buyer: 'ananya sen',
		state: 'West Bengal',
		taxable: 0,
		tax: 0,
		total: 0,
		cost: 0,
		margin: 0,
	}),
	invoice({
		document: 'TI/4',
		date: '2026-12-01',
		month: '2026-12',
		buyer: 'Boutique Nila',
		state: 'Maharashtra',
		taxable: 300_000,
		tax: 15_000,
		total: 315_000,
		cost: 300_000,
		margin: 0,
	}),
];
const documents = (table: { rows: unknown[][] }) => table.rows.map((r) => r[0]);
const filtered = (filters: ReportSpecLike['filters']) =>
	documents(runReport('invoices', invoices, spec({ filters }), 100));

describe('the kinds of data and their fields', () => {
	const shape = (key: keyof typeof REPORT_DATASETS) =>
		REPORT_DATASETS[key].map((f) => `${f.key}:${f.type}${f.summable ? '+' : ''}${f.derived ? '=' : ''}`);

	it('offers the ledger’s lines, with debit, credit and net added up', () => {
		expect(shape('ledgerLines')).toEqual([
			'date:date',
			'month:text',
			'voucher:text',
			'voucherKind:text',
			'source:text',
			'ledger:text',
			'group:text',
			'location:text',
			'narration:text',
			'debit:money+',
			'credit:money+',
			'net:money+',
		]);
	});

	it('offers invoice lines, with quantity, rate and the money added up', () => {
		expect(shape('invoiceLines')).toEqual([
			'date:date',
			'month:text',
			'document:text',
			'documentKind:text',
			'gstin:text',
			'location:text',
			'buyer:text',
			'buyerGstin:text',
			'state:text',
			'product:text',
			'sku:text',
			'hsn:text',
			'unit:text',
			'quantity:number+',
			'ratePercent:number+',
			'taxable:money+',
			'cgst:money+',
			'sgst:money+',
			'igst:money+',
			'tax:money+',
			'total:money+',
		]);
	});

	it('offers invoices with their cost and margin, and the margin as a share of the taxable value', () => {
		expect(shape('invoices')).toEqual([
			'date:date',
			'month:text',
			'document:text',
			'documentKind:text',
			'gstin:text',
			'location:text',
			'buyer:text',
			'buyerGstin:text',
			'state:text',
			'order:text',
			'taxable:money+',
			'tax:money+',
			'total:money+',
			'cost:money+',
			'margin:money+',
			'marginPercent:percent=',
		]);
	});

	it('works the margin out to one decimal, and leaves it empty without a taxable value', () => {
		const marginPercent = REPORT_DATASETS.invoices.find((f) => f.key === 'marginPercent')?.derived;
		expect(marginPercent?.from).toEqual(['margin', 'taxable']);
		expect(marginPercent?.value({ margin: 40_000, taxable: 100_000 })).toBe(40);
		expect(marginPercent?.value({ margin: 1, taxable: 3 })).toBe(33.3);
		expect(marginPercent?.value({ margin: -1, taxable: 3 })).toBe(-33.3);
		expect(marginPercent?.value({ margin: 40_000, taxable: 0 })).toBeNull();
		expect(marginPercent?.value({ margin: null, taxable: 100 })).toBeNull();
		expect(marginPercent?.value({ margin: 40, taxable: '100' })).toBeNull();
	});
});

describe('the spec’s checks', () => {
	it('names each field the data doesn’t have once, wherever it appears, then each total that can’t be added up', () => {
		expect(
			specProblems(
				'invoices',
				spec({
					columns: ['document', 'colour'],
					filters: [{ field: 'weight', op: 'gt', values: ['1'] }],
					groupBy: ['region', 'colour'],
					totals: ['buyer', 'discount', 'taxable'],
					sort: { field: 'rank', direction: 'asc' },
				}),
			),
		).toEqual([
			'report_field_unknown:colour',
			'report_field_unknown:weight',
			'report_field_unknown:region',
			'report_field_unknown:discount',
			'report_field_unknown:rank',
			'report_total_not_summable:buyer',
		]);
	});

	it('passes a spec of known fields, and refuses a worked-out field as a total', () => {
		expect(specProblems('invoices', spec({ columns: ['document', 'taxable'], totals: ['taxable'] }))).toEqual([]);
		expect(specProblems('invoices', spec({ totals: ['marginPercent'] }))).toEqual([
			'report_total_not_summable:marginPercent',
		]);
		expect(specProblems('ledgerLines', spec({ columns: ['document'] }))).toEqual(['report_field_unknown:document']);
	});

	it('refuses to run a spec with a problem, naming the first', () => {
		expect(() => runReport('invoices', invoices, spec({ columns: ['colour'], totals: ['buyer'] }), 10)).toThrow(
			'report_field_unknown:colour',
		);
	});
});

describe('filters', () => {
	it('compares text whatever its case: is, is not, any of, contains', () => {
		expect(filtered([{ field: 'buyer', op: 'is', values: ['ANANYA SEN'] }])).toEqual(['TI/2', 'TI/3']);
		expect(filtered([{ field: 'location', op: 'isNot', values: ['kolkata'] }])).toEqual(['TI/2']);
		expect(filtered([{ field: 'state', op: 'in', values: ['west bengal', 'Goa'] }])).toEqual(['TI/2', 'TI/3']);
		expect(filtered([{ field: 'buyer', op: 'contains', values: ['NILA'] }])).toEqual(['TI/4']);
		expect(filtered([{ field: 'buyer', op: 'contains', values: [] }])).toEqual(['TI/1', 'TI/2', 'TI/3', 'TI/4']);
	});

	it('finds nothing in an empty value or a number with contains', () => {
		expect(filtered([{ field: 'buyerGstin', op: 'contains', values: [''] }])).toEqual([]);
		expect(filtered([{ field: 'taxable', op: 'contains', values: ['1'] }])).toEqual([]);
		expect(filtered([{ field: 'buyerGstin', op: 'is', values: [] }])).toEqual([]);
		expect(filtered([{ field: 'buyerGstin', op: 'isNot', values: ['x'] }])).toEqual([
			'TI/1',
			'TI/2',
			'TI/3',
			'TI/4',
		]);
	});

	it('compares days as written, on, after and between', () => {
		expect(filtered([{ field: 'date', op: 'is', values: ['2026-11-10'] }])).toEqual(['TI/2']);
		expect(filtered([{ field: 'date', op: 'gt', values: ['2026-11-15'] }])).toEqual(['TI/3', 'TI/4']);
		expect(filtered([{ field: 'date', op: 'lt', values: ['2026-11-10'] }])).toEqual(['TI/1']);
		expect(filtered([{ field: 'date', op: 'between', values: ['2026-11-01', '2026-11-30'] }])).toEqual([
			'TI/1',
			'TI/2',
			'TI/3',
		]);
	});

	it('reads money typed in rupees against the paise kept', () => {
		expect(filtered([{ field: 'taxable', op: 'is', values: ['1000'] }])).toEqual(['TI/1']);
		expect(filtered([{ field: 'taxable', op: 'gt', values: ['1000'] }])).toEqual(['TI/2', 'TI/4']);
		expect(filtered([{ field: 'taxable', op: 'lt', values: ['999.99'] }])).toEqual(['TI/3']);
		expect(filtered([{ field: 'taxable', op: 'between', values: ['1000', '2000'] }])).toEqual(['TI/1', 'TI/2']);
		expect(filtered([{ field: 'total', op: 'in', values: ['1050', '2100.00'] }])).toEqual(['TI/1', 'TI/2']);
	});

	it('compares numbers and percents, never passing an empty value, and needs both ends of a between', () => {
		const lines: ReportRow[] = [
			{ document: 'a', quantity: 3, ratePercent: 5 },
			{ document: 'b', quantity: '12', ratePercent: 18 },
			{ document: 'c', quantity: null, ratePercent: null },
		];
		const run = (filters: ReportSpecLike['filters']) =>
			documents(runReport('invoiceLines', lines, spec({ filters }), 10));
		expect(run([{ field: 'quantity', op: 'gt', values: ['3'] }])).toEqual(['b']);
		expect(run([{ field: 'quantity', op: 'lt', values: ['12'] }])).toEqual(['a']);
		expect(run([{ field: 'ratePercent', op: 'between', values: ['5', '12'] }])).toEqual(['a']);
		expect(run([{ field: 'ratePercent', op: 'between', values: ['5'] }])).toEqual([]);
		expect(run([{ field: 'quantity', op: 'gt', values: [] }])).toEqual([]);
		expect(run([{ field: 'quantity', op: 'lt', values: [] }])).toEqual([]);
		expect(run([{ field: 'quantity', op: 'between', values: [] }])).toEqual([]);
		expect(run([{ field: 'quantity', op: 'is', values: ['12'] }])).toEqual(['b']);
		// Rows that carry the margin as a percent are filtered on it.
		const withPercent: ReportRow[] = [
			{ document: 'x', taxable: 100, margin: 40, marginPercent: 40 },
			{ document: 'y', taxable: 100, margin: 20, marginPercent: 20 },
		];
		expect(
			documents(
				runReport(
					'invoices',
					withPercent,
					spec({ filters: [{ field: 'marginPercent', op: 'gt', values: ['30'] }] }),
					10,
				),
			),
		).toEqual(['x']);
	});

	it('keeps only the rows that pass every filter', () => {
		expect(
			filtered([
				{ field: 'location', op: 'is', values: ['Kolkata'] },
				{ field: 'taxable', op: 'gt', values: ['0'] },
			]),
		).toEqual(['TI/1', 'TI/4']);
	});
});

describe('rows and groups', () => {
	it('shows each row in its columns, the margin worked out per row, a missing value as empty', () => {
		const table = runReport(
			'invoices',
			invoices,
			spec({ columns: ['document', 'buyer', 'order', 'marginPercent'] }),
			100,
		);
		expect(table.columns).toEqual([
			{ key: 'document', type: 'text' },
			{ key: 'buyer', type: 'text' },
			{ key: 'order', type: 'text' },
			{ key: 'marginPercent', type: 'percent' },
		]);
		expect(table.rows).toEqual([
			['TI/1', 'Rang Textiles', 'ST-2611-000001', 40],
			['TI/2', 'Ananya Sen', 'ST-2611-000001', 25],
			['TI/3', 'ananya sen', 'ST-2611-000001', null],
			['TI/4', 'Boutique Nila', 'ST-2611-000001', 0],
		]);
		expect(runReport('ledgerLines', [{}], spec({ columns: ['ledger', 'debit'] }), 10).rows).toEqual([[null, null]]);
	});

	it('makes one row per group, with only the columns that can be added up or worked out, the margin from the sums', () => {
		const table = runReport(
			'invoices',
			invoices,
			spec({ columns: ['buyer', 'location', 'taxable', 'margin', 'marginPercent'], groupBy: ['location'] }),
			100,
		);
		expect(table.columns.map((c) => c.key)).toEqual(['location', 'taxable', 'margin', 'marginPercent']);
		// Sorted by the group: Barasat before Kolkata.
		expect(table.rows).toEqual([
			['Barasat', 200_000, 50_000, 25],
			['Kolkata', 400_000, 40_000, 10],
		]);
		expect(table.totals).toEqual([null, 600_000, 90_000, 15]);
		expect(table.count).toBe(2);
	});

	it('adds up what a worked-out column needs even when its inputs are not shown', () => {
		const table = runReport(
			'invoices',
			invoices,
			spec({ columns: ['month', 'marginPercent'], groupBy: ['month'] }),
			10,
		);
		expect(table.rows).toEqual([
			['2026-11', 30],
			['2026-12', 0],
		]);
		expect(table.totals).toEqual([null, 15]);
	});

	it('groups on two fields, an empty value a group of its own', () => {
		const ledger: ReportRow[] = [
			{ ledger: 'Sales', location: 'Kolkata', debit: 0, credit: 100_000 },
			{ ledger: 'Sales', location: null, debit: 0, credit: 20_000 },
			{ ledger: 'Sales', location: 'Kolkata', debit: 5_000, credit: 50_000 },
			{ ledger: 'Cash', location: 'Kolkata', debit: 155_000 },
		];
		const table = runReport(
			'ledgerLines',
			ledger,
			spec({ columns: ['ledger', 'location', 'debit', 'credit'], groupBy: ['ledger', 'location'] }),
			10,
		);
		expect(table.rows).toEqual([
			['Cash', 'Kolkata', 155_000, 0],
			['Sales', 'Kolkata', 5_000, 150_000],
			['Sales', null, 0, 20_000],
		]);
		expect(table.totals).toEqual([null, null, 160_000, 170_000]);
	});
});

describe('sorting', () => {
	// A row with no buyer or taxable value and no state at all, read first or last: it always sorts last.
	const empty = invoice({ document: 'TI/5', buyer: null, taxable: null });
	const sorted = (field: string, direction: 'asc' | 'desc', rows: readonly ReportRow[]) =>
		documents(runReport('invoices', rows, spec({ sort: { field, direction } }), 10));

	it('sorts money high to low or low to high, empty values last either way', () => {
		for (const rows of [
			[empty, ...invoices],
			[...invoices, empty],
		]) {
			expect(sorted('taxable', 'desc', rows)).toEqual(['TI/4', 'TI/2', 'TI/1', 'TI/3', 'TI/5']);
			expect(sorted('taxable', 'asc', rows)).toEqual(['TI/3', 'TI/1', 'TI/2', 'TI/4', 'TI/5']);
		}
	});

	it('sorts text whatever its case, keeping equal values in their order', () => {
		for (const rows of [
			[empty, ...invoices],
			[...invoices, empty],
		]) {
			expect(sorted('state', 'asc', rows)).toEqual(['TI/1', 'TI/4', 'TI/2', 'TI/3', 'TI/5']);
			expect(sorted('buyer', 'desc', rows)).toEqual(['TI/1', 'TI/4', 'TI/2', 'TI/3', 'TI/5']);
		}
	});

	it('keeps the rows as read without a sort or a group', () => {
		expect(documents(runReport('invoices', [...invoices].reverse(), spec(), 10))).toEqual([
			'TI/4',
			'TI/3',
			'TI/2',
			'TI/1',
		]);
	});

	it('sorts by the sort rather than the group', () => {
		const table = runReport(
			'invoices',
			invoices,
			spec({
				columns: ['location', 'taxable'],
				groupBy: ['location'],
				sort: { field: 'taxable', direction: 'desc' },
			}),
			10,
		);
		expect(table.rows.map((r) => r[0])).toEqual(['Kolkata', 'Barasat']);
	});
});

describe('totals and the limit', () => {
	it('adds up only the columns asked for, and still works out the margin from the totals', () => {
		const table = runReport(
			'invoices',
			invoices,
			spec({ columns: ['document', 'taxable', 'total', 'marginPercent'], totals: ['taxable', 'margin'] }),
			10,
		);
		expect(table.totals).toEqual([null, 600_000, null, 15]);
	});

	it('adds up every column that can be added when none is asked for, over every row, not only those shown', () => {
		const table = runReport('invoices', invoices, spec({ columns: ['document', 'taxable', 'tax', 'buyer'] }), 2);
		expect(table.rows).toEqual([
			['TI/1', 100_000, 5_000, 'Rang Textiles'],
			['TI/2', 200_000, 10_000, 'Ananya Sen'],
		]);
		expect(table.totals).toEqual([null, 600_000, 30_000, null]);
		expect(table).toMatchObject({ count: 4, truncated: true });
	});

	it('is not cut when the rows fit the limit', () => {
		expect(runReport('invoices', invoices, spec(), 4)).toMatchObject({ count: 4, truncated: false });
		expect(runReport('invoices', [], spec({ columns: ['taxable'] }), 4)).toEqual({
			columns: [{ key: 'taxable', type: 'money' }],
			rows: [],
			totals: [0],
			count: 0,
			truncated: false,
		});
	});
});
