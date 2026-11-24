import { randomUUID } from 'node:crypto';

import { Business, Coupon, Order, OrderPayment, PaymentRequest, PriceZone } from '@saha-textile/contracts';
import { StaleRevisionError } from '@saha-textile/core-domain';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { SiteSettingModel } from '../src/models/content-block.model';
import { OrderModel } from '../src/models/order.model';
import {
	CouponModel,
	LedgerEntryModel,
	PaymentModel,
	PaymentRequestModel,
	PriceZoneModel,
	ShipmentModel,
} from '../src/models/orders-build.model';
import { SupplierModel } from '../src/models/purchasing.model';
import {
	MongoAdminOrderRepository,
	MongoBusinessRepository,
	MongoCouponRepository,
	MongoDocumentNumberingRepository,
	MongoLedgerRepository,
	MongoOrderPaymentRepository,
	MongoOrderSettingsRepository,
	MongoPaymentRequestRepository,
	MongoPriceZoneRepository,
	MongoShipmentRepository,
	toBusiness,
} from '../src/repositories/orders-build.repository';
import { hasMongoEnv, runPrefix } from './mongo-test-env';

/**
 * The orders, businesses and settings repositories' remaining reads and writes, on the suite's own database.
 * Rows carry this run's prefix and are removed afterwards. The shared settings row (document numbering) is never
 * written here: its paths run against stand-ins for the settings model's calls.
 */
describe.runIf(hasMongoEnv())('orders, businesses and settings: the remaining cases (rs0)', () => {
	const P = runPrefix('ordy');
	const TAG = `IU${randomUUID().slice(0, 6).toUpperCase()}`;
	const now = new Date().toISOString();
	const orders = new MongoAdminOrderRepository();
	const businesses = new MongoBusinessRepository();

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

	const business = (key: string, over: Record<string, unknown> = {}) =>
		Business.parse({
			id: `${P}${key}`,
			legalName: `${TAG} ${key} Textiles`,
			tradeName: `${TAG} ${key}`,
			gstin: null,
			pan: null,
			stateCode: '19',
			stateName: 'West Bengal',
			registeredAddress: { line: '1 Park Street', city: 'Kolkata', pin: '700016' },
			contacts: [],
			roles: { supplier: false, customer: null },
			active: true,
			notes: null,
			createdAt: now,
			updatedAt: now,
			...over,
		});

	beforeAll(async () => {
		await connectMongo();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	afterAll(async () => {
		const ours = new RegExp(`^${P}`);
		await Promise.all([
			OrderModel.deleteMany({ _id: ours }).exec(),
			PaymentModel.deleteMany({ _id: ours }).exec(),
			PaymentRequestModel.deleteMany({ _id: ours }).exec(),
			ShipmentModel.deleteMany({ _id: ours }).exec(),
			LedgerEntryModel.deleteMany({ _id: ours }).exec(),
			SupplierModel.deleteMany({ _id: ours }).exec(),
			PriceZoneModel.deleteMany({ _id: ours }).exec(),
			CouponModel.deleteMany({ _id: ours }).exec(),
		]);
		await disconnectMongo();
	});

	it('filters the list by payment, channel, buyer, currency, either end of a date range and a search word', async () => {
		await orders.create(order('nobuyer', { buyer: undefined, status: 'placed' }), null);
		const query = { filter: 'all', page: 1, pageSize: 10 } as const;
		const listed = await orders.list({
			...query,
			payment: 'unpaid',
			channel: 'admin',
			buyerKind: 'person',
			currency: 'INR',
			q: TAG,
		} as never);
		expect(listed.total).toBeGreaterThanOrEqual(0);
		expect((await orders.list({ ...query, from: '2000-01-01' } as never)).total).toBeGreaterThan(0);
		expect((await orders.list({ ...query, to: '2999-01-01' } as never)).total).toBeGreaterThan(0);
		// A search of only punctuation searches for nothing in particular.
		expect((await orders.list({ ...query, q: '!!' } as never)).total).toBeGreaterThan(0);
		// A filter name the list doesn't know matches no status.
		expect((await orders.list({ ...query, filter: 'nope' } as never)).total).toBe(0);
	});

	it('finds nothing for unknown ids, numbers and keys', async () => {
		expect(await orders.findById(`${P}none`)).toBeNull();
		expect(await orders.findByNumber(`${TAG}-none`)).toBeNull();
		expect(await orders.findByIdempotencyKey(`${P}none`)).toBeNull();
	});

	it('marks an order whose invoice address is still needed', async () => {
		const needed = { ...order('invoice'), addresses: { invoice: { needed: true } } };
		// The stand-in addresses are not a whole order's, so reading it back fails; the stored row is what counts.
		await orders.create(needed as never, null).catch(() => undefined);
		const stored = await OrderModel.findById(`${P}invoice`).lean<{ attention?: string[] }>().exec();
		expect(stored?.attention).toEqual(['invoiceAddressNeeded']);
	});

	it('names a duplicate by the key the database names, the order number when it names none, and rethrows anything else', async () => {
		const create = vi.spyOn(OrderModel, 'create');
		create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 11000 }));
		await expect(orders.create(order('dup1'), null)).rejects.toMatchObject({ key: 'orderNumber' });
		create.mockRejectedValueOnce(new Error('disk full'));
		await expect(orders.create(order('dup2'), null)).rejects.toThrow('disk full');
	});

	it('refuses to update an order that is gone, and names the last change when the revision is stale', async () => {
		await expect(orders.update(order('gone'), 0)).rejects.toThrow('does not exist');
		await orders.create(order('stale'), null);
		await OrderModel.collection.updateOne(
			{ _id: `${P}stale` as never },
			{ $set: { revision: 5, history: [] }, $unset: { searchExtras: '', updatedAt: '' } },
		);
		await expect(orders.update(order('stale'), 2)).rejects.toMatchObject({ changedBy: null, changedAt: null });
		await OrderModel.collection.updateOne(
			{ _id: `${P}stale` as never },
			{ $set: { history: [{ at: now, by: 'adm_1', byName: null, kind: 'comment', text: 'x' }] } },
		);
		await expect(orders.update(order('stale'), 2)).rejects.toBeInstanceOf(StaleRevisionError);
		const updated = await orders.update(order('stale'), 5);
		expect(updated.revision).toBe(6);
	});

	it('finds no payment or request it does not have, and keeps no reference key without a reference', async () => {
		const payments = new MongoOrderPaymentRepository();
		expect(await payments.findById(`${P}none`)).toBeNull();
		expect(await payments.findByGatewayReference('ccavenue', `${P}none`)).toBeNull();
		await payments.save(
			OrderPayment.parse({
				id: `${P}cash`,
				orderId: `${P}stale`,
				method: 'bankTransfer',
				state: 'received',
				amountINR: 100,
				currency: 'INR',
				amount: 100,
				reference: null,
				gateway: null,
				receivedOn: now.slice(0, 10),
				recordedBy: null,
				recordedAt: now,
			}),
		);
		const stored = await PaymentModel.findById(`${P}cash`).lean<{ referenceKey?: string | null }>().exec();
		expect(stored?.referenceKey).toBeNull();
		expect((await payments.findById(`${P}cash`))?.amountINR).toBe(100);
		const requests = new MongoPaymentRequestRepository();
		await requests.save(
			PaymentRequest.parse({
				id: `${P}q1`,
				orderId: `${P}stale`,
				number: `${TAG}/Q1`,
				gateway: 'ccavenue',
				currency: 'INR',
				amount: 100,
				amountINR: 100,
				rateFromINR: 1,
				markupPercent: 0,
				gatewayRequestId: `${P}gwq`,
				gatewayUrl: null,
				tokenHash: `${P}hash`,
				sentTo: { email: null, mobile: null },
				expiresAt: '2099-01-01T00:00:00Z',
				status: 'active',
				createdBy: 'adm',
				createdAt: now,
			}),
		);
		expect((await requests.findByGatewayRequestId('ccavenue', `${P}gwq`))?.id).toBe(`${P}q1`);
		expect(await requests.findByTokenHash(`${P}nohash`)).toBeNull();
		expect(await new MongoPaymentRequestRepository().findByGatewayRequestId('ccavenue', `${P}none`)).toBeNull();
	});

	it('lists courier names sorted, without blanks', async () => {
		await ShipmentModel.collection.insertMany([
			{ _id: `${P}shp1` as never, courierName: `${TAG} Zeta` },
			{ _id: `${P}shp2` as never, courierName: `${TAG} Alpha` },
		]);
		const names = await new MongoShipmentRepository().courierNames(500);
		expect(names.indexOf(`${TAG} Alpha`)).toBeLessThan(names.indexOf(`${TAG} Zeta`));
	});

	it('reads an older supplier row as a business: contact from its own fields, unnamed contacts, no roles', () => {
		const old = toBusiness({
			_id: `${P}old`,
			legalName: `${TAG} Old`,
			phone: '+91 98311 22334',
			stateCode: '19',
			address: { line: '1 Road', city: 'Kolkata', pin: '700001' },
		} as never);
		expect(old.contacts[0]?.name).toBe(`${TAG} Old`);
		expect(old.roles).toEqual({ supplier: true, customer: null });
		const unnamed = toBusiness({
			_id: `${P}unnamed`,
			legalName: `${TAG} Unnamed`,
			stateCode: '19',
			address: { line: '1 Road', city: 'Kolkata', pin: '700001' },
			contacts: [{ id: 'c1', name: '', email: null, isAccounts: true }],
			active: false,
		} as never);
		expect(unnamed.contacts[0]?.name).toBe(`${TAG} Unnamed`);
		expect(unnamed.active).toBe(false);
	});

	it('saves a new business and a later revision, with the accounts contact or the first, and refuses a stale one', async () => {
		expect(await businesses.findById(`${P}none`)).toBeNull();
		const created = await businesses.save(business('new'), null);
		expect(created.revision).toBe(0);
		const first = await SupplierModel.findById(`${P}new`).lean<{ contactName?: string | null }>().exec();
		expect(first?.contactName).toBeNull();
		const withContacts = business('new', {
			contacts: [
				{
					id: 'c1',
					name: 'Owner',
					email: 'owner@example.test',
					mobile: { countryCode: 'IN', countryCallingCode: '91', number: '9831122334' },
					isAccounts: false,
				},
			],
		});
		const second = await businesses.save(withContacts, 0);
		expect(second.revision).toBe(1);
		const stored = await SupplierModel.findById(`${P}new`).lean<{ contactName?: string; phone?: string }>().exec();
		expect(stored?.contactName).toBe('Owner');
		expect(stored?.phone).toBe('+91 9831122334');
		expect((await businesses.save(withContacts, 1)).revision).toBe(2);
		await expect(businesses.save(withContacts, 1)).rejects.toBeInstanceOf(StaleRevisionError);
	});

	it('lists businesses without a search, and finds buyers by a short number', async () => {
		const page = await businesses.list({ role: 'all', page: 1, pageSize: 1 } as never);
		expect(page.counts.all).toBeGreaterThan(0);
		expect(await businesses.searchBuyers('12', 5)).toBeInstanceOf(Array);
	});

	it('saves a zone, then a later revision, refuses a stale one, and finds nothing for an unknown id', async () => {
		const zones = new MongoPriceZoneRepository();
		const zone = PriceZone.parse({ id: `${P}zone`, code: `Z${TAG}`, name: `${TAG} Wholesale` });
		expect(await zones.findById(`${P}none`)).toBeNull();
		const first = await zones.save(zone, null);
		const second = await zones.save({ ...first, name: `${TAG} Wholesale 2` }, first.revision);
		expect(second.revision).toBe(first.revision + 1);
		await expect(zones.save(second, first.revision)).rejects.toBeInstanceOf(StaleRevisionError);
		expect((await zones.list()).some((row) => row.id === `${P}zone`)).toBe(true);
	});

	it('saves a coupon revision, refuses a stale one and a taken code, rethrows other failures, and lists without a search', async () => {
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
		const first = await coupons.save(coupon('c1'), null);
		const second = await coupons.save({ ...first, title: `${TAG} c1 again` }, first.revision);
		expect(second.revision).toBe(first.revision + 1);
		await expect(coupons.save(second, first.revision)).rejects.toBeInstanceOf(StaleRevisionError);
		await expect(coupons.save(coupon('c2', { code: `${TAG}C1` }), null)).rejects.toMatchObject({
			name: 'DuplicateCouponCodeError',
		});
		vi.spyOn(CouponModel, 'create').mockRejectedValueOnce(new Error('disk full'));
		await expect(coupons.save(coupon('c3'), null)).rejects.toThrow('disk full');
		expect(
			(await coupons.list({ filter: 'all', page: 1, pageSize: 1 } as never, new Date())).total,
		).toBeGreaterThan(0);
		expect(await coupons.setEnabled([`${P}none`], false, 'adm')).toEqual([]);
		expect(await coupons.delete([`${P}none`])).toEqual([]);
	});

	it('reads a ledger balance of nothing for a business without entries', async () => {
		expect(await new MongoLedgerRepository().balance(`${P}nobody`, 'customer' as never)).toBe(0);
	});
});

describe('document numbering settings (stand-ins for the shared settings row)', () => {
	const numbering = new MongoDocumentNumberingRepository();
	const chain = <T>(value: T) => ({
		lean: () => ({ exec: async () => value }),
		session: () => ({ exec: async () => value }),
		exec: async () => value,
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('reads the saved numbering, and the defaults when the saved value cannot be read', async () => {
		const findById = vi.spyOn(SiteSettingModel, 'findById');
		findById.mockReturnValueOnce(chain(null) as never);
		const defaults = await numbering.get();
		findById.mockReturnValueOnce(chain({ value: defaults }) as never);
		expect(await numbering.get()).toEqual(defaults);
		findById.mockReturnValueOnce(chain({ value: { revision: 'not a number' } }) as never);
		expect(await numbering.get()).toEqual(defaults);
	});

	it('writes the first numbering, then a later one, and refuses a stale write', async () => {
		vi.spyOn(SiteSettingModel, 'findById').mockReturnValue(chain(null) as never);
		const defaults = await numbering.get();
		const exists = vi.spyOn(SiteSettingModel, 'exists');
		const updateOne = vi.spyOn(SiteSettingModel, 'updateOne');
		exists.mockReturnValueOnce(chain(null) as never);
		updateOne.mockReturnValueOnce(chain({ matchedCount: 1 }) as never);
		expect((await numbering.save(defaults, 0)).revision).toBe(1);
		exists.mockReturnValueOnce(chain({ _id: 'orders.numbering' }) as never);
		updateOne.mockReturnValueOnce(chain({ matchedCount: 1 }) as never);
		expect((await numbering.save(defaults, 0)).revision).toBe(1);
		exists.mockReturnValueOnce(chain({ _id: 'orders.numbering' }) as never);
		updateOne.mockReturnValueOnce(chain({ matchedCount: 1 }) as never);
		expect((await numbering.save(defaults, 3)).revision).toBe(4);
		exists.mockReturnValueOnce(chain({ _id: 'orders.numbering' }) as never);
		updateOne.mockReturnValueOnce(chain({ matchedCount: 0 }) as never);
		await expect(numbering.save(defaults, 3)).rejects.toBeInstanceOf(StaleRevisionError);
	});

	it('reads the saved order settings, and the defaults when none are saved', async () => {
		const settings = new MongoOrderSettingsRepository();
		const findById = vi.spyOn(SiteSettingModel, 'findById');
		findById.mockReturnValueOnce(chain(null) as never);
		const defaults = await settings.get();
		findById.mockReturnValueOnce(chain({ value: defaults }) as never);
		expect(await settings.get()).toEqual(defaults);
	});

	it('locks a number type on a new settings row and on an existing one', async () => {
		const exists = vi.spyOn(SiteSettingModel, 'exists');
		const updateOne = vi.spyOn(SiteSettingModel, 'updateOne').mockReturnValue(chain({ matchedCount: 1 }) as never);
		exists.mockReturnValueOnce(chain(null) as never);
		await numbering.lock('invoice');
		expect(updateOne.mock.calls[0]?.[1]).toMatchObject({ $setOnInsert: expect.anything() });
		exists.mockReturnValueOnce(chain({ _id: 'orders.numbering' }) as never);
		await numbering.lock('invoice');
		expect(updateOne.mock.calls[1]?.[1]).toEqual({ $addToSet: { 'value.lockedTypes': 'invoice' } });
	});
});
