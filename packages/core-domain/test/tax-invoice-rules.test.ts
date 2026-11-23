import type { TaxInvoice } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { eInvoiceProblems } from '../src/edocs/edoc-rules';
import { DELIVERY_SAC, saleFromTaxInvoice } from '../src/invoicing/invoice-edoc';
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

describe('a tax invoice as an e-invoice (D1 + addendum 2)', () => {
	const party = (gstin: string | null, stateCode: string) => ({
		gstin,
		legalName: 'Party',
		line1: 'Street',
		city: 'Town',
		pin: '700124',
		stateCode,
	});
	it('sends the same lines and totals, delivery as one service line, and passes the IRP checks', () => {
		const built = buildInvoiceLines(
			[{ lineId: 'a', sku: 'S1', title: 'Saree', hsn: '5007', quantity: 2, unit: 'PCS', lineTotalINR: 21_000 }],
			{ interState: true, shippingINR: 210 },
		);
		const invoice: TaxInvoice = {
			id: 'ti_1',
			number: 'TI/26-27/000001',
			date: '2026-11-23',
			gstRegistrationId: 'reg',
			gstin: '19DBYPS6736R1ZZ',
			locationId: 'loc',
			orderId: 'ord',
			orderNumber: 'ST-1',
			seller: { name: 'K.R. Marketing', gstin: '19DBYPS6736R1ZZ', address: 'Barasat', stateCode: '19' },
			buyer: { name: 'Rang Mahal', gstin: '27AAKFR1234M1Z2', address: 'Mumbai', stateCode: '27' },
			placeOfSupply: '27',
			interState: true,
			lines: built.lines,
			...built.totals,
			createdAt: '2026-11-23T10:00:00.000Z',
			shipmentId: 'shp_1',
			shippingINR: built.totals.shippingINR,
			ratesPendingCa: true,
			status: 'issued',
			cancellation: null,
			voucherId: null,
			createdBy: null,
		};
		const sale = saleFromTaxInvoice(invoice, {
			seller: party('19DBYPS6736R1ZZ', '19'),
			buyer: party('27AAKFR1234M1Z2', '27'),
		});
		expect(sale.lines).toHaveLength(2);
		expect(sale.lines[1]).toMatchObject({ hsn: DELIVERY_SAC, isService: true, gstRatePercent: 5, totalINR: 210 });
		expect(sale.lines.reduce((s, l) => s + Math.round(l.taxableINR * 100), 0)).toBe(
			Math.round(invoice.taxableINR * 100),
		);
		expect(sale.lines.reduce((s, l) => s + Math.round(l.igstINR * 100), 0)).toBe(Math.round(invoice.igstINR * 100));
		expect(eInvoiceProblems(sale, { enabledFrom: '2026-04-01', todayIst: '2026-11-23' })).toEqual([]);
	});
});

describe('tax invoice edge cases (D1)', () => {
	const line = (over: Partial<Parameters<typeof buildInvoiceLines>[0][number]> = {}) => ({
		lineId: 'a',
		sku: 'S1',
		title: 'Saree',
		hsn: '5007' as string | null,
		quantity: 1,
		unit: 'PCS' as const,
		lineTotalINR: 1_050,
		...over,
	});

	it('refuses an empty parcel, and prices a line of no pieces at nothing a piece', () => {
		expect(buildInvoiceLines([], { interState: false, shippingINR: 0 }).problems).toEqual([
			{ lineId: '', problem: 'no_lines' },
		]);
		const built = buildInvoiceLines([line({ quantity: 0 })], { interState: false, shippingINR: 0 });
		expect(built.lines[0]?.unitPriceINR).toBe(0);
	});

	it('posts CGST and SGST in the seller’s State to a debtor, rounding either way, with no cost line when cost is unknown', () => {
		const within = buildInvoiceLines([line({ lineTotalINR: 1_050.4 })], { interState: false, shippingINR: 0 });
		const down = invoicePosting({ totals: within.totals, paidInAdvance: false, costINR: 0 });
		expect(down.map((r) => r.systemKey)).toEqual([
			'debtors_control',
			'sales',
			'output_cgst',
			'output_sgst',
			'rounding_off',
		]);
		expect(down.find((r) => r.systemKey === 'rounding_off')).toEqual({ systemKey: 'rounding_off', debitPaise: 40 });
		const up = buildInvoiceLines([line({ lineTotalINR: 1_050.6 })], { interState: false, shippingINR: 0 });
		expect(invoicePosting({ totals: up.totals, paidInAdvance: false, costINR: 0 }).at(-1)).toEqual({
			systemKey: 'rounding_off',
			creditPaise: 40,
		});
	});
});

describe('e-invoice edge cases (D1 + addendum 2)', () => {
	const party = (stateCode: string) => ({
		gstin: null,
		legalName: 'P',
		line1: 'S',
		city: 'T',
		pin: '700124',
		stateCode,
	});
	const invoiceOf = (over: Partial<TaxInvoice>): TaxInvoice => ({
		id: 'ti_1',
		number: 'TI/26-27/000001',
		date: '2026-11-23',
		gstRegistrationId: 'reg',
		gstin: '19DBYPS6736R1ZZ',
		locationId: 'loc',
		orderId: 'ord',
		orderNumber: 'ST-1',
		shipmentId: null,
		seller: { name: 'S', gstin: '19DBYPS6736R1ZZ', address: '', stateCode: '19' },
		buyer: { name: 'B', gstin: null, address: '', stateCode: '96' },
		placeOfSupply: '96',
		interState: true,
		lines: [
			{
				lineId: 'a',
				sku: 'S1',
				title: 'Cloth',
				hsn: '5208',
				quantity: 2.5,
				unit: 'MTR',
				unitPriceINR: 420,
				ratePercent: 5,
				taxableINR: 1_000,
				cgstINR: 0,
				sgstINR: 0,
				igstINR: 50,
				totalINR: 1_050,
			},
		],
		shippingINR: 0,
		taxableINR: 1_000,
		cgstINR: 0,
		sgstINR: 0,
		igstINR: 50,
		roundOffINR: 0,
		totalINR: 1_050,
		ratesPendingCa: true,
		status: 'issued',
		cancellation: null,
		voucherId: null,
		createdBy: null,
		createdAt: '2026-11-23T10:00:00.000Z',
		...over,
	});

	it('sends metres as metres, an export as an export, and no delivery line without a charge', () => {
		const sale = saleFromTaxInvoice(invoiceOf({}), { seller: party('19'), buyer: party('96') });
		expect(sale.supplyType).toBe('EXPWOP');
		expect(sale.lines).toHaveLength(1);
		expect(sale.lines[0]).toMatchObject({ unit: 'm', unitPriceINR: 400 });
	});

	it('gives a line of no pieces no unit price', () => {
		const zero = invoiceOf({});
		const sale = saleFromTaxInvoice(
			{ ...zero, placeOfSupply: '27', lines: zero.lines.map((l) => ({ ...l, quantity: 0, unit: 'PCS' })) },
			{ seller: party('19'), buyer: party('27') },
		);
		expect(sale.supplyType).toBe('B2B');
		expect(sale.lines[0]).toMatchObject({ unit: 'pc', unitPriceINR: 0 });
	});
});
