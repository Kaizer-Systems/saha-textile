import { Order, OrderSettings, type OrderPayment, type Shipment } from '@saha-textile/contracts';
import { NOT_CONNECTED_EINVOICE, NOT_CONNECTED_EWAYBILL, type NotificationMessage } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import { AdminOrdersService, attentionTimesOf, paymentDetailOf } from '../src/admin-orders/admin-orders.service';
import { OrderNoticesService } from '../src/admin-orders/order-notices.service';

const address = {
	fullName: 'Ananya Das',
	line1: '12 Lake Road',
	city: 'Kolkata',
	state: 'West Bengal',
	postalCode: '700029',
	country: 'IN',
};

const baseOrder = (over: Record<string, unknown> = {}) =>
	Order.parse({
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
				unitPriceINR: 60_000,
				unitPricePaid: 60_000,
				lineTotalINR: 60_000,
				lineTotalPaid: 60_000,
			},
		],
		subtotalINR: 60_000,
		subtotalPaid: 60_000,
		totalINR: 60_000,
		totalPaid: 60_000,
		status: 'packed',
		paymentStatus: 'paid',
		channel: 'admin',
		buyer: { kind: 'business', businessId: 'biz_1', name: 'Boutique Nila' },
		addresses: { billing: address, delivery: address },
		balance: {
			goodsINR: 60_000,
			couponINR: 0,
			shippingINR: 0,
			totalINR: 60_000,
			paidINR: 60_000,
			dueINR: 0,
			paidAheadINR: 0,
		},
		createdAt: '2026-11-20T05:00:00.000Z',
		...over,
	});

function service(order: Order, notices: OrderNoticesService | null = null) {
	let stored = order;
	const shipments: Shipment[] = [];
	const payments: OrderPayment[] = [];
	const ledger: unknown[] = [];
	const stockMoves: Array<[string, number]> = [];
	const svc = new AdminOrdersService(
		{
			findById: async () => stored,
			update: async (next: Order) => {
				stored = { ...next, revision: next.revision + 1 };
				return stored;
			},
		} as never,
		{
			listByOrder: async () => payments,
			findById: async (paymentId: string) => payments.find((row) => row.id === paymentId) ?? null,
			save: async (payment: OrderPayment) => {
				const index = payments.findIndex((row) => row.id === payment.id);
				if (index >= 0) payments[index] = payment;
				else payments.push(payment);
				return payment;
			},
		} as never,
		{ listByOrder: async () => [] } as never,
		{
			listByOrder: async () => shipments,
			courierNames: async () => [...new Set(shipments.map((row) => row.courierName))],
			save: async (shipment: Shipment) => {
				const index = shipments.findIndex((row) => row.id === shipment.id);
				if (index >= 0) shipments[index] = shipment;
				else shipments.push(shipment);
				return shipment;
			},
		} as never,
		{ get: async () => OrderSettings.parse({}) } as never,
		{ findById: async () => null } as never,
		{ balance: async () => 0, append: async (entry: unknown) => ledger.push(entry) } as never,
		NOT_CONNECTED_EINVOICE,
		NOT_CONNECTED_EWAYBILL,
		{
			childNumber: async (_kind: string, number: string, n: number) => `${number}/P${n}`,
			issue: async () => `RC/26-27/00000${payments.length + 1}`,
		} as never,
		{ check: async () => ({ ...address, countryCode: 'IN', gstStateCode: '19' }) } as never,
		{ withTransaction: async (work: (context: unknown) => Promise<unknown>) => work({}) } as never,
		{
			reserve: async () => undefined,
			release: async (_o: Order, lines: Order['lines']) => stockMoves.push(['release', lines.length]),
			sell: async (_o: Order, lines: Order['lines']) => {
				stockMoves.push(['sell', lines.length]);
				return new Map([['l1', 41_000]]);
			},
		} as never,
		null,
		notices,
	);
	return { svc, shipments, payments, ledger, stockMoves, current: () => stored };
}

const actor = { id: 'adm_1', name: 'Staff' };
const shipped = {
	to: 'shipped' as const,
	comment: null,
	shipped: {
		mode: 'manual' as const,
		courierName: 'DTDC',
		trackingNumber: 'D47512398',
		trackingUrl: null,
		shippedOn: '2026-11-20',
	},
	delivered: null,
	cancel: null,
	lineIds: [],
	revision: 0,
};

describe('admin orders: the order page (od05–od08, st01–st05)', () => {
	it('keeps Shipped off until the IRN and, from ₹50,000, the e-way bill are in (DEC-EDOCS-GATE)', async () => {
		const { svc } = service(baseOrder());
		const detail = await svc.detail('ord_1');
		expect(detail.eDocuments).toEqual({
			shown: true,
			eInvoice: { required: true, present: false, connected: false },
			eWayBill: { required: true, present: false, connected: false },
		});
		expect(detail.allowedNext.find((row) => row.to === 'shipped')).toMatchObject({
			allowed: false,
			reason: 'eDocumentsMissing',
		});
		await expect(svc.changeStatus('ord_1', shipped, actor)).rejects.toMatchObject({
			response: { issues: [{ code: 'status_blocked', params: { reason: 'eDocumentsMissing' } }] },
		});
	});

	it('records the documents typed by hand, then ships with a parcel number off the order number', async () => {
		const { svc, shipments, current } = service(baseOrder({ lines: [{ ...baseOrder().lines[0], held: true }] }));
		expect(await svc.raise('ord_1', 'eInvoice', actor)).toEqual({ outcome: 'notConnected' });
		await svc.setEInvoice(
			'ord_1',
			{
				irn: 'a'.repeat(64),
				ackNo: '112010036563310',
				ackDate: '2026-11-20T06:00:00.000Z',
				signedQr: null,
				revision: 0,
			},
			actor,
		);
		await svc.setEWayBill(
			'ord_1',
			{
				number: '331001234567',
				generatedOn: '2026-11-20T06:10:00.000Z',
				validUntil: '2026-11-21T06:10:00.000Z',
				transporterName: null,
				transporterId: null,
				vehicleOrDocumentNo: null,
				distanceKm: 12,
				revision: 1,
			},
			actor,
		);
		expect(current().eInvoice).toMatchObject({ source: 'manual', by: 'adm_1' });
		const detail = await svc.changeStatus('ord_1', { ...shipped, revision: 2 }, actor);
		expect(detail.order.status).toBe('shipped');
		expect(shipments[0]).toMatchObject({ number: 'ST-2611-482190/P1', courierName: 'DTDC', lineIds: ['l1'] });
		expect(current().lines[0]).toMatchObject({ held: false, unitCostINR: 41_000 });
		expect(current().history.at(-1)).toMatchObject({ kind: 'status', from: 'packed', to: 'shipped' });
	});

	it('asks for the courier, and refuses steps the machine does not allow', async () => {
		const small = baseOrder({
			buyer: { kind: 'person', customerId: 'cus_1', name: 'Ananya Das' },
			subtotalINR: 9_000,
			totalINR: 9_000,
			balance: {
				goodsINR: 9_000,
				couponINR: 0,
				shippingINR: 0,
				totalINR: 9_000,
				paidINR: 9_000,
				dueINR: 0,
				paidAheadINR: 0,
			},
		});
		const { svc } = service(small);
		await expect(svc.changeStatus('ord_1', { ...shipped, shipped: null }, actor)).rejects.toMatchObject({
			response: { issues: [{ code: 'courier_needed' }] },
		});
		await expect(
			svc.changeStatus('ord_1', { ...shipped, to: 'delivered', shipped: null }, actor),
		).rejects.toMatchObject({
			response: { issues: [{ code: 'status_blocked' }] },
		});
	});

	it('adds the staff-only invoice address and clears the flag that holds packing', async () => {
		const needs = baseOrder({
			status: 'processing',
			addresses: {
				billing: { ...address, country: 'GB' },
				delivery: { ...address, country: 'GB' },
				invoice: { source: 'none', needed: true },
			},
		});
		const { svc, current } = service(needs);
		expect((await svc.detail('ord_1')).attention).toContain('invoiceAddressNeeded');
		await svc.setInvoiceAddress(
			'ord_1',
			{
				address: {
					fullName: 'Ananya Das',
					line1: '12 Lake Road',
					city: 'Kolkata',
					subdivisionCode: 'WB',
					postalCode: '700029',
					countryCode: 'IN',
					mobile: { countryCallingCode: '91', number: '9830012345' },
				},
				confirmedHow: 'Called the customer',
				revision: 0,
			},
			actor,
		);
		expect(current().addresses?.invoice).toMatchObject({
			source: 'staff',
			needed: false,
			confirmedHow: 'Called the customer',
		});
	});

	it('records payments by hand: less than due stays due, a pending transfer waits, then the order is placed', async () => {
		const awaiting = baseOrder({
			status: 'awaiting_payment',
			paymentStatus: 'unpaid',
			placedWith: 'manual',
			balance: {
				goodsINR: 60_000,
				couponINR: 0,
				shippingINR: 0,
				totalINR: 60_000,
				paidINR: 0,
				dueINR: 60_000,
				paidAheadINR: 0,
			},
		});
		const { svc, payments, ledger, current } = service(awaiting);
		expect(await svc.paymentPrefill('ord_1')).toEqual({ amountINR: 60_000 });
		const part = await svc.recordPayment(
			'ord_1',
			{
				method: 'upi',
				amountINR: 20_000,
				reference: '402112345678',
				receivedOn: '2026-11-20',
				received: true,
				note: null,
				proofMediaId: null,
				collector: null,
				collectedBy: null,
				revision: 0,
			},
			actor,
		);
		expect(part.order.balance).toMatchObject({ paidINR: 20_000, dueINR: 40_000 });
		expect(payments[0]).toMatchObject({ state: 'received', receiptNumber: 'RC/26-27/000001' });
		expect(ledger).toHaveLength(0);
		const pending = await svc.recordPayment(
			'ord_1',
			{
				method: 'bankTransfer',
				amountINR: 40_000,
				reference: 'UTR-PENDING',
				receivedOn: '2026-11-20',
				received: false,
				note: null,
				proofMediaId: null,
				collector: null,
				collectedBy: null,
				revision: 1,
			},
			actor,
		);
		expect(pending.order).toMatchObject({ paymentStatus: 'pending_at_bank', status: 'awaiting_payment' });
		const done = await svc.markReceived(
			'ord_1',
			payments[1]?.id as string,
			{ reference: 'HDFCN52026112012345', receivedOn: '2026-11-21', revision: 2 },
			actor,
		);
		expect(done.order).toMatchObject({ paymentStatus: 'paid', status: 'placed' });
		expect(current().history.map((row) => row.kind)).toEqual(['payment', 'payment', 'payment', 'status']);
	});

	it('refuses a payment method switched off in the order settings', async () => {
		const { svc } = service(baseOrder({ status: 'awaiting_payment' }));
		const off = OrderSettings.parse({
			adminPaymentMethods: {
				paymentLink: true,
				upi: false,
				bankTransfer: true,
				cashOnDelivery: true,
				onAccount: true,
			},
		});
		(svc as unknown as { settings: { get: () => Promise<OrderSettings> } }).settings = { get: async () => off };
		await expect(
			svc.recordPayment(
				'ord_1',
				{
					method: 'upi',
					amountINR: 1,
					reference: 'x',
					receivedOn: '2026-11-20',
					received: true,
					note: null,
					proofMediaId: null,
					collector: null,
					collectedBy: null,
					revision: 0,
				},
				actor,
			),
		).rejects.toMatchObject({ response: { issues: [{ code: 'method_off' }] } });
	});

	it('takes a payment on an order placed on account off the business account', async () => {
		const { svc, ledger } = service(
			baseOrder({
				status: 'placed',
				paymentStatus: 'on_account',
				placedWith: 'onAccount',
				balance: {
					goodsINR: 60_000,
					couponINR: 0,
					shippingINR: 0,
					totalINR: 60_000,
					paidINR: 0,
					dueINR: 60_000,
					paidAheadINR: 0,
				},
			}),
		);
		const after = await svc.recordPayment(
			'ord_1',
			{
				method: 'bankTransfer',
				amountINR: 60_000,
				reference: 'UTR1',
				receivedOn: '2026-11-20',
				received: true,
				note: null,
				proofMediaId: null,
				collector: null,
				collectedBy: null,
				revision: 0,
			},
			actor,
		);
		expect(after.order.paymentStatus).toBe('paid');
		expect(ledger).toEqual([
			expect.objectContaining({ businessId: 'biz_1', side: 'receivable', kind: 'receipt', amountINR: -60_000 }),
		]);
	});
});

describe('admin orders: the list lines (ol02, ol03)', () => {
	const at = '2026-11-19T13:14:00.000Z';
	const payment = (over: Partial<OrderPayment> = {}): OrderPayment => ({
		id: 'pay_1',
		orderId: 'ord_1',
		method: 'upi',
		state: 'received',
		amountINR: 9_800,
		currency: 'INR',
		amount: 9_800,
		reference: '432198765012',
		gateway: null,
		paypal: null,
		collector: null,
		collectedBy: null,
		receivedOn: '2026-11-20',
		receiptNumber: null,
		note: null,
		proofMediaId: null,
		recordedBy: 'adm_1',
		recordedAt: at,
		...over,
	});

	it('words the payment line: the whole reference, the gateway, cash on delivery and the on-account due day', () => {
		const now = new Date('2026-11-20T10:00:00.000Z');
		expect(paymentDetailOf([payment()], [], now)).toMatchObject({ kind: 'payment', reference: '432198765012' });
		expect(
			paymentDetailOf(
				[payment({ method: 'gateway', reference: 'pp_9', gateway: { id: 'paypal', attemptId: 'a', reference: 'pp_9', requestId: null } })],
				[],
				now,
			),
		).toMatchObject({ kind: 'payment', gateway: 'paypal', reference: null });
		expect(paymentDetailOf([], [], now, { paymentStatus: 'due_on_delivery', onAccountDueOn: null })).toEqual({
			kind: 'cashOnDelivery',
		});
		expect(paymentDetailOf([], [], now, { paymentStatus: 'on_account', onAccountDueOn: '2026-12-20' })).toEqual({
			kind: 'onAccount',
			dueOn: '2026-12-20',
		});
	});

	it('dates each reason an order waits on staff', () => {
		const order = baseOrder({ status: 'awaiting_payment', paymentStatus: 'pending_at_bank' });
		const times = attentionTimesOf(order, ['pendingAtBank', 'invoiceAddressNeeded'], [payment({ state: 'pending' })], []);
		expect(times).toEqual({ pendingAtBank: at });
	});
});

describe('admin orders: what the customer is told (status table, od06, od08)', () => {
	const person = (over: Record<string, unknown> = {}) =>
		baseOrder({
			buyer: { kind: 'person', customerId: 'cus_1', name: 'Ananya Das', email: 'ananya@example.com' },
			addresses: {
				billing: { ...address, mobile: { countryCallingCode: '91', number: '9830012345' } },
				delivery: address,
			},
			subtotalINR: 9_000,
			totalINR: 9_000,
			balance: {
				goodsINR: 9_000,
				couponINR: 0,
				shippingINR: 0,
				totalINR: 9_000,
				paidINR: 9_000,
				dueINR: 0,
				paidAheadINR: 0,
			},
			...over,
		});
	const notices = (fail = false) => {
		const sent: NotificationMessage[] = [];
		const svc = new OrderNoticesService(
			{
				send: async (message: NotificationMessage) => {
					if (fail) throw new Error('provider down');
					sent.push(message);
					return { status: 'sent', providerMessageId: 'm', outboxEntryId: 'o' };
				},
				isChannelEnabled: async () => true,
			},
			{ media: { shopOrigin: 'https://shop.example' } } as never,
		);
		return { svc, sent };
	};
	const upi = (amountINR: number, revision: number) => ({
		method: 'upi' as const,
		amountINR,
		reference: '402112345678',
		receivedOn: '2026-11-20',
		received: true,
		note: null,
		proofMediaId: null,
		collector: null,
		collectedBy: null,
		revision,
	});

	it('sends Order shipped by email and SMS once saved, with the courier, and lists both in the history', async () => {
		const told = notices();
		const { svc, current } = service(person(), told.svc);
		await svc.changeStatus('ord_1', shipped, actor);
		expect(told.sent.map((row) => [row.templateKey, row.channel])).toEqual([
			['order_shipped', 'email'],
			['order_shipped', 'sms'],
		]);
		expect(told.sent[0]?.variables).toMatchObject({ courier_name: 'DTDC', tracking_number: 'D47512398' });
		expect(current().history.at(-1)?.messages).toEqual([
			{ channel: 'email', template: 'order_shipped' },
			{ channel: 'sms', template: 'order_shipped' },
		]);
	});

	it('tells nothing for a quiet step, and a message that fails never undoes the change', async () => {
		const quiet = notices();
		const placed = service(person({ status: 'placed' }), quiet.svc);
		await placed.svc.changeStatus('ord_1', { ...shipped, to: 'processing', shipped: null }, actor);
		expect(quiet.sent).toEqual([]);
		expect(placed.current().history.at(-1)?.messages).toEqual([]);
		const broken = notices(true);
		const { svc, current } = service(person(), broken.svc);
		await expect(svc.changeStatus('ord_1', shipped, actor)).resolves.toMatchObject({
			order: { status: 'shipped' },
		});
		expect(current().status).toBe('shipped');
	});

	it('sends Order confirmed when a payment places the order, without a second receipt email', async () => {
		const told = notices();
		const awaiting = person({
			status: 'awaiting_payment',
			paymentStatus: 'unpaid',
			placedWith: 'manual',
			balance: {
				goodsINR: 9_000,
				couponINR: 0,
				shippingINR: 0,
				totalINR: 9_000,
				paidINR: 0,
				dueINR: 9_000,
				paidAheadINR: 0,
			},
		});
		const { svc, current } = service(awaiting, told.svc);
		// The balance is worked out again from the lines (one ₹60,000 saree), so this pays it up.
		await svc.recordPayment('ord_1', upi(60_000, 0), actor);
		expect(told.sent.map((row) => [row.templateKey, row.channel])).toEqual([
			['order_confirmed', 'email'],
			['order_confirmed', 'sms'],
		]);
		expect(current().history.map((row) => [row.kind, row.messages.length])).toEqual([
			['payment', 0],
			['status', 2],
		]);
	});

	it('emails a receipt for money received on an order already placed (od08)', async () => {
		const told = notices();
		const due = person({
			status: 'delivered',
			paymentStatus: 'due_on_delivery',
			placedWith: 'cashOnDelivery',
			balance: {
				goodsINR: 9_000,
				couponINR: 0,
				shippingINR: 0,
				totalINR: 9_000,
				paidINR: 0,
				dueINR: 9_000,
				paidAheadINR: 0,
			},
		});
		const { svc, current, payments } = service(due, told.svc);
		await svc.recordPayment('ord_1', upi(9_000, 0), actor);
		expect(told.sent).toHaveLength(1);
		expect(told.sent[0]).toMatchObject({
			channel: 'email',
			templateKey: 'payment_receipt',
			idempotencyKey: `order:ord_1:payment_receipt:email:${payments[0]?.id}`,
			variables: { amount: '₹9,000', method_line: 'UPI · ref 402112345678' },
		});
		expect(current().history.at(-1)?.messages).toEqual([{ channel: 'email', template: 'payment_receipt' }]);
	});
});

describe('admin orders: a business past its credit limit (approved one-off)', () => {
	it('shows ₹0 available, never a negative amount; Used says how far over', async () => {
		const { svc } = service(baseOrder({ status: 'placed', paymentStatus: 'on_account', placedWith: 'onAccount' }));
		const internals = svc as unknown as {
			businesses: { findById: () => Promise<unknown> };
			ledgers: { balance: () => Promise<number> };
		};
		internals.businesses = {
			findById: async () => ({
				id: 'biz_1',
				roles: { customer: { creditLimitINR: 20_000, creditDays: 30, standing: 'active' } },
			}),
		};
		internals.ledgers = { balance: async () => 51_056 };
		const detail = await svc.detail('ord_1');
		expect(detail.credit).toMatchObject({ limitINR: 20_000, usedINR: 51_056, availableINR: 0 });
	});
});
