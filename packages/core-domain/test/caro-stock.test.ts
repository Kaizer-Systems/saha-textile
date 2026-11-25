import { describe, expect, it } from 'vitest';

import { CARO_LINE_PERCENT, type CaroCountLine, caroClasses } from '../src/reports/caro-stock';

/**
 * CARO 2020 clause 3(ii)(a): physical verification of stock, with discrepancies of 10% or more in aggregate for a class
 * of inventory reported. Pieces and fabric by the metre (kept in tenths) are separate classes and never add together.
 */

const piece = (expected: number | null, counted: number | null, valueINR: number | null = null): CaroCountLine => ({
	soldBy: 'piece',
	expected,
	counted,
	valueINR,
});
const metre = (expected: number | null, counted: number | null, valueINR: number | null = null): CaroCountLine => ({
	soldBy: 'metre',
	expected,
	counted,
	valueINR,
});

describe('stock verification under CARO 3(ii)(a)', () => {
	it('draws the line at 10%', () => {
		expect(CARO_LINE_PERCENT).toBe(10);
	});

	it('reports pieces 10% short, and not metres 2.5% short, each class on its own', () => {
		expect(
			caroClasses([piece(60, 55, -1_250.5), metre(120, 117, -45), piece(40, 35, null), metre(80, 78, -30.25)]),
		).toEqual([
			{
				soldBy: 'piece',
				bookQty: 100,
				countedQty: 90,
				differenceQty: -10,
				percent: 10,
				differenceINR: -1_250.5,
				reportable: true,
			},
			{
				soldBy: 'metre',
				bookQty: 200,
				countedQty: 195,
				differenceQty: -5,
				percent: 2.5,
				differenceINR: -75.25,
				reportable: false,
			},
		]);
	});

	it('reports a surplus as well as a shortage', () => {
		expect(caroClasses([piece(100, 112, 3_600)])[0]).toMatchObject({
			differenceQty: 12,
			percent: 12,
			reportable: true,
		});
	});

	it('nets shortages against surpluses within a class', () => {
		expect(caroClasses([piece(50, 40), piece(50, 58)])[0]).toMatchObject({
			differenceQty: -2,
			percent: 2,
			reportable: false,
		});
	});

	it('keeps the share to one decimal, just under the line not reported', () => {
		expect(caroClasses([piece(3, 2)])[0]?.percent).toBe(33.3);
		expect(caroClasses([piece(1_000, 901)])[0]).toMatchObject({ percent: 9.9, reportable: false });
	});

	it('reports any difference where the books held nothing, with no share', () => {
		expect(caroClasses([piece(0, 3, 900)])).toEqual([
			{
				soldBy: 'piece',
				bookQty: 0,
				countedQty: 3,
				differenceQty: 3,
				percent: null,
				differenceINR: 900,
				reportable: true,
			},
		]);
		expect(caroClasses([metre(0, 0)])[0]).toMatchObject({ percent: null, reportable: false });
	});

	it('leaves out lines not counted or not in the books, and a class with none left', () => {
		expect(caroClasses([piece(10, null), piece(null, 4), metre(20, 20)])).toEqual([
			{
				soldBy: 'metre',
				bookQty: 20,
				countedQty: 20,
				differenceQty: 0,
				percent: 0,
				differenceINR: 0,
				reportable: false,
			},
		]);
		expect(caroClasses([])).toEqual([]);
	});

	it('adds the value of the difference to the paisa', () => {
		expect(caroClasses([piece(10, 9, 10.126), piece(10, 9, 0.004)])[0]?.differenceINR).toBe(10.13);
	});

	it('judges the 10% line on the share itself, not the share as rounded for the screen', () => {
		// 249 short of 2,500 is 9.96%: shown as 10.0, still under the line.
		expect(caroClasses([piece(2_500, 2_251)])[0]).toMatchObject({ percent: 10, reportable: false });
		expect(caroClasses([piece(2_500, 2_250)])[0]).toMatchObject({ percent: 10, reportable: true });
	});
});
