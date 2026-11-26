import { describe, expect, it } from 'vitest';

import {
	CounterBill,
	CounterBuyerWrite,
	CounterExchange,
	CounterExchangeWrite,
	CounterHere,
	CounterQuote,
	CounterQuoteWrite,
	CounterSaleWrite,
	CounterScan,
	CounterScanQuery,
	CounterSummaryQuery,
} from '../src/counter';
import { OrderPayment, PaymentMethod } from '../src/order-payment';
import { CreditNoteRefundWrite } from '../src/returns';

/** Counter mode (accounts brief P): what a counter sale, an exchange and the day's summary take. */

describe('counter contracts', () => {
	it('takes a sale with an optional address and GSTIN, printed on the roll unless A4 is asked for', () => {
		const sale = CounterSaleWrite.parse({
			locationId: 'loc_gar',
			lines: [{ productId: 'p1', quantity: 1 }],
			buyer: {},
			payments: [{ method: 'cash', amountINR: 100 }],
			expectedTotalINR: 100,
		});
		expect(sale).toMatchObject({ print: 'roll80', cashHandedINR: 0, buyer: { gstin: '', address: '' } });
		expect(CounterBuyerWrite.parse({ gstin: '19aaaaa0000a1z5' }).gstin).toBe('19AAAAA0000A1Z5');
		expect(CounterBuyerWrite.safeParse({ gstin: 'nope' }).success).toBe(false);
		expect(CounterSaleWrite.safeParse({ ...sale, print: 'a5' }).success).toBe(false);
		const exchange = CounterExchangeWrite.parse({
			back: [{ lineId: 'l1', quantity: 1, goes: 'stock' }],
			settle: 'cash',
			expectedBackINR: 1250,
			expectedOutINR: 650,
		});
		expect([exchange.out, exchange.reason]).toEqual([[], 'changed_mind']);
		expect(CounterExchangeWrite.safeParse({ ...exchange, settle: 'store_credit' }).success).toBe(false);
		expect(
			CounterExchange.parse({
				creditNoteId: 'cn1',
				creditNoteNumber: 'CN/26-27/000014',
				backINR: 1250,
				outINR: 650,
				differenceINR: -600,
				sale: null,
			}).differenceINR,
		).toBe(-600);
		expect(
			CounterBill.parse({
				orderId: 'o1',
				orderNumber: 'ST-1',
				locationId: 'loc_gar',
				buyerName: 'Shreya',
				buyerPhone: '',
				invoiceNumber: 'TI/26-27/000153',
				deliveredOn: '2026-11-23',
				windowOpen: true,
				lines: [],
			}).lines,
		).toEqual([]);
		expect(
			CreditNoteRefundWrite.parse({ how: 'by_hand', method: 'cash', ledgerId: 'led_till', reference: 'CASH 1' }),
		).toMatchObject({ method: 'cash' });
		expect(CounterSummaryQuery.parse({ date: '2026-11-23', locationId: 'loc_gar' }).date).toBe('2026-11-23');
	});

	it('knows cash and card payments, and where a payment landed', () => {
		expect(PaymentMethod.options).toContain('cash');
		expect(PaymentMethod.options).toContain('card');
		const shape = OrderPayment.shape.ledgerId;
		expect(shape.parse(undefined)).toBeUndefined();
		expect(shape.parse('led_till')).toBe('led_till');
	});

	it('says where a person sells, what a scan found, and prices a counter cart with its tax', () => {
		expect(
			CounterHere.parse({
				current: null,
				stores: [
					{ locationId: 'loc_gar', name: 'Gariahat store', place: 'Kolkata, West Bengal', sheetOpen: true },
				],
			}).stores,
		).toHaveLength(1);
		expect(CounterScanQuery.parse({ code: ' TNT-WHT ' }).code).toBe('TNT-WHT');
		expect(CounterScanQuery.safeParse({ code: '' }).success).toBe(false);
		expect(
			CounterScan.parse({ productId: 'p1', variationId: null, sku: 'TNT-WHT', title: 'Tant', soldBy: 'piece' })
				.sku,
		).toBe('TNT-WHT');
		expect(CounterQuoteWrite.parse({ locationId: 'loc_gar', lines: [] }).lines).toEqual([]);
		expect(
			CounterQuote.parse({
				lines: [],
				taxableINR: 0,
				cgstINR: 0,
				sgstINR: 0,
				totalINR: 0,
				problems: [{ sku: 'X', problem: 'hsn_missing' }],
			}).problems,
		).toHaveLength(1);
	});
});
