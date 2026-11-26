import { describe, expect, it } from 'vitest';

import { isIndianMobile, plannedNotices, statusNotices } from '../src/orders/order-notices';

describe('order messages (orders brief: status table, od06, od08)', () => {
	it('tells the customer only at the steps the brief names, and nothing when the status stays', () => {
		expect(statusNotices('awaiting_payment', 'placed')).toEqual(['order_confirmed']);
		expect(statusNotices('packed', 'shipped')).toEqual(['order_shipped']);
		expect(statusNotices('shipped', 'delivered')).toEqual(['order_delivered']);
		expect(statusNotices('placed', 'cancelled')).toEqual(['order_cancelled']);
		expect(statusNotices('placed', 'processing')).toEqual([]);
		expect(statusNotices('processing', 'packed')).toEqual([]);
		expect(statusNotices('placed', 'placed')).toEqual([]);
	});

	it('plans email when there is an address and SMS only for an Indian mobile (DLT)', () => {
		const both = { email: 'rina@example.com', mobile: '+919830012345' };
		expect(plannedNotices(['order_shipped'], both)).toEqual([
			{ channel: 'email', template: 'order_shipped' },
			{ channel: 'sms', template: 'order_shipped' },
		]);
		expect(plannedNotices(['order_shipped'], { email: 'a@b.co', mobile: '+447946000000' })).toEqual([
			{ channel: 'email', template: 'order_shipped' },
		]);
		expect(plannedNotices(['order_shipped'], { email: null, mobile: '9830012345' })).toEqual([
			{ channel: 'sms', template: 'order_shipped' },
		]);
		expect(plannedNotices(['order_shipped'], { email: null, mobile: null })).toEqual([]);
	});

	it('sends the receipt by email only, and plans nothing for a template it doesn’t know', () => {
		const both = { email: 'rina@example.com', mobile: '+919830012345' };
		expect(plannedNotices(['payment_receipt'], both)).toEqual([{ channel: 'email', template: 'payment_receipt' }]);
		expect(plannedNotices(['tax_invoice', 'order_payment_link'], both)).toEqual([]);
	});

	it('knows an Indian mobile number in every way staff type it', () => {
		for (const value of ['+919830012345', '+91 98300 12345', '919830012345', '9830012345', '98300-12345']) {
			expect(isIndianMobile(value)).toBe(true);
		}
		for (const value of ['+447946000000', '5830012345', '+91983001234', '', null, undefined]) {
			expect(isIndianMobile(value)).toBe(false);
		}
	});
});
