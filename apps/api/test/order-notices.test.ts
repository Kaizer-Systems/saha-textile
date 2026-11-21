import { Business, Order, type OrderPayment } from '@saha-textile/contracts';
import type { NotificationMessage } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import { noticeMoney, OrderNoticesService, shippingNote } from '../src/admin-orders/order-notices.service';

const address = {
	fullName: 'Rina Das',
	line1: '3 Southern Avenue',
	city: 'Kolkata',
	state: 'West Bengal',
	postalCode: '700029',
	country: 'IN',
	countryCode: 'IN',
	mobile: { countryCallingCode: '91', number: '9830012345' },
};

const order = (over: Record<string, unknown> = {}) =>
	Order.parse({
		id: 'ord_1',
		orderNumber: 'ST-2611-482190',
		currency: 'INR',
		locale: 'bn',
		lines: [
			{
				lineId: 'l1',
				productId: 'p1',
				title: { en: 'Red Banarasi Katan Silk Saree' },
				sku: 'SAR-1',
				quantity: 2,
				attributes: { colour: 'Red' },
				imageUrl: 'https://media.example/p1.jpg',
				unitPriceINR: 10_200,
				unitPricePaid: 10_200,
				lineTotalINR: 20_400,
				lineTotalPaid: 20_400,
			},
			{
				lineId: 'l2',
				productId: 'p2',
				title: { en: 'Bengal Cotton Tant Saree' },
				sku: 'SAR-2',
				quantity: 1,
				madeToOrder: true,
				unitPriceINR: 2_450,
				unitPricePaid: 2_450,
				lineTotalINR: 2_450,
				lineTotalPaid: 2_450,
			},
		],
		subtotalINR: 22_850,
		subtotalPaid: 22_850,
		shipping: {
			value: 200,
			currency: 'INR',
			trace: [
				JSON.stringify({ result: 'productCharge', units: 2, unitAmountINR: 100, amountINR: 200 }),
				JSON.stringify({ result: 'free', amountINR: 0 }),
			],
		},
		totalINR: 23_050,
		totalPaid: 23_050,
		status: 'placed',
		paymentStatus: 'paid',
		statusTimeline: [{ status: 'placed', at: '2026-11-18T06:00:00.000Z' }],
		buyer: { kind: 'person', name: 'Rina Das', email: 'rina@example.com' },
		addresses: { billing: address, delivery: address },
		createdAt: '2026-11-18T06:00:00.000Z',
		...over,
	});

function harness(fail = false) {
	const sent: NotificationMessage[] = [];
	const svc = new OrderNoticesService(
		{
			send: async (message: NotificationMessage) => {
				if (fail) throw new Error('provider down');
				sent.push(message);
				return { status: 'sent', providerMessageId: 'm1', outboxEntryId: 'o1' };
			},
			isChannelEnabled: async () => true,
		},
		{ media: { shopOrigin: 'https://shop.example/' } } as never,
	);
	return { svc, sent };
}

describe('order messages: what the customer gets (orders brief, emails section)', () => {
	it('fills order_confirmed as drawn: items, totals, the shipping reason, payment and links', async () => {
		const { svc, sent } = harness();
		await svc.send(order(), ['order_confirmed']);
		expect(sent.map((row) => row.channel)).toEqual(['email', 'sms']);
		const email = sent[0];
		expect(email).toMatchObject({
			category: 'transactional',
			templateKey: 'order_confirmed',
			destination: 'rina@example.com',
			idempotencyKey: 'order:ord_1:order_confirmed:email:1',
		});
		expect(email?.variables).toMatchObject({
			order_number: 'ST-2611-482190',
			order_date: '18 Nov 2026',
			subtotal: '₹22,850',
			shipping: '₹200',
			shipping_note: '2 discounted pieces × ₹100; full-price pieces ship free',
			gst_note: 'Included',
			total: '₹23,050',
			payment_line: 'Paid ₹23,050',
			delivery_address: 'Rina Das, 3 Southern Avenue, Kolkata 700029',
			order_url: 'https://shop.example/bn/account/order/details/ST-2611-482190',
			has_cancel_note: true,
		});
		expect(email?.variables?.['items']).toEqual([
			{
				image: 'https://media.example/p1.jpg',
				name: 'Red Banarasi Katan Silk Saree',
				options: 'Red',
				quantity: '2',
				price: '₹10,200',
				total: '₹20,400',
				note: '',
			},
			{
				image: '',
				name: 'Bengal Cotton Tant Saree',
				options: '',
				quantity: '1',
				price: '₹2,450',
				total: '₹2,450',
				note: 'Made to order',
			},
		]);
	});

	it('sends the SMS form: no hyphens in the number (K6), whole rupees, no lists', async () => {
		const { svc, sent } = harness();
		await svc.send(order(), ['order_confirmed']);
		const sms = sent[1];
		expect(sms).toMatchObject({ channel: 'sms', destination: '+919830012345' });
		expect(sms?.variables).toEqual({
			order_number: 'ST2611482190',
			order_url: 'https://shop.example/bn/account/order/details/ST-2611-482190',
			amount: '23050',
		});
	});

	it('words shipped, cancelled and the sold-out refund from the facts given', async () => {
		const { svc } = harness();
		const placed = order();
		const sms = { channel: 'sms' as const, template: 'order_shipped' };
		expect(
			svc.variables(
				placed,
				{ channel: 'email', template: 'order_shipped' },
				{
					shipment: { courierName: 'DTDC', trackingNumber: 'D47512398', trackingUrl: null },
				},
			),
		).toMatchObject({ courier_name: 'DTDC', tracking_number: 'D47512398', has_tracking_url: false });
		expect(svc.variables(placed, sms, {}).order_number).toBe('ST2611482190');
		const paid = order({
			balance: {
				goodsINR: 22_850,
				couponINR: 0,
				shippingINR: 200,
				totalINR: 23_050,
				paidINR: 23_050,
				dueINR: 0,
				paidAheadINR: 0,
			},
		});
		expect(svc.variables(paid, { channel: 'email', template: 'order_cancelled' }, {})).toMatchObject({
			has_refund: true,
			refund_line: '₹23,050 goes back to the way you paid.',
		});
		expect(svc.variables(order(), { channel: 'email', template: 'order_cancelled' }, {})).toMatchObject({
			has_refund: false,
		});
		const soldOut = svc.variables(
			placed,
			{ channel: 'email', template: 'order_refunded_sold_out' },
			{ soldOutLineIds: ['l1'], refundedINR: 23_050 },
		);
		expect(soldOut).toMatchObject({ amount: '₹23,050', similar_url: 'https://shop.example/bn/collections' });
		expect((soldOut['sold_out_items'] as unknown[]).length).toBe(1);
		expect(
			svc.variables(placed, { channel: 'sms', template: 'refund_processed' }, { refundedINR: 23_050.4 }),
		).toMatchObject({ amount: '23050', order_number: 'ST2611482190' });
		expect(svc.variables(placed, { channel: 'email', template: 'payment_not_completed' }, {})).toEqual({
			order_number: 'ST-2611-482190',
			retry_url: 'https://shop.example/bn/checkout',
		});
	});

	it('fills the receipt with the method, its reference and the day received (od08)', () => {
		const { svc } = harness();
		const payment = {
			id: 'pay_1',
			method: 'cashOnDelivery',
			amountINR: 23_050,
			reference: 'RCPT-77',
			receivedOn: '2026-11-21',
		} as OrderPayment;
		expect(svc.variables(order(), { channel: 'email', template: 'payment_receipt' }, { payment })).toEqual({
			name: 'Rina Das',
			amount: '₹23,050',
			method_line: 'Cash on delivery · ref RCPT-77',
			received_on: '21 Nov 2026',
			for_line: 'Order ST-2611-482190',
			has_balance: false,
			balance_line: '',
		});
	});

	it('says how an order is to be paid when it isn’t paid yet', () => {
		const { svc } = harness();
		const line = (over: Record<string, unknown>) =>
			svc.variables(order(over), { channel: 'email', template: 'order_confirmed' }, {})['payment_line'];
		expect(line({ paymentStatus: 'due_on_delivery' })).toBe('Cash on delivery: ₹23,050');
		expect(line({ paymentStatus: 'on_account', onAccountDueOn: '2026-12-20' })).toBe(
			'On account, due by 20 Dec 2026',
		);
		expect(line({ paymentStatus: 'on_account' })).toBe('On account');
		expect(line({ paymentStatus: 'unpaid' })).toBe('₹23,050 due');
	});

	it('goes by email only abroad, and never lets a failed send escape', async () => {
		const abroad = order({
			addresses: {
				billing: { ...address, mobile: { countryCallingCode: '44', number: '7946000000' } },
				delivery: address,
			},
		});
		const { svc, sent } = harness();
		await svc.send(abroad, ['order_delivered']);
		expect(sent.map((row) => row.channel)).toEqual(['email']);
		const broken = harness(true);
		await expect(broken.svc.send(order(), ['order_delivered'])).resolves.toBeUndefined();
	});

	it('sends after a status move only when the status changed', async () => {
		const { svc, sent } = harness();
		await svc.afterChange(order({ status: 'placed' }), order({ status: 'processing' }));
		expect(sent).toEqual([]);
		await svc.afterChange(order({ status: 'awaiting_payment' }), order({ status: 'placed' }));
		expect(sent.map((row) => row.templateKey)).toEqual(['order_confirmed', 'order_confirmed']);
	});

	it('emails a business receipt to the accounts contact, with the orders it paid and the balance (bz06)', async () => {
		const { svc, sent } = harness();
		const business = Business.parse({
			id: 'biz_1',
			legalName: 'Bose Textiles Pvt Ltd',
			tradeName: 'Bose Boutique',
			gstin: null,
			pan: null,
			stateCode: '19',
			stateName: 'West Bengal',
			registeredAddress: { line: '1 Park Street', city: 'Kolkata', pin: '700016' },
			contacts: [
				{ id: 'c1', name: 'Owner', email: 'owner@bose.example', isAccounts: false },
				{ id: 'c2', name: 'Accounts', email: 'accounts@bose.example', isAccounts: true },
			],
			roles: { supplier: false, customer: null },
			active: true,
			notes: null,
			createdAt: '2026-11-01T00:00:00.000Z',
			updatedAt: '2026-11-01T00:00:00.000Z',
		});
		await svc.sendBusinessReceipt(
			business,
			{ id: 'led_1', documentNumber: 'RC/26-27/000457' },
			{ method: 'bankTransfer', amountINR: 18_400, reference: 'SBIN52026112000981', receivedOn: '2026-11-20' },
			['ST-2611-210940'],
			0,
		);
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			channel: 'email',
			templateKey: 'payment_receipt',
			destination: 'accounts@bose.example',
			idempotencyKey: 'receipt:led_1:email',
			variables: {
				name: 'Bose Boutique',
				amount: '₹18,400',
				method_line: 'Bank transfer · ref SBIN52026112000981',
				received_on: '20 Nov 2026',
				for_line: 'Order ST-2611-210940',
				has_balance: true,
				balance_line: 'Balance on your account: ₹0.',
			},
		});
		await svc.sendBusinessReceipt(
			{ ...business, contacts: [] },
			{ id: 'led_2', documentNumber: null },
			{
				method: 'cash',
				amountINR: 1,
				reference: 'x',
				receivedOn: '2026-11-20',
			},
			[],
			0,
		);
		expect(sent).toHaveLength(1);
	});

	it('formats money and the shipping reason the way the shop checkout words them', () => {
		expect(noticeMoney(23_050, 'INR')).toBe('₹23,050');
		expect(noticeMoney(280.97, 'GBP')).toBe('£280.97');
		expect(shippingNote([JSON.stringify({ result: 'firstAndFurther', furtherUnits: 2, amountINR: 3_800 })])).toBe(
			'Sent abroad: first piece, then 2 more',
		);
		expect(shippingNote([JSON.stringify({ result: 'free', amountINR: 0 })])).toBe('Every piece ships free');
		expect(
			shippingNote([JSON.stringify({ result: 'productCharge', units: 1, unitAmountINR: 100, amountINR: 100 })]),
		).toBe('1 discounted piece × ₹100');
		expect(shippingNote(['not json', JSON.stringify({ nothing: true })])).toBe('');
	});
});
