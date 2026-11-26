import { randomUUID } from 'node:crypto';

import { Coupon, LedgerEntry, Order, PaymentAttempt, PaymentRequest, Shipment } from '@saha-textile/contracts';
import { StaleRevisionError } from '@saha-textile/core-domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import {
	CouponModel,
	CouponUseModel,
	LedgerEntryModel,
	OrderModel,
	PaymentAttemptModel,
	PaymentModel,
	PaymentRequestModel,
	PriceZoneModel,
	ShipmentModel,
	SupplierModel,
} from '../src/models/index';
import {
	MongoAdminOrderRepository,
	MongoBusinessRepository,
	MongoCouponRepository,
	MongoDocumentNumberingRepository,
	MongoLedgerRepository,
	MongoOrderPaymentRepository,
	MongoOrderSettingsRepository,
	MongoPaymentAttemptRepository,
	MongoPaymentRequestRepository,
	MongoPriceZoneRepository,
	MongoShipmentRepository,
} from '../src/repositories/orders-build.repository';
import { hasMongoEnv, runPrefix } from './mongo-test-env';

/**
 * The orders repositories' remaining reads and writes, against the real replica set, on this run's rows only.
 *
 *   MONGODB_DB_NAME=saha_textile_test RUN_DB_IT=1 pnpm --filter @saha-textile/adapters-db-mongo test
 */
describe.runIf(hasMongoEnv())('orders repositories: the remaining reads and writes (rs0)', () => {
	const P = runPrefix('ordx');
	const TAG = `IT${randomUUID().slice(0, 6).toUpperCase()}`;
	const now = new Date().toISOString();
	const orders = new MongoAdminOrderRepository();

	const order = (key: string, over: Record<string, unknown> = {}) =>
		Order.parse({
			id: `${P}${key}`,
			orderNumber: `${TAG}-${key}`,
			currency: 'INR',
			lines: [],
			subtotalINR: 0,
			subtotalPaid: 0,
			totalINR: 0,
			totalPaid: 0,
			channel: 'admin',
			status: 'open',
			buyer: { kind: 'person', name: `Buyer ${TAG}`, customerId: `${P}cust` },
			...over,
		});

	beforeAll(async () => {
		await connectMongo();
	});

	afterAll(async () => {
		const ours = new RegExp(`^${P}`);
		await Promise.all([
			OrderModel.deleteMany({ _id: ours }).exec(),
			PaymentModel.deleteMany({ _id: ours }).exec(),
			PaymentAttemptModel.deleteMany({ orderId: ours }).exec(),
			PaymentRequestModel.deleteMany({ _id: ours }).exec(),
			ShipmentModel.deleteMany({ _id: ours }).exec(),
			LedgerEntryModel.deleteMany({ _id: ours }).exec(),
			PriceZoneModel.deleteMany({ _id: ours }).exec(),
			CouponModel.deleteMany({ _id: ours }).exec(),
			CouponUseModel.deleteMany({ couponId: ours }).exec(),
			SupplierModel.deleteMany({ _id: ours }).exec(),
		]);
		await disconnectMongo();
	});

	it('counts orders per filter and attention reason, and finds holds that ended', async () => {
		await orders.create(order('placed', { status: 'placed' }), null);
		await orders.create(order('waiting', { status: 'awaiting_payment' }), null);
		await OrderModel.updateOne(
			{ _id: `${P}waiting` },
			{ $set: { holdUntil: '2001-01-01T00:00:00.000Z', attention: 'pendingAtBank' } },
		).exec();
		const counts = await orders.counts({ q: TAG, filter: 'all', page: 1, pageSize: 10 } as never);
		expect(counts.all).toBe(2);
		expect(counts['attention:pendingAtBank']).toBe(1);
		expect(counts.toPack).toBe(1);
		expect((await orders.listHoldsEnded(new Date(), 500)).map((row) => row.id)).toContain(`${P}waiting`);
		expect(await orders.countPlacedByCustomer(`${P}cust`)).toBe(1);
	});

	it('lists a business’s open orders on account, with and without a due date', async () => {
		await OrderModel.collection.insertMany([
			{
				_id: `${P}acct1` as never,
				orderNumber: `${TAG}-A1`,
				status: 'placed',
				buyer: { kind: 'business', businessId: `${P}biz` },
				balance: { dueINR: 500 },
				onAccountDueOn: '2026-12-01',
				createdAt: new Date('2026-11-01T00:00:00Z'),
			},
			{
				_id: `${P}acct2` as never,
				orderNumber: `${TAG}-A2`,
				status: 'placed',
				buyer: { kind: 'business', businessId: `${P}biz` },
				balance: { dueINR: 200 },
			},
		]);
		expect(await orders.listOpenOnAccount(`${P}biz`)).toEqual([
			{
				orderId: `${P}acct2`,
				orderNumber: `${TAG}-A2`,
				dueINR: 200,
				placedAt: new Date(0).toISOString(),
				dueOn: null,
			},
			{
				orderId: `${P}acct1`,
				orderNumber: `${TAG}-A1`,
				dueINR: 500,
				placedAt: '2026-11-01T00:00:00.000Z',
				dueOn: '2026-12-01',
			},
		]);
	});

	it('finds an order payment by id', async () => {
		const payments = new MongoOrderPaymentRepository();
		expect(await payments.findById(`${P}nothing`)).toBeNull();
	});

	it('saves payment attempts, finds them, lists them by order and finds those due a check', async () => {
		const attempts = new MongoPaymentAttemptRepository();
		const attempt = PaymentAttempt.parse({
			id: `${TAG}-1`,
			orderId: `${P}placed`,
			gateway: 'ccavenue',
			currency: 'INR',
			amountMinor: 10000,
			amountINR: 100,
			state: 'pending',
			nextCheckAt: '2001-01-01T00:00:00.000Z',
			createdAt: now,
			updatedAt: now,
		});
		await attempts.save(attempt);
		expect((await attempts.findById(`${TAG}-1`))?.orderId).toBe(`${P}placed`);
		expect(await attempts.findById(`${TAG}-none`)).toBeNull();
		expect((await attempts.listByOrder(`${P}placed`)).map((row) => row.id)).toEqual([`${TAG}-1`]);
		expect((await attempts.listDue(new Date(), 500)).map((row) => row.id)).toContain(`${TAG}-1`);
	});

	it('finds payment requests by order, id and the gateway’s own request id', async () => {
		const requests = new MongoPaymentRequestRepository();
		await requests.save(
			PaymentRequest.parse({
				id: `${P}req`,
				orderId: `${P}placed`,
				number: `${TAG}/Q1`,
				gateway: 'ccavenue',
				currency: 'INR',
				amount: 100,
				amountINR: 100,
				rateFromINR: 1,
				markupPercent: 0,
				gatewayRequestId: `${TAG}gw`,
				gatewayUrl: null,
				tokenHash: `${P}hash`,
				sentTo: { email: null, mobile: null },
				expiresAt: '2099-01-01T00:00:00Z',
				status: 'active',
				createdBy: 'adm',
				createdAt: now,
			}),
		);
		expect((await requests.listByOrder(`${P}placed`)).map((row) => row.id)).toEqual([`${P}req`]);
		expect((await requests.findById(`${P}req`))?.number).toBe(`${TAG}/Q1`);
		expect(await requests.findById(`${P}none`)).toBeNull();
		expect((await requests.findByGatewayRequestId('ccavenue', `${TAG}gw`))?.id).toBe(`${P}req`);
		expect(await requests.findByGatewayRequestId('ccavenue', `${TAG}none`)).toBeNull();
	});

	it('saves shipments, lists them by order and names the couriers used', async () => {
		const shipments = new MongoShipmentRepository();
		await shipments.save(
			Shipment.parse({
				id: `${P}ship`,
				orderId: `${P}placed`,
				number: `${TAG}/P1`,
				lineIds: [],
				mode: 'manual',
				courierName: `${TAG} Couriers`,
				trackingNumber: 'D1234',
				shippedOn: '2026-11-20',
				createdBy: null,
				createdAt: now,
			}),
		);
		expect((await shipments.listByOrder(`${P}placed`)).map((row) => row.id)).toEqual([`${P}ship`]);
		expect(await shipments.courierNames(1000)).toContain(`${TAG} Couriers`);
	});

	it('lists businesses by role, standing and zone, and counts them per zone', async () => {
		const businesses = new MongoBusinessRepository();
		await SupplierModel.collection.insertMany([
			{
				_id: `${P}cust_biz` as never,
				legalName: `${TAG} Retail`,
				deletedAt: null,
				active: true,
				address: { line: '1 Road', city: 'Kolkata', pin: '700001' },
				roles: { supplier: false, customer: { zoneId: `${P}zone`, standing: 'blocked' } },
			},
			{
				_id: `${P}both_biz` as never,
				legalName: `${TAG} Mill`,
				deletedAt: null,
				active: true,
				address: { line: '1 Road', city: 'Kolkata', pin: '700001' },
				roles: { supplier: true, customer: { zoneId: `${P}zone`, standing: 'creditOnHold' } },
			},
		]);
		const list = (over: Record<string, unknown>) =>
			businesses.list({ q: TAG, role: 'all', page: 1, pageSize: 10, ...over } as never);
		expect((await list({ role: 'customer' })).total).toBe(2);
		expect((await list({ role: 'supplier' })).items.map((row) => row.id)).toEqual([`${P}both_biz`]);
		expect((await list({ role: 'both' })).total).toBe(1);
		const blocked = await list({ standing: 'blocked', zoneId: `${P}zone` });
		expect(blocked.items.map((row) => row.id)).toEqual([`${P}cust_biz`]);
		expect(blocked.counts).toMatchObject({ all: 1, customer: 1, blocked: 1, creditOnHold: 1 });
		expect(await businesses.countByZone(`${P}zone`)).toBe(2);
	});

	it('pages an account’s ledger with the balance brought forward, and finds an entry', async () => {
		const ledger = new MongoLedgerRepository();
		const entry = (key: string, at: string, amountINR: number) =>
			LedgerEntry.parse({
				id: `${P}${key}`,
				businessId: `${P}biz`,
				side: 'receivable',
				kind: 'orderOnAccount',
				amountINR,
				documentType: 'order',
				documentId: 'o',
				at,
				by: 'adm',
			});
		await ledger.append(entry('l_old', '2026-10-01T06:00:00.000Z', 300));
		await ledger.append(entry('l_new', '2026-11-15T06:00:00.000Z', 200));
		const page = await ledger.list(`${P}biz`, 'receivable', {
			from: '2026-11-01',
			to: '2026-11-30',
			page: 1,
			pageSize: 10,
		});
		expect(page).toMatchObject({ total: 1, openingINR: 300 });
		expect((await ledger.list(`${P}biz`, 'receivable', { page: 1, pageSize: 10 })).openingINR).toBe(0);
		expect(
			(await ledger.list(`${P}biz`, 'payable', { from: '2026-11-01', page: 1, pageSize: 10 })).openingINR,
		).toBe(0);
		expect((await ledger.findById(`${P}l_new`))?.amountINR).toBe(200);
		expect(await ledger.findById(`${P}none`)).toBeNull();
	});

	it('reads the numbering and order settings, and refuses a save over another revision', async () => {
		const numbering = new MongoDocumentNumberingRepository();
		const settings = new MongoOrderSettingsRepository();
		const current = await numbering.get();
		await expect(numbering.save(current, current.revision + 999)).rejects.toBeInstanceOf(StaleRevisionError);
		const orderSettings = await settings.get();
		await expect(settings.save(orderSettings, orderSettings.revision + 999)).rejects.toBeInstanceOf(
			StaleRevisionError,
		);
	});

	it('lists price zones', async () => {
		const zones = new MongoPriceZoneRepository();
		expect(Array.isArray(await zones.list())).toBe(true);
	});

	it('lists coupons on, off and expired, finds one by code, lists usable ones and says whether one was used', async () => {
		const coupons = new MongoCouponRepository();
		const coupon = (key: string, over: Record<string, unknown> = {}) =>
			Coupon.parse({
				id: `${P}${key}`,
				code: `${TAG}${key.toUpperCase()}`,
				title: `${TAG} ${key}`,
				kind: 'percentOff',
				value: 10,
				...over,
			});
		await coupons.save(coupon('on'), null);
		await coupons.save(coupon('off', { enabled: false }), null);
		await coupons.save(coupon('old', { validUntil: '2001-01-01T00:00:00.000Z' }), null);
		const listed = (filter: string) => coupons.list({ q: TAG, filter, page: 1, pageSize: 10 } as never, new Date());
		expect((await listed('on')).items.map((row) => row.code)).toEqual([`${TAG}ON`]);
		expect((await listed('off')).total).toBe(1);
		const expired = await listed('expired');
		expect(expired.items[0]).toMatchObject({ code: `${TAG}OLD`, expired: true });
		expect((await listed('all')).counts).toEqual({ all: 3, on: 1, off: 1, expired: 1 });
		expect((await coupons.findByCode(` ${TAG.toLowerCase()}on `))?.id).toBe(`${P}on`);
		expect(await coupons.findByCode('NO-SUCH-CODE')).toBeNull();
		expect((await coupons.listUsable('shop', new Date())).map((row) => row.id)).toContain(`${P}on`);
		expect(await coupons.usedOnOrders(`${P}on`)).toBe(false);
		await coupons.recordUse(`${P}on`, 'buyer', `${P}placed`);
		expect(await coupons.usedOnOrders(`${P}on`)).toBe(true);
	});
});
