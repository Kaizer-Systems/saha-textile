import { describe, expect, it } from 'vitest';

import {
	GSTR1_EXPORT_TABLES,
	GSTR1_SUPPLY_TABLES,
	annualRows,
	fyMonths,
	hsnCodes,
	isFinancialYear,
	tablesTotal,
	type AnnualInput,
	type SummaryRow,
} from '../src/gst/gst-annual';

/**
 * GSTR-9 against the books (accounts brief G9): the year's filed GSTR-1 and GSTR-3B beside the same figures from the
 * books. Table 4 taxable outward supplies, 5 exports, 6 credit claimed (6A, the sum of GSTR-3B's 4A), 7 credit
 * reversed (GSTR-3B's 4B), 17 the HSN codes sold.
 */

const row = (table: string, taxable: number, tax = 0): SummaryRow => ({ table, taxable, tax });
const hsnFile = (b2b: string[], b2c: string[]) => ({
	hsn: { hsn_b2b: b2b.map((hsn_sc) => ({ hsn_sc })), hsn_b2c: b2c.map((hsn_sc) => ({ hsn_sc })) },
});
/** Exports under a LUT (table 6A, WOPAY) worth these taxable values. */
const lutExports = (...txval: number[]) => ({
	exp: [{ exp_typ: 'WOPAY', inv: txval.map((value) => ({ itms: [{ txval: value, rt: 0, iamt: 0 }] })) }],
});

describe('the financial year', () => {
	it('runs April to March', () => {
		expect(fyMonths('2025-26')).toEqual([
			'2025-04',
			'2025-05',
			'2025-06',
			'2025-07',
			'2025-08',
			'2025-09',
			'2025-10',
			'2025-11',
			'2025-12',
			'2026-01',
			'2026-02',
			'2026-03',
		]);
		expect(fyMonths('2099-00').slice(-4)).toEqual(['2099-12', '2100-01', '2100-02', '2100-03']);
	});

	it('is written YYYY-YY with the second year following the first, across a century too', () => {
		expect(isFinancialYear('2025-26')).toBe(true);
		expect(isFinancialYear('2099-00')).toBe(true);
		expect(isFinancialYear('2025-27')).toBe(false);
		expect(isFinancialYear('2025-25')).toBe(false);
		expect(isFinancialYear('2025-6')).toBe(false);
		expect(isFinancialYear('2025-2026')).toBe(false);
		expect(isFinancialYear('abcd-ef')).toBe(false);
	});
});

describe('a return’s tables', () => {
	it('adds the taxable value and tax of the tables asked for, in paise', () => {
		const summary = [
			row('4A', 6_088.98, 706.02),
			row('5', 200_000, 10_000),
			row('9B', -52_900, -2_495),
			row('12', 1, 1),
		];
		expect(tablesTotal(summary, ['4A', '5', '9B'])).toEqual({ taxable: 15_318_898, tax: 821_102 });
		expect(tablesTotal(summary, ['6A'])).toEqual({ taxable: 0, tax: 0 });
		expect(tablesTotal([], GSTR1_SUPPLY_TABLES)).toEqual({ taxable: 0, tax: 0 });
	});

	it('takes supplies from GSTR-1’s B2B, B2C large, B2C others and notes, and exports from 6A', () => {
		expect(GSTR1_SUPPLY_TABLES).toEqual(['4A', '5', '7', '9B']);
		expect(GSTR1_EXPORT_TABLES).toEqual(['6A']);
	});
});

describe('the HSN codes sold', () => {
	it('lists each code once, to registered and unregistered buyers alike', () => {
		expect([...hsnCodes(hsnFile(['50072010', '62114290', '996812'], ['50072010', '996812']))]).toEqual([
			'50072010',
			'62114290',
			'996812',
		]);
	});

	it('reads past rows without a code, parts that are not lists and a file without table 12', () => {
		expect([
			...hsnCodes({
				hsn: { hsn_b2b: [{ hsn_sc: 996812 }, 'x', null, { hsn_sc: '5208' }, {}], hsn_b2c: { hsn_sc: '5007' } },
			}),
		]).toEqual(['5208']);
		expect(hsnCodes({}).size).toBe(0);
		expect(hsnCodes({ hsn: [{ hsn_sc: '5007' }] }).size).toBe(0);
		expect(hsnCodes({ hsn: null }).size).toBe(0);
	});
});

describe('GSTR-9 against the books', () => {
	const input: AnnualInput = {
		gstr1: [
			{
				summary: [
					row('4A', 6_088.98, 706.02),
					row('5', 200_000, 10_000),
					row('6A', 6_000),
					row('7', 95_738.1, 4_786.9),
					row('9B', -52_900, -2_495),
					row('12', 254_927.08, 12_997.92),
					row('13', 0),
				],
				portal: {
					...hsnFile(['50072010', '62114290', '996812'], ['50072010', '996812']),
					...lutExports(6_000),
				},
			},
			{
				summary: [row('4A', 1_000, 50), row('7', 500.5, 25), row('6A', 300)],
				portal: { ...hsnFile([], ['62114290', '5208']), ...lutExports(300) },
			},
		],
		gstr3b: [
			{
				summary: [
					row('3.1a', 399_827.08, 20_392.92),
					row('4A', 0, 21_230),
					row('4B', 0, 400),
					row('4C', 0, 20_830),
				],
			},
			{ summary: [row('4A', 0, 100.5), row('4B', 0, 0)] },
		],
		books: {
			summary: [
				row('4A', 7_088.98),
				row('5', 200_000),
				row('6A', 6_300),
				row('7', 96_238.6),
				row('9B', -52_900),
				row('12', 1),
			],
			portal: { ...hsnFile(['50072010', '62114290', '996812'], []), ...lutExports(6_000, 300) },
			inputCredit: 2_133_050,
			reversed: 45_000,
		},
	};

	it('sets the year’s filed returns beside the books, table by table', () => {
		expect(annualRows(input)).toEqual([
			// ₹6,088.98 + ₹2,00,000 + ₹95,738.10 − ₹52,900 + ₹1,000 + ₹500.50.
			{ table: '4', returns: 25_042_758, books: 25_042_758, unit: 'paise' },
			{ table: '5', returns: 630_000, books: 630_000, unit: 'paise' },
			{ table: '6', returns: 2_133_050, books: 2_133_050, unit: 'paise' },
			// The books took back ₹50 more than the returns did.
			{ table: '7', returns: 40_000, books: 45_000, unit: 'paise' },
			// 5208 was filed in the second month but is not in the books’ year.
			{ table: '17', returns: 4, books: 3, unit: 'count' },
		]);
	});

	it('reads a year with nothing filed and nothing in the books as nothing', () => {
		expect(
			annualRows({ gstr1: [], gstr3b: [], books: { summary: [], portal: {}, inputCredit: 0, reversed: 0 } }),
		).toEqual([
			{ table: '4', returns: 0, books: 0, unit: 'paise' },
			{ table: '5', returns: 0, books: 0, unit: 'paise' },
			{ table: '6', returns: 0, books: 0, unit: 'paise' },
			{ table: '7', returns: 0, books: 0, unit: 'paise' },
			{ table: '17', returns: 0, books: 0, unit: 'count' },
		]);
	});
});
