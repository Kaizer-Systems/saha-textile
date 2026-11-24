import { Business, Order } from '@saha-textile/contracts';
import type { NotificationMessage } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import { OrderNoticesService, shippingNote } from '../src/admin-orders/order-notices.service';

const address = (over: Record<string, unknown> = {}) => ({
	fullName: 'Rina Das',
	line1: '3 Southern Avenue',
	city: 'Kolkata',
	state: 'West Bengal',
	postalCode: '700029',
	country: 'IN',
	countryCode: 'IN',
	mobile: { countryCallingCode: '91', number: '9830012345' },
	...over,
});
const line = (over: Record<string, unknown> = {}) => ({
	lineId: 'l1',
	productId: 'p1',
	title: { en: 'Red Saree' },
	sku: 'SAR-1',
	quantity: 1,
	unitPriceINR: 1000,
	unitPricePaid: 1000,
	lineTotalINR: 1000,
	lineTotalPaid: 1000,
	...over,
});
const order = (over: Record<string, unknown> = {}) =>
	Order.parse({
		id: 'ord_1',
		orderNumber: 'ST-2611-482190',
		currency: 'INR',
		lines: [line()],
		subtotalINR: 1000,
		subtotalPaid: 1000,
		totalINR: 1000,
		totalPaid: 1000,
		status: 'placed',
		paymentStatus: 'paid',
		statusTimeline: [{ status: 'placed', at: '2026-11-18T06:00:00.000Z' }],
		buyer: { kind: 'person', name: 'Rina Das', email: 'rina@example.com' },
		addresses: { billing: address(), delivery: address() },
		...over,
	});

function harness(options: { outcome?: 'sent' | 'failed' | 'throw' | 'reject'; origin?: string | null } = {}) {
	const sent: NotificationMessage[] = [];
	const svc = new OrderNoticesService(
		{
			send: async (message: NotificationMessage) => {
				if (options.outcome === 'throw') throw new Error('provider down');
				if (options.outcome === 'reject') return Promise.reject('not an error');
				sent.push(message);
				return {
					status: options.outcome === 'failed' ? 'failed' : 'sent',
					providerMessageId: 'm1',
					outboxEntryId: 'o1',
				};
			},
			isChannelEnabled: async () => true,
		},
		{ media: { shopOrigin: options.origin === undefined ? 'https://shop.example/' : options.origin } } as never,
	);
	return { svc, sent };
}

describe('the shipping reason in order emails: the remaining cases', () => {
	it('counts further pieces abroad as none when the trace has no count', () => {
		expect(shippingNote([JSON.stringify({ result: 'firstAndFurther' })])).toBe(
			'Sent abroad: first piece, then 0 more',
		);
	});

	it('counts a charged line as one piece at its amount when the trace has no units or unit price', () => {
		expect(shippingNote([JSON.stringify({ result: 'productCharge', amountINR: 150 })])).toBe(
			'1 discounted piece × ₹150',
		);
		expect(shippingNote([JSON.stringify({ result: 'productCharge' })])).toBe('Every piece ships free');
	});
});

describe('order messages: the remaining cases', () => {
	it('takes the mobile from the buyer when the billing address has none, and nothing without either', () => {
		const { svc } = harness();
		const fromBuyer = order({
			addresses: { billing: address({ mobile: undefined }), delivery: address() },
			buyer: { kind: 'person', name: 'Rina', mobile: { countryCallingCode: '91', number: '9830099999' } },
		});
		expect(svc.contactOf(fromBuyer)).toEqual({ email: null, mobile: '+919830099999' });
		expect(svc.contactOf(order({ addresses: undefined, buyer: undefined }))).toEqual({ email: null, mobile: null });
	});

	it('sends for a signed-in buyer, and carries on when a message fails or the sender breaks', async () => {
		const signedIn = harness();
		await signedIn.svc.send(order({ userId: 'usr_1' }), ['order_shipped']);
		expect(signedIn.sent[0]).toMatchObject({ userId: 'usr_1' });
		await expect(harness({ outcome: 'failed' }).svc.send(order(), ['order_shipped'])).resolves.toBeUndefined();
		await expect(harness({ outcome: 'throw' }).svc.send(order(), ['order_shipped'])).resolves.toBeUndefined();
		await expect(harness({ outcome: 'reject' }).svc.send(order(), ['order_shipped'])).resolves.toBeUndefined();
	});

	it('dates an order without a saved time today, lists a line with no id or options, and a delivery address without a PIN', async () => {
		const { svc } = harness();
		const confirmed = order({
			createdAt: undefined,
			lines: [line({ lineId: undefined, attributes: undefined })],
			addresses: { billing: address(), delivery: address({ line2: '', postalCode: '' }) },
		});
		const variables = svc.variables(confirmed, { channel: 'email', template: 'order_confirmed' } as never, {});
		expect(variables['order_date']).toEqual(expect.any(String));
		expect(variables['delivery_address']).toBe('Rina Das, 3 Southern Avenue, Kolkata');
		expect(variables['items']).toEqual([expect.objectContaining({ options: '', note: '' })]);
		expect(
			svc.variables(
				order({ addresses: undefined }),
				{ channel: 'email', template: 'order_confirmed' } as never,
				{},
			)['delivery_address'],
		).toBe('');
	});

	it('refunds a sold-out order in full when no amount is given, with no item list by SMS', () => {
		const { svc } = harness();
		const sms = svc.variables(order(), { channel: 'sms', template: 'order_refunded_sold_out' } as never, {});
		expect(sms).toMatchObject({ amount: '1000' });
		expect(sms).not.toHaveProperty('sold_out_items');
		const email = svc.variables(order(), { channel: 'email', template: 'order_refunded_sold_out' } as never, {});
		expect(email['sold_out_items']).toEqual([]);
	});

	it('says a refund of nothing when neither the facts nor the order know an amount', () => {
		const { svc } = harness();
		expect(svc.variables(order(), { channel: 'email', template: 'refund_processed' } as never, {})['amount']).toBe(
			'₹0',
		);
	});

	it('writes a receipt for the billing name or nobody, with or without a payment or its reference', () => {
		const { svc } = harness();
		const notice = { channel: 'email', template: 'payment_receipt' } as never;
		const noName = order({ buyer: undefined });
		expect(svc.variables(noName, notice, {})).toMatchObject({ name: 'Rina Das', amount: '₹0', method_line: '' });
		expect(svc.variables(order({ buyer: undefined, addresses: undefined }), notice, {})['name']).toBe('');
		const paid = svc.variables(order(), notice, {
			payment: { method: 'upi', amountINR: 500, reference: null, receivedOn: null },
		} as never);
		expect(paid['method_line']).toBe('UPI');
		expect(paid['received_on']).toEqual(expect.any(String));
	});

	it('links to the shop without an origin when none is set', () => {
		const { svc } = harness({ origin: null });
		expect(svc.variables(order(), { channel: 'email', template: 'order_shipped' } as never, {})['order_url']).toBe(
			'/en/account/order/details/ST-2611-482190',
		);
	});
});

describe('a business account’s receipt: the remaining cases', () => {
	const business = (contacts: unknown[], over: Record<string, unknown> = {}) =>
		Business.parse({
			id: 'biz_1',
			legalName: 'Boutique Pvt Ltd',
			tradeName: '',
			gstin: null,
			stateCode: '19',
			stateName: 'West Bengal',
			pan: null,
			registeredAddress: { line: '1 Road', city: 'Kolkata', pin: '700001' },
			contacts,
			roles: { supplier: false, customer: null },
			active: true,
			notes: null,
			createdAt: '2026-11-01T00:00:00.000Z',
			updatedAt: '2026-11-01T00:00:00.000Z',
			...over,
		});
	const input = { method: 'cash', amountINR: 500, reference: 'R1', receivedOn: '2026-11-20' } as never;

	it('writes to the first contact with an email when no accounts contact has one, naming the business by its legal name', async () => {
		const { svc, sent } = harness();
		const biz = business([
			{ id: 'ct_1', name: 'Accounts', email: null, isAccounts: true },
			{ id: 'ct_2', name: 'Owner', email: 'owner@example.com', isAccounts: false },
		]);
		await svc.sendBusinessReceipt(biz, { id: 'rcp_1', documentNumber: null }, input, [], 0);
		expect(sent[0]).toMatchObject({
			destination: 'owner@example.com',
			variables: expect.objectContaining({ name: 'Boutique Pvt Ltd', for_line: 'Your account with us' }),
		});
	});

	it('sends nothing to a business with no email, and carries on when sending fails', async () => {
		const { svc, sent } = harness();
		await svc.sendBusinessReceipt(
			business([{ id: 'ct_1', name: 'Owner', email: null }]),
			{ id: 'rcp_1', documentNumber: null },
			input,
			[],
			0,
		);
		expect(sent).toEqual([]);
		const biz = business([{ id: 'ct_1', name: 'Owner', email: 'owner@example.com' }]);
		await expect(
			harness({ outcome: 'throw' }).svc.sendBusinessReceipt(
				biz,
				{ id: 'rcp_1', documentNumber: 'RC/1' },
				input,
				['ST-1'],
				0,
			),
		).resolves.toBeUndefined();
		await expect(
			harness({ outcome: 'reject' }).svc.sendBusinessReceipt(
				biz,
				{ id: 'rcp_1', documentNumber: null },
				input,
				['ST-1'],
				0,
			),
		).resolves.toBeUndefined();
	});
});
