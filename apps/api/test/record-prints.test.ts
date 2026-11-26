import { Order } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import {
	businessReceiptData,
	journalData,
	openingStockData,
	orderReceiptData,
	placeOfSupply,
	stockCountData,
} from '../src/documents/record-prints';

const seller = { name: 'Saha Textile', lines: ['Kolkata'] };
const address = {
	fullName: 'Ananya Das',
	line1: '12 Lake Road',
	city: 'Kolkata',
	state: 'West Bengal',
	gstStateCode: '19',
	postalCode: '700029',
	country: 'IN',
	countryCode: 'IN',
};
const order = Order.parse({
	id: 'ord_1',
	orderNumber: 'ST-2611-482190',
	currency: 'INR',
	lines: [
		{
			lineId: 'l1',
			productId: 'p1',
			title: { en: 'Kanjivaram saree' },
			sku: 'SAR-1',
			quantity: 1,
			unitPriceINR: 10_000,
			unitPricePaid: 10_000,
			lineTotalINR: 10_000,
			lineTotalPaid: 10_000,
		},
	],
	subtotalINR: 10_000,
	subtotalPaid: 10_000,
	totalINR: 10_000,
	totalPaid: 10_000,
	status: 'placed',
	paymentStatus: 'paid',
	channel: 'admin',
	buyer: { kind: 'business', businessId: 'biz_1', name: 'Boutique Nila', gstin: '19AAACB1234F1Z5' },
	addresses: { billing: address, delivery: address },
	createdAt: '2026-11-20T05:00:00.000Z',
});
const business = {
	id: 'biz_1',
	legalName: 'Boutique Nila',
	gstin: '19AAACB1234F1Z5',
	registeredAddress: { line: '4 Park Street', city: 'Kolkata', pin: '700016' },
} as never;
const entry = (over: Record<string, unknown>) =>
	({
		id: 'led_1',
		businessId: 'biz_1',
		side: 'receivable',
		kind: 'receipt',
		amountINR: -25_000,
		documentType: 'receipt',
		documentId: 'rcpt_1',
		documentNumber: 'RC/26-27/000003',
		note: 'upi · UTR 4410',
		at: '2026-11-21T06:00:00.000Z',
		by: 'adm_1',
		...over,
	}) as never;

describe('record prints', () => {
	it('prints an order payment as a receipt voucher with the law’s fields', () => {
		const data = orderReceiptData(
			order,
			{
				id: 'pay_1',
				method: 'upi',
				amountINR: 10_000,
				reference: 'UPI 4410',
				gateway: null,
				receivedOn: '2026-11-21',
				receiptNumber: 'RC/26-27/000011',
				recordedAt: '2026-11-21T06:00:00.000Z',
			} as never,
			seller,
		);
		expect(data).toMatchObject({ doc: 'receipt', number: 'RC/26-27/000011', date: '21 Nov 2026' });
		expect(data.values).toMatchObject({
			orderNo: 'ST-2611-482190',
			placeOfSupply: 'West Bengal (19)',
			amount: '₹10,000.00',
			method: 'UPI',
			amountInWords: 'Rupees Ten Thousand Only',
		});
		expect(data.parties['payer']?.lines).toContain('GSTIN 19AAACB1234F1Z5');
	});

	it('names the place of supply, outside India included', () => {
		expect(placeOfSupply({ ...address, countryCode: 'GB', country: 'GB' } as never)).toBe('Outside India (96)');
		expect(placeOfSupply(null)).toBe('');
		expect(placeOfSupply({ ...address, gstStateCode: undefined } as never)).toBe('West Bengal');
	});

	it('prints a business receipt on account and a set-off journal with debit and credit', () => {
		const receipt = businessReceiptData(business, entry({}), seller);
		expect(receipt.values).toMatchObject({ orderNo: 'On account', amount: '₹25,000.00', method: 'UPI' });
		const journal = journalData(
			business,
			[
				entry({
					kind: 'setOff',
					documentType: 'journal',
					documentNumber: 'JV/26-27/000004',
					note: 'Bills of Nov',
					amountINR: -5_000,
				}),
				entry({
					kind: 'setOff',
					side: 'payable',
					documentType: 'journal',
					documentNumber: 'JV/26-27/000004',
					amountINR: -5_000,
				}),
			],
			seller,
		);
		expect(journal.number).toBe('JV/26-27/000004');
		expect(journal.values['narration']).toBe('Set-off: Bills of Nov');
		expect(journal.rows?.map((row) => [row.cells['debit'], row.cells['credit']])).toEqual([
			['', '₹5,000.00'],
			['₹5,000.00', ''],
		]);
	});

	it('prints a count sheet, leaving out what a blind counter may not see', () => {
		const data = stockCountData(
			{
				number: 'SC/26-27/000002',
				label: 'Silk sarees, rack 3',
				startedAt: '2026-11-22T04:00:00.000Z',
				counterNames: ['Raju'],
				lines: [
					{
						sku: 'SAR-1',
						title: 'Baluchari',
						optionsLabel: 'maroon',
						soldBy: 'piece',
						expected: 9,
						counted: 8,
						difference: -1,
					},
					{
						sku: 'FAB-1',
						title: 'Mulmul',
						optionsLabel: '',
						soldBy: 'metre',
						expected: null,
						counted: 125,
						difference: null,
					},
				],
			} as never,
			seller,
		);
		expect(data.rows?.map((row) => row.cells)).toEqual([
			{ index: '1', item: 'Baluchari · maroon', expected: '9', counted: '8', difference: '-1' },
			{ index: '2', item: 'Mulmul', expected: '', counted: '12.5 m', difference: '' },
		]);
		expect(data.signatures?.['countedBy']).toBe('Raju');
		// Started at 03:42 in India, still 22 Nov in UTC: the sheet says 23 Nov.
		const late = stockCountData(
			{
				number: 'SC/26-27/000003',
				label: '',
				startedAt: '2026-11-22T22:12:00.000Z',
				counterNames: [],
				lines: [],
			} as never,
			seller,
		);
		expect(late.date).toBe('23 Nov 2026');
	});

	it('prints an opening-stock load, with cost only for those who may see it', () => {
		const load = {
			id: 'os_1',
			number: 'OS/26-27/000001',
			requestKey: 'k',
			postedAt: '2026-04-01T04:00:00.000Z',
			postedBy: null,
			rows: [
				{
					variantId: 'v1',
					productId: 'p1',
					sku: 'SAR-1',
					quantity: 3,
					unitCostINR: 24_000,
					receivedOn: '2026-04-01',
					layerId: 'l',
					note: '',
				},
				{
					variantId: 'v2',
					productId: 'p2',
					sku: 'FAB-1',
					quantity: 125,
					unitCostINR: 31,
					receivedOn: '2026-04-01',
					layerId: 'l',
					note: '',
				},
			],
			totalUnits: 128,
			totalValueINR: 75_875,
		};
		const titles = new Map([
			['SAR-1', { title: 'Peacock Blue saree', soldBy: 'piece' as const }],
			['FAB-1', { title: 'Mulmul', soldBy: 'metre' as const }],
		]);
		const withCost = openingStockData(load, titles, true, seller);
		expect(withCost.rows?.map((row) => row.cells)).toEqual([
			{ index: '1', item: 'Peacock Blue saree', qty: '3', cost: '₹24,000.00', value: '₹72,000.00' },
			{ index: '2', item: 'Mulmul', qty: '12.5 m', cost: '₹310.00', value: '₹3,875.00' },
		]);
		expect(withCost.totals?.['totals']).toEqual([{ label: 'Opening value', value: '₹75,875.00' }]);
		const noCost = openingStockData(load, new Map(), false, seller);
		expect(noCost.rows?.[0]?.cells).toMatchObject({ item: 'SAR-1', cost: '', value: '' });
		expect(noCost.totals).toEqual({});
	});
});
