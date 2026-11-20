import {
	Business,
	Coupon,
	DEFAULT_DOCUMENT_NUMBERING,
	DocumentNumberingSettings,
	LedgerEntry,
	OrderPayment,
	OrderSettings,
	PaymentRequest,
	PriceZone,
	Shipment,
	ZonePricingSettings,
	type BusinessListQuery,
	type CouponListQuery,
	type CouponListResponse,
	type LedgerSide,
	type Order,
	type OrderListQuery,
	type SiteSettingKey,
} from '@saha-textile/contracts';
import {
	StaleRevisionError,
	normalizeForSearch,
	type AdminOrderRepository,
	type BusinessRepository,
	type CouponRepository,
	type DocumentNumberingRepository,
	type LedgerRepository,
	type OrderPaymentRepository,
	type OrderSettingsRepository,
	type PaymentRequestRepository,
	type PriceZoneRepository,
	type ShipmentRepository,
	type TransactionContext,
} from '@saha-textile/core-domain';
import type { QueryFilter } from 'mongoose';

import { toOrder } from '../mappers';
import {
	CouponModel,
	CouponUseModel,
	LedgerEntryModel,
	OrderModel,
	PaymentModel,
	PaymentRequestModel,
	PriceZoneModel,
	ShipmentModel,
	SiteSettingModel,
	SupplierModel,
	type OrderDoc,
	type OrdersBuildDoc,
} from '../models/index';
import { sessionFrom } from '../transaction-manager';

type FilterQuery<T> = QueryFilter<T>;

/**
 * Mongo adapters for the orders and checkout build (brief v2.1, approved 2026-11-20). Records are
 * stored in their contract's shape with `_id` for `id` and parsed with zod on read; every change
 * names the revision it was made from, and a save over a newer one is refused (`StaleRevisionError`).
 */

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function toDoc<T extends { id: string }>(value: T): OrdersBuildDoc {
	const { id, ...rest } = value;
	return { _id: id, ...rest };
}

function fromDoc(doc: OrdersBuildDoc | null): Record<string, unknown> | null {
	if (!doc) return null;
	const { _id, ...rest } = doc;
	return { id: _id, ...rest };
}

/** India midnight of a `YYYY-MM-DD` day, as an instant. */
const indiaDayStart = (day: string): Date => new Date(`${day}T00:00:00+05:30`);

/** Thrown when an order number (or its stripped form) or an idempotency key already exists. */
export class DuplicateOrderKeyError extends Error {
	constructor(readonly key: 'orderNumber' | 'idempotencyKey') {
		super(`Duplicate order ${key}`);
		this.name = 'DuplicateOrderKeyError';
	}
}

/** Thrown when a coupon has reached its total uses. */
export class CouponUsedUpError extends Error {
	constructor(readonly couponId: string) {
		super(`Coupon ${couponId} has no uses left`);
		this.name = 'CouponUsedUpError';
	}
}

/** Thrown when a coupon code is already taken by another coupon. */
export class DuplicateCouponCodeError extends Error {
	constructor(readonly code: string) {
		super(`Coupon code ${code} is taken`);
		this.name = 'DuplicateCouponCodeError';
	}
}

/* ---------------------------------------------------------------------------------------------- */
/* Orders                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

/** Search words an order is found by: its number in every form, the buyer, extra references. */
export function orderSearchKeys(order: Order, extra: readonly string[] = []): string[] {
	const keys = new Set<string>();
	const add = (text: string | null | undefined): void => {
		const key = normalizeForSearch(text ?? '');
		if (key.length >= 2) keys.add(key);
	};
	add(order.orderNumber);
	add(order.orderNumber.replace(/^[A-Za-z]+/, ''));
	const buyer = order.buyer;
	if (buyer) {
		add(buyer.name);
		for (const word of buyer.name.split(/\s+/)) add(word);
		if (buyer.email) {
			add(buyer.email);
			add(buyer.email.split('@')[0]);
		}
		if (buyer.mobile) {
			add(buyer.mobile.number);
			add(`${buyer.mobile.countryCallingCode}${buyer.mobile.number}`);
		}
		add(buyer.gstin);
	}
	for (const text of extra) add(text);
	return [...keys];
}

export interface OrderWriteMeta {
	searchExtras?: readonly string[];
	attention?: readonly string[];
}

function orderSetFields(
	order: Order,
	meta: OrderWriteMeta,
	existingExtras: readonly string[],
): Record<string, unknown> {
	const { id, ...rest } = order;
	void id;
	const extras = [...new Set([...existingExtras, ...(meta.searchExtras ?? [])])];
	return {
		...rest,
		orderNumberKey: normalizeForSearch(order.orderNumber),
		searchKeys: orderSearchKeys(order, extras),
		searchExtras: extras,
		attention: [...(meta.attention ?? (order.addresses?.invoice.needed ? ['invoiceAddressNeeded'] : []))],
	};
}

const STATUS_BY_FILTER: Readonly<Record<string, readonly string[]>> = {
	open: ['open'],
	awaitingPayment: ['awaiting_payment', 'pending'],
	placed: ['placed', 'paid'],
	processing: ['processing'],
	packed: ['packed'],
	shipped: ['shipped', 'out_for_delivery'],
	delivered: ['delivered'],
	cancelled: ['cancelled', 'refunded'],
};

function baseOrderFilter(query: OrderListQuery): FilterQuery<OrderDoc> {
	const filter: FilterQuery<OrderDoc> = {};
	if (query.payment) filter.paymentStatus = query.payment;
	if (query.channel) filter.channel = query.channel;
	if (query.buyerKind) filter['buyer.kind'] = query.buyerKind;
	if (query.currency) filter.currency = query.currency;
	if (query.from || query.to) {
		const range: Record<string, Date> = {};
		if (query.from) range.$gte = indiaDayStart(query.from);
		if (query.to) range.$lt = new Date(indiaDayStart(query.to).getTime() + 86_400_000);
		filter.createdAt = range;
	}
	if (query.q) {
		const key = normalizeForSearch(query.q);
		if (key) filter.searchKeys = { $regex: `^${escapeRegex(key)}` };
	}
	return filter;
}

function withListFilter(base: FilterQuery<OrderDoc>, listFilter: string): FilterQuery<OrderDoc> {
	if (listFilter === 'all') return base;
	if (listFilter === 'needsAttention') return { ...base, 'attention.0': { $exists: true } };
	return { ...base, status: { $in: [...(STATUS_BY_FILTER[listFilter] ?? [])] } };
}

export class MongoAdminOrderRepository implements AdminOrderRepository {
	async findById(id: string): Promise<Order | null> {
		const doc = await OrderModel.findById(id).lean<OrderDoc>().exec();
		return doc ? toOrder(doc) : null;
	}

	async findByNumber(number: string): Promise<Order | null> {
		const doc = await OrderModel.findOne({
			$or: [{ orderNumber: number }, { orderNumberKey: normalizeForSearch(number) }],
		})
			.lean<OrderDoc>()
			.exec();
		return doc ? toOrder(doc) : null;
	}

	async findByIdempotencyKey(key: string): Promise<Order | null> {
		const doc = await OrderModel.findOne({ idempotencyKey: key }).lean<OrderDoc>().exec();
		return doc ? toOrder(doc) : null;
	}

	async create(
		order: Order,
		idempotencyKey: string | null,
		context?: TransactionContext,
		meta: OrderWriteMeta = {},
	): Promise<Order> {
		const fields = orderSetFields(order, meta, []);
		try {
			await OrderModel.create([{ _id: order.id, ...fields, ...(idempotencyKey ? { idempotencyKey } : {}) }], {
				session: sessionFrom(context),
			});
		} catch (error) {
			const duplicate = error as { code?: number; keyPattern?: Record<string, unknown> };
			if (duplicate?.code === 11000) {
				const key = Object.keys(duplicate.keyPattern ?? {})[0];
				throw new DuplicateOrderKeyError(key === 'idempotencyKey' ? 'idempotencyKey' : 'orderNumber');
			}
			throw error;
		}
		const saved = await OrderModel.findById(order.id)
			.session(sessionFrom(context) ?? null)
			.lean<OrderDoc>()
			.exec();
		return toOrder(saved as OrderDoc);
	}

	async update(
		order: Order,
		expectedRevision: number,
		context?: TransactionContext,
		meta: OrderWriteMeta = {},
	): Promise<Order> {
		const session = sessionFrom(context);
		const current = await OrderModel.findById(order.id)
			.session(session ?? null)
			.lean<OrderDoc & { searchExtras?: string[] }>()
			.exec();
		if (!current) throw new Error(`Order ${order.id} does not exist`);
		const fields = orderSetFields({ ...order, revision: expectedRevision + 1 }, meta, current.searchExtras ?? []);
		const result = await OrderModel.updateOne(
			{ _id: order.id, revision: expectedRevision === 0 ? { $in: [0, null] } : expectedRevision },
			{ $set: fields },
			{ session },
		).exec();
		if (result.matchedCount === 0) {
			const latest = toOrder(current);
			const last = latest.history.at(-1);
			throw new StaleRevisionError(
				'order',
				order.id,
				last?.byName ?? last?.by ?? null,
				last?.at ?? latest.updatedAt ?? null,
			);
		}
		const saved = await OrderModel.findById(order.id)
			.session(session ?? null)
			.lean<OrderDoc>()
			.exec();
		return toOrder(saved as OrderDoc);
	}

	async list(query: OrderListQuery): Promise<{ orders: Order[]; total: number }> {
		const filter = withListFilter(baseOrderFilter(query), query.filter);
		const skip = (query.page - 1) * query.pageSize;
		const [docs, total] = await Promise.all([
			OrderModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.pageSize).lean<OrderDoc[]>().exec(),
			OrderModel.countDocuments(filter).exec(),
		]);
		return { orders: docs.map(toOrder), total };
	}

	async counts(query: OrderListQuery): Promise<Record<string, number>> {
		const base = baseOrderFilter(query);
		const filters = ['all', 'needsAttention', ...Object.keys(STATUS_BY_FILTER)];
		const counts = await Promise.all(
			filters.map((name) => OrderModel.countDocuments(withListFilter(base, name)).exec()),
		);
		const out: Record<string, number> = Object.fromEntries(
			filters.map((name, index) => [name, counts[index] ?? 0]),
		);
		out.toPack = await OrderModel.countDocuments({
			...base,
			status: { $in: ['placed', 'paid', 'processing'] },
		}).exec();
		return out;
	}

	async listOpenOnAccount(businessId: string): Promise<Array<{ orderId: string; dueINR: number; placedAt: string }>> {
		const docs = await OrderModel.find({
			'buyer.businessId': businessId,
			'balance.dueINR': { $gt: 0 },
			status: { $ne: 'cancelled' },
		})
			.sort({ createdAt: 1 })
			.lean<Array<OrderDoc & { balance?: { dueINR?: number } }>>()
			.exec();
		return docs.map((doc) => ({
			orderId: doc._id,
			dueINR: Number(doc.balance?.dueINR ?? 0),
			placedAt: (doc.createdAt ?? new Date(0)).toISOString(),
		}));
	}

	async countPlacedByCustomer(customerId: string): Promise<number> {
		return OrderModel.countDocuments({
			$or: [{ 'buyer.customerId': customerId }, { userId: customerId }],
			status: { $in: ['placed', 'paid', 'processing', 'packed', 'shipped', 'out_for_delivery', 'delivered'] },
		}).exec();
	}
}

/* ---------------------------------------------------------------------------------------------- */
/* Payments, requests, shipments                                                                   */
/* ---------------------------------------------------------------------------------------------- */

export class MongoOrderPaymentRepository implements OrderPaymentRepository {
	async listByOrder(orderId: string): Promise<OrderPayment[]> {
		const docs = await PaymentModel.find({ orderId }).sort({ recordedAt: 1 }).lean<OrdersBuildDoc[]>().exec();
		return docs.map((doc) => OrderPayment.parse(fromDoc(doc)));
	}

	async findById(id: string): Promise<OrderPayment | null> {
		const doc = fromDoc(await PaymentModel.findById(id).lean<OrdersBuildDoc>().exec());
		return doc ? OrderPayment.parse(doc) : null;
	}

	async findByGatewayReference(gateway: string, reference: string): Promise<OrderPayment | null> {
		const doc = fromDoc(
			await PaymentModel.findOne({ gatewayKey: `${gateway}:${reference}` })
				.lean<OrdersBuildDoc>()
				.exec(),
		);
		return doc ? OrderPayment.parse(doc) : null;
	}

	async save(payment: OrderPayment, context?: TransactionContext): Promise<OrderPayment> {
		const parsed = OrderPayment.parse(payment);
		const { _id, ...rest } = toDoc(parsed);
		const gatewayKey = parsed.gateway?.reference ? `${parsed.gateway.id}:${parsed.gateway.reference}` : null;
		await PaymentModel.updateOne(
			{ _id },
			{
				$set: {
					...rest,
					gatewayKey,
					referenceKey: parsed.reference ? normalizeForSearch(parsed.reference) : null,
				},
			},
			{ upsert: true, session: sessionFrom(context) },
		).exec();
		return parsed;
	}
}

export class MongoPaymentRequestRepository implements PaymentRequestRepository {
	async listByOrder(orderId: string): Promise<PaymentRequest[]> {
		const docs = await PaymentRequestModel.find({ orderId }).sort({ createdAt: 1 }).lean<OrdersBuildDoc[]>().exec();
		return docs.map((doc) => PaymentRequest.parse(fromDoc(doc)));
	}

	async findById(id: string): Promise<PaymentRequest | null> {
		const doc = fromDoc(await PaymentRequestModel.findById(id).lean<OrdersBuildDoc>().exec());
		return doc ? PaymentRequest.parse(doc) : null;
	}

	async findByTokenHash(tokenHash: string): Promise<PaymentRequest | null> {
		const doc = fromDoc(await PaymentRequestModel.findOne({ tokenHash }).lean<OrdersBuildDoc>().exec());
		return doc ? PaymentRequest.parse(doc) : null;
	}

	async findByGatewayRequestId(gateway: string, gatewayRequestId: string): Promise<PaymentRequest | null> {
		const doc = fromDoc(
			await PaymentRequestModel.findOne({ gatewayKey: `${gateway}:${gatewayRequestId}` })
				.lean<OrdersBuildDoc>()
				.exec(),
		);
		return doc ? PaymentRequest.parse(doc) : null;
	}

	async save(request: PaymentRequest, context?: TransactionContext): Promise<PaymentRequest> {
		const parsed = PaymentRequest.parse(request);
		const { _id, ...rest } = toDoc(parsed);
		const gatewayKey = parsed.gatewayRequestId ? `${parsed.gateway}:${parsed.gatewayRequestId}` : null;
		await PaymentRequestModel.updateOne(
			{ _id },
			{ $set: { ...rest, gatewayKey } },
			{ upsert: true, session: sessionFrom(context) },
		).exec();
		return parsed;
	}

	async listExpired(now: Date, limit: number): Promise<PaymentRequest[]> {
		const docs = await PaymentRequestModel.find({ status: 'active', expiresAt: { $lte: now.toISOString() } })
			.limit(limit)
			.lean<OrdersBuildDoc[]>()
			.exec();
		return docs.map((doc) => PaymentRequest.parse(fromDoc(doc)));
	}
}

export class MongoShipmentRepository implements ShipmentRepository {
	async listByOrder(orderId: string): Promise<Shipment[]> {
		const docs = await ShipmentModel.find({ orderId }).sort({ createdAt: 1 }).lean<OrdersBuildDoc[]>().exec();
		return docs.map((doc) => Shipment.parse(fromDoc(doc)));
	}

	async save(shipment: Shipment, context?: TransactionContext): Promise<Shipment> {
		const parsed = Shipment.parse(shipment);
		const { _id, ...rest } = toDoc(parsed);
		await ShipmentModel.updateOne(
			{ _id },
			{ $set: { ...rest, trackingKey: normalizeForSearch(parsed.trackingNumber) } },
			{ upsert: true, session: sessionFrom(context) },
		).exec();
		return parsed;
	}

	async courierNames(limit: number): Promise<string[]> {
		const names = (await ShipmentModel.distinct('courierName').exec()) as string[];
		return names
			.filter(Boolean)
			.sort((a, b) => a.localeCompare(b))
			.slice(0, limit);
	}
}

/* ---------------------------------------------------------------------------------------------- */
/* Businesses (the supplier record with the customer side)                                         */
/* ---------------------------------------------------------------------------------------------- */

/** A stored supplier row read as a business; older rows are suppliers only. */
export function toBusiness(doc: OrdersBuildDoc): Business {
	const row = doc as Record<string, unknown> & OrdersBuildDoc;
	const contacts =
		(row.contacts as unknown[] | undefined) ??
		(row.contactName || row.phone || row.email
			? [
					{
						id: `${doc._id}_contact`,
						name: String(row.contactName ?? row.legalName ?? ''),
						role: '',
						email: (row.email as string | null) ?? null,
						mobile: null,
						isAccounts: true,
					},
				]
			: []);
	return Business.parse({
		id: doc._id,
		legalName: row.legalName,
		tradeName: (row.tradeName as string | undefined) ?? (row.shortName as string | undefined) ?? '',
		businessType: row.businessType ?? 'other',
		gstin: row.gstin ?? null,
		pan: row.pan ?? null,
		stateCode: row.stateCode ?? '',
		stateName: row.stateName ?? '',
		registeredAddress: row.address ?? { line: '', city: '', pin: '000000' },
		addresses: row.addresses ?? [],
		contacts: contacts.map((contact) => ({
			...(contact as object),
			name: String((contact as { name?: unknown }).name || row.legalName),
		})),
		roles: row.roles ?? { supplier: true, customer: null },
		setOff: row.setOff ?? { mode: 'never' },
		active: row.active ?? true,
		notes: row.notes ?? null,
		revision: row.businessRevision ?? 0,
		createdAt: row.createdAt ?? new Date(0).toISOString(),
		updatedAt: row.updatedAt ?? new Date(0).toISOString(),
	});
}

export class MongoBusinessRepository implements BusinessRepository {
	async findById(id: string): Promise<Business | null> {
		const doc = await SupplierModel.findOne({ _id: id, deletedAt: null }).lean<OrdersBuildDoc>().exec();
		return doc ? toBusiness(doc) : null;
	}

	async list(
		query: BusinessListQuery,
	): Promise<{ items: Business[]; total: number; counts: Record<string, number> }> {
		const base: FilterQuery<OrdersBuildDoc> = { deletedAt: null };
		if (query.standing) base['roles.customer.standing'] = query.standing;
		if (query.zoneId) base['roles.customer.zoneId'] = query.zoneId;
		if (query.q) {
			const pattern = new RegExp(escapeRegex(query.q), 'i');
			base.$or = [
				{ legalName: pattern },
				{ shortName: pattern },
				{ tradeName: pattern },
				{ gstin: pattern },
				{ phone: pattern },
			];
		}
		const roleFilter = (role: string): FilterQuery<OrdersBuildDoc> => {
			const customer = { 'roles.customer': { $type: 'object' } };
			const supplier = { 'roles.supplier': { $ne: false } };
			if (role === 'customer') return { ...base, ...customer };
			if (role === 'supplier') return { ...base, ...supplier };
			if (role === 'both') return { ...base, ...customer, ...supplier };
			return base;
		};
		const filter = roleFilter(query.role);
		const skip = (query.page - 1) * query.pageSize;
		const [docs, total, all, customer, supplier, both] = await Promise.all([
			SupplierModel.find(filter)
				.sort({ legalName: 1 })
				.skip(skip)
				.limit(query.pageSize)
				.lean<OrdersBuildDoc[]>()
				.exec(),
			SupplierModel.countDocuments(filter).exec(),
			SupplierModel.countDocuments(roleFilter('all')).exec(),
			SupplierModel.countDocuments(roleFilter('customer')).exec(),
			SupplierModel.countDocuments(roleFilter('supplier')).exec(),
			SupplierModel.countDocuments(roleFilter('both')).exec(),
		]);
		return { items: docs.map(toBusiness), total, counts: { all, customer, supplier, both } };
	}

	async searchBuyers(q: string, limit: number): Promise<Business[]> {
		const text = q.trim();
		const pattern = new RegExp(escapeRegex(text), 'i');
		const digits = text.replace(/\D/g, '');
		const or: FilterQuery<OrdersBuildDoc>[] = [
			{ legalName: pattern },
			{ shortName: pattern },
			{ tradeName: pattern },
			{ gstin: new RegExp(`^${escapeRegex(text.toUpperCase())}`) },
		];
		if (digits.length >= 4) {
			or.push(
				{ phone: new RegExp(escapeRegex(digits)) },
				{ 'contacts.mobile.number': new RegExp(escapeRegex(digits)) },
			);
		}
		const docs = await SupplierModel.find({
			deletedAt: null,
			active: { $ne: false },
			'roles.customer': { $type: 'object' },
			$or: or,
		})
			.sort({ legalName: 1 })
			.limit(limit)
			.lean<OrdersBuildDoc[]>()
			.exec();
		return docs.map(toBusiness);
	}

	async save(business: Business, expectedRevision: number | null, context?: TransactionContext): Promise<Business> {
		const parsed = Business.parse(business);
		const session = sessionFrom(context);
		const accounts = parsed.contacts.find((contact) => contact.isAccounts) ?? parsed.contacts[0];
		// The supplier fields the purchases module reads stay in step with the business.
		const set: Record<string, unknown> = {
			legalName: parsed.legalName,
			shortName: parsed.tradeName,
			tradeName: parsed.tradeName,
			businessType: parsed.businessType,
			gstin: parsed.gstin,
			pan: parsed.pan,
			stateCode: parsed.stateCode,
			stateName: parsed.stateName,
			address: parsed.registeredAddress,
			addresses: parsed.addresses,
			contacts: parsed.contacts,
			contactName: accounts?.name ?? null,
			phone: accounts?.mobile ? `+${accounts.mobile.countryCallingCode} ${accounts.mobile.number}` : null,
			email: accounts?.email ?? null,
			roles: parsed.roles,
			setOff: parsed.setOff,
			active: parsed.active,
			notes: parsed.notes,
			businessRevision: (expectedRevision ?? -1) + 1,
			updatedAt: parsed.updatedAt,
			deletedAt: null,
		};
		if (expectedRevision === null) {
			await SupplierModel.updateOne(
				{ _id: parsed.id },
				{ $set: { ...set, createdAt: parsed.createdAt } },
				{ upsert: true, session },
			).exec();
		} else {
			const result = await SupplierModel.updateOne(
				{ _id: parsed.id, businessRevision: expectedRevision === 0 ? { $in: [0, null] } : expectedRevision },
				{ $set: set },
				{ session },
			).exec();
			if (result.matchedCount === 0) throw new StaleRevisionError('business', parsed.id);
		}
		return { ...parsed, revision: (expectedRevision ?? -1) + 1 };
	}

	async countByZone(zoneId: string): Promise<number> {
		return SupplierModel.countDocuments({ deletedAt: null, 'roles.customer.zoneId': zoneId }).exec();
	}
}

/* ---------------------------------------------------------------------------------------------- */
/* Ledgers                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

export class MongoLedgerRepository implements LedgerRepository {
	async append(entry: LedgerEntry, context?: TransactionContext): Promise<LedgerEntry> {
		const parsed = LedgerEntry.parse(entry);
		await LedgerEntryModel.create([toDoc(parsed)], { session: sessionFrom(context) });
		return parsed;
	}

	async balance(businessId: string, side: LedgerSide): Promise<number> {
		const [row] = await LedgerEntryModel.aggregate<{ total: number }>([
			{ $match: { businessId, side } },
			{ $group: { _id: null, total: { $sum: '$amountINR' } } },
		]).exec();
		return Math.round((row?.total ?? 0) * 100) / 100;
	}

	async list(
		businessId: string,
		side: LedgerSide,
		range: { from?: string; to?: string; page: number; pageSize: number },
	): Promise<{ rows: LedgerEntry[]; total: number; openingINR: number }> {
		const at: Record<string, string> = {};
		if (range.from) at.$gte = indiaDayStart(range.from).toISOString();
		if (range.to) at.$lt = new Date(indiaDayStart(range.to).getTime() + 86_400_000).toISOString();
		const filter: FilterQuery<OrdersBuildDoc> = { businessId, side, ...(Object.keys(at).length ? { at } : {}) };
		const [docs, total, opening] = await Promise.all([
			LedgerEntryModel.find(filter)
				.sort({ at: 1, _id: 1 })
				.skip((range.page - 1) * range.pageSize)
				.limit(range.pageSize)
				.lean<OrdersBuildDoc[]>()
				.exec(),
			LedgerEntryModel.countDocuments(filter).exec(),
			range.from
				? LedgerEntryModel.aggregate<{ total: number }>([
						{ $match: { businessId, side, at: { $lt: indiaDayStart(range.from).toISOString() } } },
						{ $group: { _id: null, total: { $sum: '$amountINR' } } },
					]).exec()
				: Promise.resolve([] as Array<{ total: number }>),
		]);
		return { rows: docs.map((doc) => LedgerEntry.parse(fromDoc(doc))), total, openingINR: opening[0]?.total ?? 0 };
	}

	async findById(id: string): Promise<LedgerEntry | null> {
		const doc = fromDoc(await LedgerEntryModel.findById(id).lean<OrdersBuildDoc>().exec());
		return doc ? LedgerEntry.parse(doc) : null;
	}
}

/* ---------------------------------------------------------------------------------------------- */
/* Settings kept as typed site settings, with a revision check                                     */
/* ---------------------------------------------------------------------------------------------- */

async function readSetting<T>(key: SiteSettingKey, parse: (value: unknown) => T, fallback: () => T): Promise<T> {
	const doc = await SiteSettingModel.findById(key).lean<{ value?: unknown }>().exec();
	if (!doc?.value) return fallback();
	try {
		return parse(doc.value);
	} catch {
		return fallback();
	}
}

async function writeSetting<T extends { revision: number }>(
	key: SiteSettingKey,
	value: T,
	expectedRevision: number,
): Promise<T> {
	const next = { ...value, revision: expectedRevision + 1 };
	const exists = await SiteSettingModel.exists({ _id: key }).exec();
	if (!exists && expectedRevision === 0) {
		await SiteSettingModel.updateOne({ _id: key }, { $set: { value: next } }, { upsert: true }).exec();
		return next;
	}
	const result = await SiteSettingModel.updateOne(
		{ _id: key, 'value.revision': expectedRevision === 0 ? { $in: [0, null] } : expectedRevision },
		{ $set: { value: next } },
	).exec();
	if (result.matchedCount === 0) throw new StaleRevisionError('setting', key);
	return next;
}

export class MongoDocumentNumberingRepository implements DocumentNumberingRepository {
	async get(): Promise<DocumentNumberingSettings> {
		return readSetting(
			'orders.numbering',
			(value) => DocumentNumberingSettings.parse(value),
			() => DEFAULT_DOCUMENT_NUMBERING,
		);
	}

	async save(settings: DocumentNumberingSettings, expectedRevision: number): Promise<DocumentNumberingSettings> {
		return writeSetting('orders.numbering', DocumentNumberingSettings.parse(settings), expectedRevision);
	}

	async lock(type: string, context?: TransactionContext): Promise<void> {
		const exists = await SiteSettingModel.exists({ _id: 'orders.numbering' })
			.session(sessionFrom(context) ?? null)
			.exec();
		if (!exists) {
			await SiteSettingModel.updateOne(
				{ _id: 'orders.numbering' },
				{ $setOnInsert: { value: { ...DEFAULT_DOCUMENT_NUMBERING, lockedTypes: [type] } } },
				{ upsert: true, session: sessionFrom(context) },
			).exec();
			return;
		}
		await SiteSettingModel.updateOne(
			{ _id: 'orders.numbering' },
			{ $addToSet: { 'value.lockedTypes': type } },
			{ session: sessionFrom(context) },
		).exec();
	}
}

export class MongoOrderSettingsRepository implements OrderSettingsRepository {
	async get(): Promise<OrderSettings> {
		return readSetting(
			'orders.settings',
			(value) => OrderSettings.parse(value),
			() => OrderSettings.parse({}),
		);
	}

	async save(settings: OrderSettings, expectedRevision: number): Promise<OrderSettings> {
		return writeSetting('orders.settings', OrderSettings.parse(settings), expectedRevision);
	}
}

/* ---------------------------------------------------------------------------------------------- */
/* Zones                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

export class MongoPriceZoneRepository implements PriceZoneRepository {
	async list(): Promise<PriceZone[]> {
		const docs = await PriceZoneModel.find({}).sort({ code: 1 }).lean<OrdersBuildDoc[]>().exec();
		return docs.map((doc) => PriceZone.parse(fromDoc(doc)));
	}

	async findById(id: string): Promise<PriceZone | null> {
		const doc = fromDoc(await PriceZoneModel.findById(id).lean<OrdersBuildDoc>().exec());
		return doc ? PriceZone.parse(doc) : null;
	}

	async save(zone: PriceZone, expectedRevision: number | null): Promise<PriceZone> {
		const parsed = PriceZone.parse(zone);
		const next = { ...parsed, revision: (expectedRevision ?? -1) + 1 };
		const { _id, ...rest } = toDoc(next);
		if (expectedRevision === null) {
			await PriceZoneModel.create([{ _id, ...rest }]);
			return next;
		}
		const result = await PriceZoneModel.updateOne({ _id, revision: expectedRevision }, { $set: rest }).exec();
		if (result.matchedCount === 0) throw new StaleRevisionError('zone', parsed.id);
		return next;
	}

	async delete(id: string): Promise<void> {
		await PriceZoneModel.deleteOne({ _id: id, system: { $ne: true } }).exec();
	}

	async getSettings(): Promise<ZonePricingSettings> {
		return readSetting(
			'zones.pricing',
			(value) => ZonePricingSettings.parse(value),
			() => ZonePricingSettings.parse({}),
		);
	}

	async saveSettings(settings: ZonePricingSettings, expectedRevision: number): Promise<ZonePricingSettings> {
		return writeSetting('zones.pricing', ZonePricingSettings.parse(settings), expectedRevision);
	}
}

/* ---------------------------------------------------------------------------------------------- */
/* Coupons                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

const couponFromDoc = (doc: OrdersBuildDoc): Coupon => {
	const raw = fromDoc(doc) as Record<string, unknown>;
	delete raw.deletedAt;
	return Coupon.parse(raw);
};

export class MongoCouponRepository implements CouponRepository {
	async list(query: CouponListQuery, now: Date): Promise<CouponListResponse> {
		const nowIso = now.toISOString();
		const base: FilterQuery<OrdersBuildDoc> = { deletedAt: null };
		if (query.q) {
			const pattern = new RegExp(escapeRegex(query.q), 'i');
			base.$or = [{ code: pattern }, { title: pattern }];
		}
		const expired = { validUntil: { $ne: null, $lt: nowIso } };
		const notExpired = { $or: [{ validUntil: null }, { validUntil: { $gte: nowIso } }] };
		const byFilter = (name: string): FilterQuery<OrdersBuildDoc> => {
			if (name === 'on') return { $and: [base, { enabled: true }, notExpired] };
			if (name === 'off') return { $and: [base, { enabled: false }] };
			if (name === 'expired') return { $and: [base, expired] };
			return base;
		};
		const filter = byFilter(query.filter);
		const skip = (query.page - 1) * query.pageSize;
		const [docs, total, all, on, off, expiredCount] = await Promise.all([
			CouponModel.find(filter).sort({ code: 1 }).skip(skip).limit(query.pageSize).lean<OrdersBuildDoc[]>().exec(),
			CouponModel.countDocuments(filter).exec(),
			CouponModel.countDocuments(byFilter('all')).exec(),
			CouponModel.countDocuments(byFilter('on')).exec(),
			CouponModel.countDocuments(byFilter('off')).exec(),
			CouponModel.countDocuments(byFilter('expired')).exec(),
		]);
		return {
			items: docs.map((doc) => {
				const coupon = couponFromDoc(doc);
				return {
					id: coupon.id,
					code: coupon.code,
					title: coupon.title,
					kind: coupon.kind,
					value: coupon.value,
					capINR: coupon.capINR,
					combines: coupon.combines,
					enabled: coupon.enabled,
					usedCount: coupon.usedCount,
					totalUses: coupon.totalUses,
					validFrom: coupon.validFrom,
					validUntil: coupon.validUntil,
					appliesTo: coupon.scope.kind,
					expired: !!coupon.validUntil && coupon.validUntil < nowIso,
				};
			}),
			total,
			counts: { all, on, off, expired: expiredCount },
		};
	}

	async findById(id: string): Promise<Coupon | null> {
		const doc = await CouponModel.findOne({ _id: id, deletedAt: null }).lean<OrdersBuildDoc>().exec();
		return doc ? couponFromDoc(doc) : null;
	}

	async findByCode(code: string): Promise<Coupon | null> {
		const doc = await CouponModel.findOne({ code: code.trim().toUpperCase(), deletedAt: null })
			.lean<OrdersBuildDoc>()
			.exec();
		return doc ? couponFromDoc(doc) : null;
	}

	async listUsable(channel: 'shop' | 'admin', now: Date): Promise<Coupon[]> {
		const nowIso = now.toISOString();
		const docs = await CouponModel.find({
			deletedAt: null,
			enabled: true,
			[`channels.${channel}`]: true,
			$and: [
				{ $or: [{ validFrom: null }, { validFrom: { $lte: nowIso } }] },
				{ $or: [{ validUntil: null }, { validUntil: { $gte: nowIso } }] },
			],
		})
			.sort({ code: 1 })
			.limit(200)
			.lean<OrdersBuildDoc[]>()
			.exec();
		return docs.map(couponFromDoc);
	}

	async save(coupon: Coupon, expectedRevision: number | null): Promise<Coupon> {
		const parsed = Coupon.parse(coupon);
		const next = { ...parsed, revision: (expectedRevision ?? -1) + 1 };
		const { _id, ...rest } = toDoc(next);
		try {
			if (expectedRevision === null) {
				await CouponModel.create([{ _id, ...rest, deletedAt: null }]);
				return next;
			}
			const result = await CouponModel.updateOne(
				{ _id, revision: expectedRevision, deletedAt: null },
				{ $set: rest },
			).exec();
			if (result.matchedCount === 0) throw new StaleRevisionError('coupon', parsed.id);
			return next;
		} catch (error) {
			if ((error as { code?: number })?.code === 11000) throw new DuplicateCouponCodeError(parsed.code);
			throw error;
		}
	}

	async setEnabled(ids: readonly string[], enabled: boolean, by: string): Promise<string[]> {
		const docs = await CouponModel.find({ _id: { $in: [...ids] }, deletedAt: null }, { _id: 1 })
			.lean<OrdersBuildDoc[]>()
			.exec();
		const found = docs.map((doc) => doc._id);
		if (found.length) {
			await CouponModel.updateMany(
				{ _id: { $in: found } },
				{ $set: { enabled, updatedBy: by, updatedAt: new Date().toISOString() }, $inc: { revision: 1 } },
			).exec();
		}
		return found;
	}

	async delete(ids: readonly string[]): Promise<string[]> {
		const docs = await CouponModel.find({ _id: { $in: [...ids] }, deletedAt: null }, { _id: 1 })
			.lean<OrdersBuildDoc[]>()
			.exec();
		const found = docs.map((doc) => doc._id);
		if (found.length) {
			await CouponModel.updateMany(
				{ _id: { $in: found } },
				{ $set: { deletedAt: new Date().toISOString(), enabled: false } },
			).exec();
		}
		return found;
	}

	async recordUse(couponId: string, buyerKey: string, orderId: string, context?: TransactionContext): Promise<void> {
		const session = sessionFrom(context);
		const updated = await CouponModel.findOneAndUpdate(
			{ _id: couponId, $or: [{ totalUses: null }, { $expr: { $lt: ['$usedCount', '$totalUses'] } }] },
			{ $inc: { usedCount: 1 } },
			{ session },
		)
			.lean()
			.exec();
		if (!updated) throw new CouponUsedUpError(couponId);
		await CouponUseModel.create(
			[{ _id: `${couponId}:${orderId}`, couponId, buyerKey, orderId, at: new Date().toISOString() }],
			{
				session,
			},
		);
	}

	async usesBy(couponId: string, buyerKey: string): Promise<number> {
		return CouponUseModel.countDocuments({ couponId, buyerKey }).exec();
	}

	async usedOnOrders(couponId: string): Promise<boolean> {
		return Boolean(await CouponUseModel.exists({ couponId }).exec());
	}
}
