import { describe, expect, it } from 'vitest';

import { CounterBuyerWrite, CounterExchangeWrite, CounterSaleWrite, CounterSummaryQuery } from '../src/counter';
import { OrderPayment, PaymentMethod } from '../src/order-payment';

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
		expect(
			CounterExchangeWrite.parse({
				back: [{ lineId: 'l1', quantity: 1, goes: 'stock' }],
				settle: 'cash',
				expectedDifferenceINR: -600,
			}).out,
		).toEqual([]);
		expect(CounterSummaryQuery.parse({ date: '2026-11-23', locationId: 'loc_gar' }).date).toBe('2026-11-23');
	});

	it('knows cash and card payments, and where a payment landed', () => {
		expect(PaymentMethod.options).toContain('cash');
		expect(PaymentMethod.options).toContain('card');
		const shape = OrderPayment.shape.ledgerId;
		expect(shape.parse(undefined)).toBeUndefined();
		expect(shape.parse('led_till')).toBe('led_till');
	});
});
