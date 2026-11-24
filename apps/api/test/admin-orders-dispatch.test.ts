import { NOT_CONNECTED_EINVOICE, NOT_CONNECTED_EWAYBILL } from '@saha-textile/core-domain';
import { Order, OrderSettings, type Shipment } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { AdminOrdersService, dispatchedAt } from '../src/admin-orders/admin-orders.service';

/** A parcel's tax invoice is dated the day the goods left (CGST s.31), even when the shipment is recorded later. */

/** 01:30 on 21 November in India. */
const NOW = new Date('2026-11-20T20:00:00.000Z');

describe('the moment a parcel left', () => {
	it('is now when no day is given, or the day given is today in India', () => {
		expect(dispatchedAt(null, NOW.toISOString())).toBe(NOW.toISOString());
		expect(dispatchedAt(undefined, NOW.toISOString())).toBe(NOW.toISOString());
		expect(dispatchedAt('2026-11-21', NOW.toISOString())).toBe(NOW.toISOString());
	});

	it('is noon in India on the day it left, for a shipment recorded after that day', () => {
		expect(dispatchedAt('2026-11-20', NOW.toISOString())).toBe('2026-11-20T06:30:00.000Z');
		expect(dispatchedAt('2026-10-31', NOW.toISOString())).toBe('2026-10-31T06:30:00.000Z');
	});
});

const address = {
	fullName: 'Ananya Das',
	line1: '12 Lake Road',
	city: 'Kolkata',
	state: 'West Bengal',
	postalCode: '700029',
	country: 'IN',
};
const line = {
	lineId: 'l1',
	productId: 'p1',
	title: { en: 'Kanjivaram saree' },
	sku: 'SAR-1',
	quantity: 1,
	unitPriceINR: 6_000,
	unitPricePaid: 6_000,
	lineTotalINR: 6_000,
	lineTotalPaid: 6_000,
	held: true,
};
const order = () =>
	Order.parse({
		id: 'ord_1',
		orderNumber: 'ST-2611-482190',
		currency: 'INR',
		lines: [line],
		subtotalINR: 6_000,
		subtotalPaid: 6_000,
		totalINR: 6_000,
		totalPaid: 6_000,
		status: 'packed',
		paymentStatus: 'paid',
		channel: 'admin',
		buyer: { kind: 'person', customerId: 'cus_1', name: 'Ananya Das' },
		addresses: { billing: address, delivery: address },
		balance: {
			goodsINR: 6_000,
			couponINR: 0,
			shippingINR: 0,
			totalINR: 6_000,
			paidINR: 6_000,
			dueINR: 0,
			paidAheadINR: 0,
		},
		createdAt: '2026-11-10T05:00:00.000Z',
	});

/** The order service with only what shipping needs; the invoice service records what it is asked to issue. */
function build() {
	let stored = order();
	const shipments: Shipment[] = [];
	const invoices = {
		issueAtDispatch: vi.fn(async () => undefined),
		issueBeforeDispatch: vi.fn(),
		currentFor: vi.fn(async () => null),
	};
	const service = new AdminOrdersService(
		{
			findById: async () => stored,
			update: async (next: Order) => (stored = { ...next, revision: next.revision + 1 }),
		} as never,
		{ listByOrder: async () => [] } as never,
		{ listByOrder: async () => [] } as never,
		{
			listByOrder: async () => shipments,
			courierNames: async () => [],
			save: async (row: Shipment) => (shipments.push(row), row),
		} as never,
		{ get: async () => OrderSettings.parse({}) } as never,
		{ findById: async () => null } as never,
		{ balance: async () => 0, append: async () => undefined } as never,
		NOT_CONNECTED_EINVOICE,
		NOT_CONNECTED_EWAYBILL,
		{ childNumber: async (_kind: string, number: string, n: number) => `${number}/P${n}` } as never,
		{ check: async (input: object) => input } as never,
		{ withTransaction: async (work: (context: unknown) => Promise<unknown>) => work({ tx: 1 }) } as never,
		{ release: async () => undefined, sell: async () => new Map<string, number>() } as never,
		null,
		null,
		null,
		invoices as never,
		null,
	);
	return { service, invoices };
}
const ship = (service: AdminOrdersService, shippedOn: string) =>
	service.changeStatus(
		'ord_1',
		{
			comment: null,
			delivered: null,
			cancel: null,
			lineIds: [],
			revision: 0,
			to: 'shipped',
			shipped: {
				mode: 'manual',
				courierName: 'DTDC',
				trackingNumber: 'D1',
				trackingUrl: 'https://track.example/D1',
				shippedOn,
				lineIds: ['l1'],
			},
		} as never,
		{ id: 'adm_1', name: 'Staff' },
		NOW,
	);

describe('the Shipped step’s tax invoice', () => {
	it('is dated noon on the day the parcel left when it is recorded later', async () => {
		const { service, invoices } = build();
		await ship(service, '2026-11-18');
		expect(invoices.issueAtDispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				shipmentId: expect.any(String),
				actorId: 'adm_1',
				at: '2026-11-18T06:30:00.000Z',
			}),
			expect.anything(),
		);
	});

	it('is dated now when the parcel left today', async () => {
		const { service, invoices } = build();
		await ship(service, '2026-11-21');
		expect(invoices.issueAtDispatch).toHaveBeenCalledWith(
			expect.objectContaining({ at: NOW.toISOString() }),
			expect.anything(),
		);
	});
});
