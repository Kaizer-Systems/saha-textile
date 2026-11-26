import { Coupon, LedgerEntry, Order, OrderPayment, PaymentRequest, PriceZone } from '@saha-textile/contracts';
import { CouponUsedUpError, DuplicateOrderKeyError, StaleRevisionError } from '@saha-textile/core-domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { seriesFromPurchaseFormat } from '../src/migrations/orders-businesses-zones';
import {
	CouponModel,
	CouponUseModel,
	LedgerEntryModel,
	OrderModel,
	PaymentModel,
	PaymentRequestModel,
	PriceZoneModel,
	SupplierModel,
} from '../src/models/index';
import {
	MongoAdminOrderRepository,
	MongoBusinessRepository,
	MongoCouponRepository,
	MongoLedgerRepository,
	MongoOrderPaymentRepository,
	MongoPaymentRequestRepository,
	MongoPriceZoneRepository,
	orderSearchKeys,
	toBusiness,
} from '../src/repositories/orders-build.repository';
import { MongoTransactionManager } from '../src/transaction-manager';
import { hasMongoEnv, runPrefix } from './mongo-test-env';

describe('orders build mapping (no database)', () => {
	it('reads a purchases number format as a series', () => {
		expect(seriesFromPurchaseFormat('PE/{fy}/{seq6}')).toEqual({
			prefix: 'PE',
			separator: '/',
			includeFinancialYear: true,
			digits: 6,
			reset: 'fy',
		});
		expect(seriesFromPurchaseFormat('ST{seq5}')).toBeNull();
	});

	it('reads an older supplier row as a business that sells to us', () => {
		const business = toBusiness({
			_id: 'sup_1',
			legalName: 'Weavers Co',
			shortName: 'Weavers',
			gstin: null,
			pan: null,
			stateCode: '19',
			stateName: 'West Bengal',
			address: { line: '1 Road', city: 'Kolkata', pin: '700001' },
			contactName: 'Rina',
			email: 'rina@example.test',
			active: true,
		});
		expect(business).toMatchObject({
			tradeName: 'Weavers',
			roles: { supplier: true, customer: null },
			setOff: { mode: 'never' },
			contacts: [{ name: 'Rina', email: 'rina@example.test', isAccounts: true }],
		});
	});

	it('finds an order by every form of its number, the buyer and extra references', () => {
		const order = Order.parse({
			id: 'o1',
			orderNumber: 'ST-48213-90761',
			currency: 'INR',
			lines: [],
			subtotalINR: 0,
			subtotalPaid: 0,
			totalINR: 0,
			totalPaid: 0,
			buyer: {
				kind: 'person',
				name: 'Ananya Sen',
				email: 'ananya@example.test',
				mobile: { countryCallingCode: '91', number: '9830012345' },
			},
		});
		const keys = orderSearchKeys(order, ['D47512398']);
		expect(keys).toEqual(
			expect.arrayContaining([
				'ST4821390761',
				'4821390761',
				'ANANYA',
				'SEN',
				'9830012345',
				'919830012345',
				'D47512398',
			]),
		);
	});
});

/**
 * Against the real replica set, on a test database only:
 *   RUN_DB_IT=1 MONGODB_PORT=27018 MONGODB_DB_NAME=saha_textile_test pnpm --filter @saha-textile/adapters-db-mongo test
 */
describe.runIf(hasMongoEnv())('orders build persistence (rs0)', () => {
	const P = runPrefix('orders');
	const orders = new MongoAdminOrderRepository();
	const now = new Date().toISOString();

	const order = (id: string, number: string) =>
		Order.parse({
			id: `${P}${id}`,
			orderNumber: number,
			currency: 'INR',
			lines: [],
			subtotalINR: 0,
			subtotalPaid: 0,
			totalINR: 0,
			totalPaid: 0,
			channel: 'admin',
			status: 'open',
			buyer: { kind: 'person', name: 'Test Buyer' },
		});

	beforeAll(async () => {
		await connectMongo();
	});

	afterAll(async () => {
		const prefix = new RegExp(`^${P}`);
		await Promise.all([
			OrderModel.deleteMany({ _id: prefix }).exec(),
			PaymentModel.deleteMany({ _id: prefix }).exec(),
			PaymentRequestModel.deleteMany({ _id: prefix }).exec(),
			LedgerEntryModel.deleteMany({ _id: prefix }).exec(),
			PriceZoneModel.deleteMany({ _id: prefix }).exec(),
			CouponModel.deleteMany({ _id: prefix }).exec(),
			CouponUseModel.deleteMany({ couponId: prefix }).exec(),
			SupplierModel.deleteMany({ _id: prefix }).exec(),
		]);
		await disconnectMongo();
	});

	it('creates an order once, refuses a stripped-number twin, and finds it by either form', async () => {
		const number = `ST-${P.length}${Date.now() % 100000}-90761`.replace(/[^A-Z0-9-]/gi, '');
		await orders.create(order('a', number), `${P}key-a-xxxxxxxxxxxx`);
		await expect(orders.create(order('b', number.replace(/-/g, '')), null)).rejects.toBeInstanceOf(
			DuplicateOrderKeyError,
		);
		await expect(orders.create(order('c', `${number}X`), `${P}key-a-xxxxxxxxxxxx`)).rejects.toBeInstanceOf(
			DuplicateOrderKeyError,
		);
		expect((await orders.findByNumber(number.replace(/-/g, '')))?.id).toBe(`${P}a`);
		expect((await orders.findByIdempotencyKey(`${P}key-a-xxxxxxxxxxxx`))?.id).toBe(`${P}a`);
	});

	it('refuses a save over a newer revision', async () => {
		const saved = await orders.findById(`${P}a`);
		expect(saved).not.toBeNull();
		const updated = await orders.update({ ...(saved as Order), status: 'placed' }, 0);
		expect(updated.revision).toBe(1);
		await expect(orders.update({ ...(saved as Order), status: 'cancelled' }, 0)).rejects.toBeInstanceOf(
			StaleRevisionError,
		);
	});

	it('lists by search, filter and date range', async () => {
		// The list filters by India days, so "today" is the India date of `now` (the UTC date is a day
		// behind between midnight and 05:30 IST).
		const today = new Date(new Date(now).getTime() + 330 * 60_000).toISOString().slice(0, 10);
		const page = await orders.list({
			q: 'test buyer',
			filter: 'placed',
			from: today,
			to: today,
			page: 1,
			pageSize: 50,
		});
		expect(page.orders.some((row) => row.id === `${P}a`)).toBe(true);
		const none = await orders.list({
			q: 'test buyer',
			filter: 'placed',
			from: '2001-01-01',
			to: '2001-01-02',
			page: 1,
			pageSize: 50,
		});
		expect(none.orders.some((row) => row.id === `${P}a`)).toBe(false);
	});

	it('records a gateway payment once however often it is reported', async () => {
		const payments = new MongoOrderPaymentRepository();
		const payment = OrderPayment.parse({
			id: `${P}pay1`,
			orderId: `${P}a`,
			method: 'gateway',
			state: 'received',
			amountINR: 100,
			currency: 'INR',
			amount: 100,
			reference: 'ref',
			gateway: { id: 'ccavenue', attemptId: 'att', reference: `${P}gw1` },
			receivedOn: now.slice(0, 10),
			recordedBy: null,
			recordedAt: now,
		});
		await payments.save(payment);
		await expect(payments.save({ ...payment, id: `${P}pay2` })).rejects.toThrow();
		expect((await payments.findByGatewayReference('ccavenue', `${P}gw1`))?.id).toBe(`${P}pay1`);
	});

	it('counts a payment saved earlier in the same transaction when the order is read again', async () => {
		const payments = new MongoOrderPaymentRepository();
		const transactions = new MongoTransactionManager();
		const seen = await transactions.withTransaction(async (context) => {
			await payments.save(
				OrderPayment.parse({
					id: `${P}pay-tx`,
					orderId: `${P}tx-order`,
					method: 'upi',
					state: 'received',
					amountINR: 500,
					currency: 'INR',
					amount: 500,
					reference: 'UTR-TX',
					receivedOn: now.slice(0, 10),
					recordedBy: null,
					recordedAt: now,
				}),
				context,
			);
			// No context passed: the read joins the transaction on the call stack, as settle() does.
			return (await payments.listByOrder(`${P}tx-order`)).map((row) => row.id);
		});
		expect(seen).toEqual([`${P}pay-tx`]);
	});

	it('finds a payment request by its token hash only', async () => {
		const requests = new MongoPaymentRequestRepository();
		await requests.save(
			PaymentRequest.parse({
				id: `${P}q1`,
				orderId: `${P}a`,
				number: 'ST-1/Q1',
				gateway: 'ccavenue',
				currency: 'INR',
				amount: 100,
				amountINR: 100,
				rateFromINR: 1,
				markupPercent: 0,
				gatewayRequestId: null,
				gatewayUrl: null,
				tokenHash: `${P}hash`,
				sentTo: { email: null, mobile: null },
				expiresAt: '2001-01-01T00:00:00Z',
				status: 'active',
				createdBy: 'adm',
				createdAt: now,
			}),
		);
		expect((await requests.findByTokenHash(`${P}hash`))?.id).toBe(`${P}q1`);
		expect((await requests.listExpired(new Date(), 500)).some((row) => row.id === `${P}q1`)).toBe(true);
	});

	it('keeps a business as a supplier for purchases and adds the customer side', async () => {
		const businesses = new MongoBusinessRepository();
		await SupplierModel.create([
			{
				_id: `${P}sup`,
				legalName: `${P} Weavers`,
				shortName: 'W',
				kind: 'unregistered',
				stateCode: '19',
				stateName: 'West Bengal',
				address: { line: 'x', city: 'y', pin: '700001' },
				active: true,
				deletedAt: null,
				phone: '9830012345',
			},
		]);
		const business = await businesses.findById(`${P}sup`);
		const saved = await businesses.save(
			{
				...(business as NonNullable<typeof business>),
				roles: {
					supplier: true,
					customer: {
						zoneId: 'zone_retail',
						creditLimitINR: 1000,
						creditDays: 30,
						standing: 'active',
						standingReason: null,
						standingBy: null,
						standingAt: null,
					},
				},
			},
			0,
		);
		expect(saved.revision).toBe(1);
		expect((await businesses.searchBuyers(`${P} Weav`, 5)).map((row) => row.id)).toContain(`${P}sup`);
		const raw = await SupplierModel.findById(`${P}sup`).lean<Record<string, unknown>>().exec();
		expect(raw).toMatchObject({ legalName: `${P} Weavers`, address: { line: 'x' } });
		await expect(businesses.save(saved, 0)).rejects.toBeInstanceOf(StaleRevisionError);
	});

	it('sums each account on its own side', async () => {
		const ledger = new MongoLedgerRepository();
		const entry = (id: string, side: 'receivable' | 'payable', amountINR: number) =>
			LedgerEntry.parse({
				id: `${P}${id}`,
				businessId: `${P}sup`,
				side,
				kind: 'orderOnAccount',
				amountINR,
				documentType: 'order',
				documentId: 'o',
				at: now,
				by: 'adm',
			});
		await ledger.append(entry('l1', 'receivable', 5000));
		await ledger.append(entry('l2', 'receivable', -2000));
		await ledger.append(entry('l3', 'payable', 700));
		expect(await ledger.balance(`${P}sup`, 'receivable')).toBe(3000);
		expect(await ledger.balance(`${P}sup`, 'payable')).toBe(700);
	});

	it('saves zones with a revision and never deletes a system zone', async () => {
		const zones = new MongoPriceZoneRepository();
		const zone = PriceZone.parse({ id: `${P}z`, code: `Z${Date.now() % 100000}`, name: 'Wholesale', system: true });
		await zones.save(zone, null);
		await zones.delete(`${P}z`);
		expect(await zones.findById(`${P}z`)).not.toBeNull();
	});

	it('counts coupon uses and refuses past the total', async () => {
		const coupons = new MongoCouponRepository();
		const coupon = Coupon.parse({
			id: `${P}c`,
			code: `C${Date.now() % 100000}`,
			title: 'T',
			kind: 'percentOff',
			value: 10,
			totalUses: 1,
		});
		await coupons.save(coupon, null);
		await coupons.recordUse(`${P}c`, 'cus_1', `${P}o1`);
		await expect(coupons.recordUse(`${P}c`, 'cus_2', `${P}o2`)).rejects.toBeInstanceOf(CouponUsedUpError);
		expect(await coupons.usesBy(`${P}c`, 'cus_1')).toBe(1);
		expect(await coupons.setEnabled([`${P}c`], false, 'adm')).toEqual([`${P}c`]);
		expect((await coupons.findById(`${P}c`))?.enabled).toBe(false);
		expect(await coupons.delete([`${P}c`])).toEqual([`${P}c`]);
		expect(await coupons.findById(`${P}c`)).toBeNull();
	});
});
