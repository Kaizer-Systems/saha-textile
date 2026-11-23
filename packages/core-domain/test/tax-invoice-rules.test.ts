import { describe, expect, it } from 'vitest';

import { buildInvoiceLines, gstRateFor, invoicePosting } from '../src/invoicing/tax-invoice-rules';

describe('tax invoices (accounts brief D1, D3; today’s rates until the CA confirms)', () => {
	it('gives today’s rate by HSN chapter and the ₹2,500 garment band', () => {
		expect(gstRateFor('5007', 36_500)).toBe(5); // silk saree fabric
		expect(gstRateFor('62114200', 2_500)).toBe(5);
		expect(gstRateFor('62114200', 2_501)).toBe(18);
		expect(gstRateFor('7113', 500)).toBeNull();
		expect(gstRateFor(null, 500)).toBeNull();
		expect(gstRateFor('50', 500)).toBeNull();
	});

	it('takes tax out of tax-included prices, split CGST and SGST within the State', () => {
		const built = buildInvoiceLines(
			[
				{
					lineId: 'a',
					sku: 'KAT-1',
					title: 'Saree',
					hsn: '5007',
					quantity: 1,
					unit: 'PCS',
					lineTotalINR: 36_500,
				},
			],
			{ interState: false, shippingINR: 0 },
		);
		expect(built.problems).toEqual([]);
		expect(built.lines[0]).toMatchObject({
			ratePercent: 5,
			taxableINR: 34_761.9,
			cgstINR: 869.05,
			sgstINR: 869.05,
		});
		expect(built.totals).toMatchObject({
			taxableINR: 34_761.9,
			cgstINR: 869.05,
			sgstINR: 869.05,
			igstINR: 0,
			totalINR: 36_500,
		});
	});

	it('uses IGST to another State, taxes shipping at the highest rate, and rounds to the rupee', () => {
		const built = buildInvoiceLines(
			[
				{
					lineId: 'a',
					sku: 'KAT-1',
					title: 'Saree',
					hsn: '5007',
					quantity: 1,
					unit: 'PCS',
					lineTotalINR: 15_975,
				},
				{
					lineId: 'b',
					sku: 'KUR-1',
					title: 'Kurta',
					hsn: '6211',
					quantity: 1,
					unit: 'PCS',
					lineTotalINR: 3_000,
				},
			],
			{ interState: true, shippingINR: 99 },
		);
		expect(built.lines.map((l) => l.ratePercent)).toEqual([5, 18]);
		expect(built.totals.cgstINR).toBe(0);
		expect(built.totals.totalINR).toBe(Math.round(built.totals.totalINR));
		expect(built.totals.totalINR).toBe(19_074);
	});

	it('refuses lines without an HSN or a known rate', () => {
		const built = buildInvoiceLines(
			[
				{ lineId: 'a', sku: 'X', title: 'X', hsn: null, quantity: 1, unit: 'PCS', lineTotalINR: 10 },
				{ lineId: 'b', sku: 'Y', title: 'Y', hsn: '7113', quantity: 1, unit: 'PCS', lineTotalINR: 10 },
			],
			{ interState: false, shippingINR: 0 },
		);
		expect(built.problems).toEqual([
			{ lineId: 'a', problem: 'hsn_missing' },
			{ lineId: 'b', problem: 'hsn_rate_missing' },
		]);
	});

	it('posts a balanced entry: debtor or advance against sales, output tax and rounding; cost against stock', () => {
		const built = buildInvoiceLines(
			[{ lineId: 'a', sku: 'KAT-1', title: 'Saree', hsn: '5007', quantity: 1, unit: 'PCS', lineTotalINR: 999.4 }],
			{ interState: false, shippingINR: 0 },
		);
		const rows = invoicePosting({ totals: built.totals, paidInAdvance: true, costINR: 600 });
		const debit = rows.reduce((s, r) => s + (r.debitPaise ?? 0), 0);
		const credit = rows.reduce((s, r) => s + (r.creditPaise ?? 0), 0);
		expect(debit).toBe(credit);
		expect(rows[0]).toMatchObject({ systemKey: 'customer_advances', debitPaise: 99_900 });
		expect(rows.find((r) => r.systemKey === 'cost_of_goods_sold')?.debitPaise).toBe(60_000);
	});
});
