import {
	OrderSettings,
	type AdminCartView,
	type AdminOrderCreate,
	type Order,
	type OrderPayment,
} from '@saha-textile/contracts';
import { DuplicateOrderKeyError } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { AdminOrderCreateService } from '../src/admin-orders/admin-order-create.service';

/**
 * Create order: every path the older tests leave, and a payment typed at checkout posted to the books with the order
 * (Postings and Convert brief P1).
 */

const kolkata = {
	fullName: 'Boutique Nila',
	line1: '12 Lake Road',
	city: 'Kolkata',
	subdivisionCode: 'WB',
	postalCode: '700029',
	countryCode: 'IN',
	mobile: { countryCallingCode: '91', number: '9830012345' },
};
const london = {
	fullName: 'Nila Kensington',
	line1: '4 Earls Court Road',
	city: 'London',
	subdivisionCode: null,
	postalCode: 'W8 6EJ',
	countryCode: 'GB',
	mobile: { countryCallingCode: '44', number: '7700900123' },
};
const checkedOf = (address: Record<string, unknown>) => ({
	...address,
	state: address.countryCode === 'IN' ? 'West Bengal' : null,
	gstStateCode: address.countryCode === 'IN' ? '19' : null,
	country: address.countryCode,
	phone: null,
	altMobile: null,
});

const cartLine = (over: Partial<AdminCartView['lines'][number]> = {}): AdminCartView['lines'][number] => ({
	lineId: 'line_1',
	productId: 'p1',
	variationId: 'v1',
	title: 'Kanjivaram saree',
	sku: 'SAR-1',
	quantity: 2,
	soldBy: 'piece',
	imageUrl: null,
	unitPriceINR: 20_000,
	unitPrice: 20_000,
	lineTotal: 40_000,
	lineTotalINR: 40_000,
	mrpINR: null,
	zonePrice: {
		kind: 'priced',
		unitPriceINR: 20_000,
		retailUnitPriceINR: 25_000,
		rule: { tier: 'allProducts', ruleId: 'r1', ruleName: 'Wholesale' },
		belowCost: false,
		addOns: null,
	},
	problem: null,
	options: [],
	measurements: [],
	addOnsZonePriced: false,
	children: [],
	setHeading: null,
	setOnSale: false,
	...over,
});
const cart = (lines = [cartLine()], over: Partial<AdminCartView> = {}): AdminCartView => ({
	currency: 'INR',
	markupPercent: 0,
	subtotalINR: lines.reduce((sum, line) => sum + line.lineTotalINR, 0),
	subtotal: lines.reduce((sum, line) => sum + line.lineTotal, 0),
	lines,
	...over,
});
const secondLine = cartLine({
	lineId: 'line_2',
	productId: 'p2',
	variationId: 'v2',
	sku: 'SAR-2',
	quantity: 1,
	unitPriceINR: 10_000,
	unitPrice: 10_000,
	lineTotal: 10_000,
	lineTotalINR: 10_000,
});

const tenOff = {
	id: 'cpn_ten',
	code: 'TEN',
	title: '10% off',
	kind: 'percentOff',
	value: 10,
	capINR: null,
	scope: { kind: 'wholeOrder' },
	excludedProductIds: [] as string[],
	includeSaleItems: false,
	minOrderINR: 0,
	audience: { kind: 'everyone' },
	channels: { shop: true, admin: true },
	usesPerCustomer: null,
	totalUses: null,
	validFrom: null,
	validUntil: null,
	combines: true,
	usableOnZonePrices: true,
	enabled: true,
	usedCount: 0,
};
const freeShip = {
	...tenOff,
	id: 'cpn_free',
	code: 'FREESHIP',
	title: 'Free delivery',
	kind: 'freeDelivery',
	value: 0,
};
const small = { ...tenOff, id: 'cpn_small', code: 'SMALL', title: '₹100 off', kind: 'amountOff', value: 100 };
const big = { ...tenOff, id: 'cpn_big', code: 'BIG', minOrderINR: 10_000_000 };
const gone = { ...tenOff, id: 'cpn_gone', code: 'GONE' };

const business = (over: Record<string, unknown> = {}, terms: Record<string, unknown> = {}) => ({
	id: 'biz_1',
	legalName: 'Boutique Nila',
	gstin: '19ABCDE1234F1Z5',
	contacts: [{ id: 'c', name: 'Accounts', email: 'accounts@nila.test', mobile: null, isAccounts: true }],
	addresses: [{ id: 'adr_b', ...checkedOf(kolkata) }],
	roles: {
		supplier: false,
		customer: { zoneId: 'zone_w', creditLimitINR: 200_000, creditDays: 30, standing: 'active', ...terms },
	},
	...over,
});
const person = {
	id: 'cus_1',
	displayName: null,
	email: null,
	status: 'active',
	addresses: [
		{ id: 'adr_1', ...checkedOf(kolkata) },
		// An older saved address: no country code, state or PIN code stored.
		{
			...checkedOf(kolkata),
			id: 'adr_old',
			countryCode: undefined,
			state: undefined,
			postalCode: '',
			mobile: null,
		},
	],
};

const shippingResult = (over: Record<string, unknown> = {}) => ({
	status: 'priced',
	zone: 'domestic',
	amountINR: 200,
	lines: [{ lineId: 'line_1', route: 'ruleSet', units: 1, discounted: true }],
	groups: [{ ruleSetId: 'rs1', ruleSetName: 'Domestic', version: 2, trace: [{ step: 'flat' }] }],
	...over,
});

interface Options {
	cart?: AdminCartView;
	facts?: Array<{ categoryPaths: string[][]; currentSaleINR: number | null }>;
	customerList?: unknown[];
	business?: unknown;
	coupons?: Record<string, unknown>;
	usable?: unknown[];
	shipping?: unknown;
	shippingSettings?: unknown;
	orderSettings?: Record<string, unknown>;
	rateFromINR?: number;
	firstOrders?: number;
	zone?: unknown;
	createFails?: Array<'orderNumber' | 'idempotencyKey' | Error>;
	firstByKey?: Order | null;
	notices?: boolean;
	books?: boolean;
}

function harness(options: Options = {}) {
	const created: Order[] = [];
	const ledger: Array<Record<string, unknown>> = [];
	const payments: OrderPayment[] = [];
	const saved: Array<[string, unknown]> = [];
	const uses: string[] = [];
	const tried: unknown[] = [];
	const fails = [...(options.createFails ?? [])];
	let lookups = 0;
	const books = { paymentReceived: vi.fn(async () => null) };
	const svc = new AdminOrderCreateService(
		{
			price: async () => options.cart ?? cart(),
			buyerZone: async () => ({
				zone:
					options.zone === undefined
						? { id: 'zone_w', code: 'WHOLESALE', name: 'Wholesale', version: 3 }
						: options.zone,
			}),
		} as never,
		{
			factsFor: async (rows: unknown[]) =>
				rows.map((_row, index) => ({
					facts: options.facts?.[index] ?? { categoryPaths: [['cat_silk']], currentSaleINR: null },
				})),
		} as never,
		{ convert: async () => ({ rateFromINR: options.rateFromINR ?? 1 }) } as never,
		{
			check: async (address: Record<string, unknown>) => checkedOf(address),
			add: async (id: string, address: unknown) => void saved.push([id, address]),
		} as never,
		{
			tryCart: async (request: unknown) => {
				tried.push(request);
				if (options.shipping instanceof Error) throw options.shipping;
				return options.shipping ?? shippingResult();
			},
		} as never,
		{ orderNumber: async () => 'ST-2611-482190', issue: async () => 'RC/26-27/000001' } as never,
		{ route: async () => 'loc_1', reserve: async () => undefined } as never,
		{
			findByIdempotencyKey: async () => (lookups++ === 0 ? null : (options.firstByKey ?? null)),
			create: async (order: Order) => {
				const fail = fails.shift();
				if (fail === 'orderNumber' || fail === 'idempotencyKey') throw new DuplicateOrderKeyError(fail);
				if (fail) throw fail;
				created.push(order);
				return order;
			},
			countPlacedByCustomer: async () => options.firstOrders ?? 0,
		} as never,
		{ save: async (row: OrderPayment) => void payments.push(row) } as never,
		{ get: async () => OrderSettings.parse(options.orderSettings ?? {}) } as never,
		{ findById: async () => (options.business === undefined ? business() : options.business) } as never,
		{
			findById: async (id: string) => (id === 'cus_1' ? person : null),
			list: async () => ({ items: options.customerList ?? [], meta: {} }),
		} as never,
		{
			balance: async () => 0,
			append: async (entry: Record<string, unknown>) => ledger.push(entry),
		} as never,
		{
			findByCode: async (code: string) =>
				(options.coupons ?? { TEN: tenOff, FREESHIP: freeShip, SMALL: small, BIG: big })[code] ?? null,
			listUsable: async () => options.usable ?? [tenOff],
			usesBy: async () => 0,
			recordUse: async (id: string) => void uses.push(id),
		} as never,
		{
			getSettings: async () =>
				options.shippingSettings === undefined
					? { abroadPolicy: 'exportOffIndianInvoice', homeCountry: 'IN' }
					: options.shippingSettings,
		} as never,
		{ withTransaction: async (work: (context: unknown) => Promise<unknown>) => work({ tx: 1 }) } as never,
		options.notices
			? ({
					plan: (_order: unknown, templates: string[]) =>
						templates.map((template) => ({ channel: 'email' as const, template })),
					send: async () => undefined,
				} as never)
			: null,
		options.books ? (books as never) : null,
	);
	return { svc, created, ledger, payments, saved, uses, tried, books };
}

const toBusiness = { kind: 'business' as const, businessId: 'biz_1' };
const toPerson = { kind: 'person' as const, customerId: 'cus_1' };
const input = (
	payment: AdminOrderCreate['payment'],
	over: Partial<AdminOrderCreate> & { buyer?: AdminOrderCreate['cart']['buyer'] } = {},
): AdminOrderCreate => {
	const { buyer, ...rest } = over;
	return {
		cart: {
			buyer: buyer ?? toBusiness,
			currency: 'INR',
			lines: [
				{ productId: 'p1', variationId: 'v1', quantity: 2, addons: [] },
				{ productId: 'p2', variationId: 'v2', quantity: 1, addons: [] },
			],
		},
		delivery: { kind: 'new', address: kolkata as never, saveAs: null },
		billing: null,
		indianInvoiceAddress: null,
		couponCodes: [],
		payment,
		comment: null,
		idempotencyKey: 'key-0000000000000001',
		...rest,
	};
};
const link = { method: 'paymentLink' as const };
const keepOpen = { method: 'keepOpen' as const };
const typed = (received: boolean): AdminOrderCreate['payment'] => ({
	method: 'manual',
	payment: {
		method: 'upi',
		amountINR: 40_200,
		reference: '402112345678',
		receivedOn: '2026-11-20',
		received,
		note: null,
		proofMediaId: null,
		collector: null,
		collectedBy: null,
	},
});
const actor = { id: 'adm_1', name: null };
const rights = { belowCost: false, creditOverride: false, keepOpen: true };
const NOW = new Date('2026-11-20T06:00:00.000Z');
const tryFields = (() => {
	const { id: _id, enabled: _enabled, usedCount: _used, ...fields } = tenOff;
	return fields;
})();

describe('create order: pickers and coupon lists', () => {
	it('names a customer by name, email, phone or id, leaving out blocked ones', async () => {
		const { svc } = harness({
			customerList: [
				{
					id: 'c1',
					displayName: ' ',
					email: 'e@example.test',
					phone: '+91 1',
					status: 'active',
					addresses: [],
				},
				{ id: 'c2', displayName: null, email: null, phone: '+91 2', status: 'pending', addresses: [{}] },
				{ id: 'c3', displayName: null, email: null, phone: null, status: 'active', addresses: [] },
				{ id: 'c4', displayName: 'Gone', email: null, phone: null, status: 'blocked', addresses: [] },
			],
		});
		expect((await svc.searchCustomers('x', 10)).map((row) => row.name)).toEqual(['e@example.test', '+91 2', 'c3']);
	});

	it('lists the coupons a checkout can use, what each takes off first, then the refused with why', async () => {
		const { svc } = harness({
			cart: cart([cartLine(), secondLine]),
			usable: [tenOff, big, small, gone, freeShip],
		});
		const options = await svc.couponOptions(input(link, { couponCodes: ['ten'] }), rights, NOW);
		expect(options.map((row) => [row.code, row.wouldTakeINR, row.refusal])).toEqual([
			['FREESHIP', 200, null],
			['SMALL', 100, null],
			['BIG', 0, 'belowMinimum'],
			['GONE', 0, 'unknown'],
		]);
	});

	it('lists a person’s saved addresses', async () => {
		expect((await harness().svc.buyerAddresses(toPerson)).map((row) => row.id)).toEqual(['adr_1', 'adr_old']);
	});
});

describe('Try it on the coupon builder', () => {
	const items = [
		{ productId: 'p1', variantId: 'v1', quantity: 2 },
		{ productId: 'p2', variantId: 'v2', quantity: 1 },
	];

	it('tries a lone coupon alone, and with the others only those switched on, combining and not itself', async () => {
		const coupons = {
			OFF: { ...freeShip, id: 'cpn_off', code: 'OFF', enabled: false },
			LONE: { ...freeShip, id: 'cpn_lone', code: 'LONE', combines: false },
			TRY: { ...freeShip, id: 'cpn_try', code: 'TRY' },
			FREESHIP: freeShip,
		};
		const { svc } = harness({ cart: cart([cartLine(), secondLine]), coupons });
		const alone = await svc.couponTry({
			coupon: { ...tryFields, code: 'TRY', combines: false } as never,
			items,
			deliveryINR: 100,
			withCodes: ['FREESHIP'],
		});
		expect(alone.used.map((row) => row.code)).toEqual(['TRY']);
		expect(alone.deliveryOff).toBeNull();
		const together = await svc.couponTry({
			coupon: { ...tryFields, code: 'TRY' } as never,
			items,
			deliveryINR: 100,
			withCodes: ['NOPE', 'OFF', 'LONE', 'TRY', 'FREESHIP'],
		});
		expect(together.used).toEqual([
			{ code: 'TRY', amountINR: 5_000 },
			{ code: 'FREESHIP', amountINR: 100 },
		]);
		expect(together.deliveryOff).toEqual({ code: 'FREESHIP', amountINR: 100 });
	});

	it('prices the delivery itself when none is given, and counts none when it can’t', async () => {
		const base = { coupon: tryFields as never, items, deliveryINR: 0, withCodes: [] };
		const priced = harness({ shipping: shippingResult({ amountINR: 150 }), shippingSettings: null });
		expect((await priced.svc.couponTry(base)).deliveryINR).toBe(150);
		expect(priced.tried[0]).toMatchObject({ delivery: { country: 'IN', state: null, pincode: null } });
		for (const shipping of [
			shippingResult({ amountINR: null }),
			shippingResult({ status: 'cantShip' }),
			new Error('rules down'),
		]) {
			expect((await harness({ shipping }).svc.couponTry(base)).deliveryINR).toBe(0);
		}
	});

	it('says, line by line, why a coupon took nothing or left a line out', async () => {
		const { svc } = harness({
			cart: cart([cartLine({ zonePrice: null }), { ...secondLine, zonePrice: null, setOnSale: true }]),
			facts: [
				{ categoryPaths: [['cat_silk'], ['cat_silk']], currentSaleINR: null },
				{ categoryPaths: [], currentSaleINR: 9_000 },
			],
		});
		const refused = await svc.couponTry({
			coupon: { ...tryFields, minOrderINR: 10_000_000 } as never,
			items,
			deliveryINR: 100,
			withCodes: [],
		});
		expect(refused.refusal).toBe('belowMinimum');
		expect(refused.applied).toBeNull();
		expect(refused.lines.map((row) => [row.reason, row.amountINR, row.onSale])).toEqual([
			['applied', 0, false],
			['onSale', 0, true],
		]);
		const partly = await svc.couponTry({
			coupon: { ...tryFields, excludedProductIds: ['p2'], includeSaleItems: true } as never,
			items,
			deliveryINR: 100,
			withCodes: [],
		});
		expect(partly.lines.map((row) => [row.reason, row.amountINR, row.byCoupon])).toEqual([
			['applied', 4_000, [{ code: 'TEN', amountINR: 4_000 }]],
			['excluded', 0, []],
		]);
	});
});

describe('the checkout quote', () => {
	it('invoices to the delivery address in India, or the address in India given at checkout, or asks for one', async () => {
		const abroadBilling = await harness().svc.quote(
			input(link, { billing: { kind: 'new', address: london as never, saveAs: null } }),
			rights,
			NOW,
		);
		expect(abroadBilling.invoiceAddress).toEqual({ source: 'delivery', needed: false });
		expect(abroadBilling.warnings).toEqual(['smsNotIndianMobile']);
		const abroad = { delivery: { kind: 'new' as const, address: london as never, saveAs: null } };
		const given = await harness({ shipping: shippingResult({ zone: 'international' }) }).svc.quote(
			input(link, { ...abroad, indianInvoiceAddress: kolkata as never }),
			rights,
			NOW,
		);
		expect(given.invoiceAddress).toEqual({ source: 'addressInIndia', needed: false });
		const order = await harness().svc.create(
			input(keepOpen, { ...abroad, indianInvoiceAddress: kolkata as never }),
			actor,
			rights,
			NOW,
		);
		expect(order.addresses?.invoice).toMatchObject({ source: 'addressInIndia', address: { city: 'Kolkata' } });
		expect(order.addresses?.addressInIndia).toMatchObject({ city: 'Kolkata', savedAddressId: null });
		const asked = await harness().svc.quote(input(link, abroad), rights, NOW);
		expect(asked.invoiceAddress).toEqual({ source: 'none', needed: true });
	});

	it('refuses a place the shop does not send to', async () => {
		const { svc } = harness({ shippingSettings: { abroadPolicy: 'indiaOnly', homeCountry: 'IN' } });
		await expect(
			svc.quote(input(link, { delivery: { kind: 'new', address: london as never, saveAs: null } }), rights, NOW),
		).rejects.toMatchObject({
			response: { issues: [{ code: 'delivery_not_allowed', params: { reason: 'deliveryAbroadRefused' } }] },
		});
		// Without its own shipping settings the shop uses the defaults.
		expect((await harness({ shippingSettings: null }).svc.quote(input(link), rights, NOW)).totals.goodsINR).toBe(
			40_000,
		);
	});

	it('prices another currency at the day’s rate with PayPal, and turns rupee-only methods off when set to', async () => {
		const usd = cart([cartLine()], { currency: 'USD', markupPercent: 5 });
		const quote = await harness({ cart: usd, rateFromINR: 0.012 }).svc.quote(input(link), rights, NOW);
		expect(quote).toMatchObject({ currency: 'USD', gateway: 'paypal', warnings: ['indiaBillingForeignCurrency'] });
		expect(quote.totals.total).toBe(506.52);
		expect(quote.methodsOff.filter((row) => row.reason === 'foreignCurrency')).toEqual([]);
		const strict = await harness({
			cart: usd,
			rateFromINR: 0.012,
			orderSettings: { manualPaymentCurrency: 'orderCurrency', warnIndiaBillingForeignCurrency: false },
		}).svc.quote(input(link), rights, NOW);
		expect(strict.methodsOff.filter((row) => row.reason === 'foreignCurrency').map((row) => row.method)).toEqual([
			'upi',
			'bankTransfer',
			'cashOnDelivery',
		]);
		expect(strict.warnings).toEqual([]);
		const order = await harness({ cart: usd, rateFromINR: 0.012 }).svc.create(input(keepOpen), actor, rights, NOW);
		expect(order.currencyRecord).toMatchObject({ code: 'USD', source: 'fetch', inrPerUnit: 83.33 });
		expect(order.lines[0]?.lineTotalPaid).toBe(504);
		const unrated = await harness({ cart: usd, rateFromINR: 0 }).svc.create(input(keepOpen), actor, rights, NOW);
		expect(unrated.currencyRecord?.inrPerUnit).toBeNull();
	});

	it('refuses a blocked business and one that doesn’t buy from us, and a person can’t pay on account', async () => {
		await expect(
			harness({ business: business({}, { standing: 'blocked' }) }).svc.quote(input(link), rights, NOW),
		).rejects.toMatchObject({ response: { issues: [{ code: 'business_blocked' }] } });
		await expect(
			harness({ business: business({ roles: { supplier: true, customer: null } }) }).svc.quote(
				input(link),
				rights,
				NOW,
			),
		).rejects.toMatchObject({ response: { issues: [{ code: 'not_a_customer' }] } });
		await expect(harness({ business: null }).svc.quote(input(link), rights, NOW)).rejects.toMatchObject({
			response: { issues: [{ code: 'not_a_customer' }] },
		});
		const personal = await harness({ zone: null }).svc.quote(input(link, { buyer: toPerson }), rights, NOW);
		expect(personal.methodsOff).toContainEqual({ method: 'onAccount', reason: 'notABusiness' });
		expect(personal.credit).toBeNull();
	});

	it('lists the rule sets with their trace, the pieces that can’t go, and methods switched off', async () => {
		const methods = OrderSettings.parse({}).adminPaymentMethods;
		const { svc } = harness({
			cart: cart([cartLine(), secondLine]),
			shipping: shippingResult({
				lines: [
					{ lineId: 'u1', route: 'ruleSet', units: 2, discounted: false },
					{ lineId: 'u2', route: 'cantShip', units: 1, discounted: false },
				],
				groups: [
					{ ruleSetId: 'rs1', ruleSetName: null, version: 2, trace: [{ a: 1 }, { b: 2 }] },
					{ ruleSetId: null, ruleSetName: null, version: null, trace: [] },
					{ ruleSetId: 'rs3', ruleSetName: 'Old', version: null, trace: [] },
				],
			}),
			orderSettings: { adminPaymentMethods: { ...methods, upi: false } },
		});
		const quote = await svc.quote(input(link), rights, NOW);
		expect(quote.shipping.ruleSets).toEqual([{ id: 'rs1', version: 2, name: '' }]);
		expect(quote.shipping.trace).toEqual(['{"a":1}', '{"b":2}']);
		expect(quote.shipping.cannotShip).toEqual([{ lineId: 'line_2', reason: 'cantShip' }]);
		expect(quote.methodsOff).toContainEqual({ method: 'upi', reason: 'switchedOff' });
		await expect(svc.create(input(link), actor, rights, NOW)).rejects.toMatchObject({
			response: { issues: [{ code: 'cannot_ship' }] },
		});
	});

	it('takes the coupons typed once each, refuses unknown ones, and knows a person’s first order', async () => {
		const { usedCount: _used, ...uncounted } = freeShip;
		const first = harness({ coupons: { TEN: tenOff, FREESHIP: uncounted } });
		const quote = await first.svc.quote(
			input(link, { buyer: toPerson, couponCodes: ['nope', 'ten', 'TEN', 'freeship'] }),
			rights,
			NOW,
		);
		expect(quote.coupons.map((row) => row.code)).toEqual(['TEN', 'FREESHIP']);
		expect(quote.couponRefusals).toEqual([{ code: 'NOPE', refusal: 'unknown' }]);
		expect(quote.totals).toMatchObject({ couponINR: 4_000, shippingINR: 0, totalINR: 36_000 });
		const later = harness({ firstOrders: 2, shipping: shippingResult({ status: 'unpriced', amountINR: null }) });
		const again = await later.svc.quote(input(link, { buyer: toPerson, couponCodes: ['TEN'] }), rights, NOW);
		expect(again.totals).toMatchObject({ shippingINR: 0, totalINR: 36_000 });
	});
});

describe('placing the order', () => {
	it('posts a payment typed at checkout to the books with the order, and one on its way without a receipt', async () => {
		const { svc, payments, books, created } = harness({ books: true });
		await svc.create(input(typed(true)), actor, rights, NOW);
		expect(books.paymentReceived).toHaveBeenCalledWith(payments[0], created[0], { tx: 1 }, 'adm_1');
		const waiting = harness({ books: true });
		await waiting.svc.create(input(typed(false)), actor, rights, NOW);
		expect(waiting.payments[0]).toMatchObject({ state: 'pending', receivedOn: null, receiptNumber: null });
		expect(waiting.created[0]?.paymentStatus).toBe('pending_at_bank');
	});

	it('takes a new order number when one is taken, and gives up after five tries', async () => {
		const retried = harness({ createFails: ['orderNumber', 'orderNumber'] });
		expect((await retried.svc.create(input(keepOpen), actor, rights, NOW)).status).toBe('open');
		const stuck = harness({ createFails: Array(5).fill('orderNumber') });
		await expect(stuck.svc.create(input(keepOpen), actor, rights, NOW)).rejects.toBeInstanceOf(
			DuplicateOrderKeyError,
		);
	});

	it('returns the first order for a key saved twice at once, and passes other failures on', async () => {
		const first = { id: 'ord_first' } as Order;
		expect(
			await harness({ createFails: ['idempotencyKey'], firstByKey: first }).svc.create(
				input(keepOpen),
				actor,
				rights,
				NOW,
			),
		).toBe(first);
		await expect(
			harness({ createFails: ['idempotencyKey'] }).svc.create(input(keepOpen), actor, rights, NOW),
		).rejects.toBeInstanceOf(DuplicateOrderKeyError);
		await expect(
			harness({ createFails: [new Error('database down')] }).svc.create(input(keepOpen), actor, rights, NOW),
		).rejects.toThrow('database down');
	});

	it('records a person’s order: saved addresses, the name from the address, a coupon used and a new address saved', async () => {
		const { svc, uses, saved, created } = harness({ zone: null });
		const order = await svc.create(
			input(link, {
				buyer: toPerson,
				delivery: { kind: 'saved', savedAddressId: 'adr_old' },
				billing: { kind: 'new', address: { ...kolkata, mobile: null } as never, saveAs: 'Office' },
				couponCodes: ['TEN'],
			}),
			actor,
			rights,
			NOW,
		);
		expect(order.buyer).toMatchObject({ kind: 'person', name: 'Boutique Nila', email: null, mobile: null });
		expect(order.zone).toBeNull();
		expect(order.shipping?.deliveryCountry).toBe('IN');
		expect(order.lines[0]?.couponINR).toBe(4_000);
		expect(uses).toEqual(['cpn_ten']);
		expect(saved).toEqual([['cus_1', expect.objectContaining({ label: 'Office' })]]);
		expect(created).toHaveLength(1);
		await expect(
			svc.quote(input(link, { buyer: toPerson, delivery: { kind: 'saved', savedAddressId: 'adr_x' } }), rights),
		).rejects.toMatchObject({ response: { issues: [{ code: 'address_missing' }] } });
		await expect(
			harness().svc.quote(input(link, { billing: { kind: 'saved', savedAddressId: 'adr_b' } }), rights, NOW),
		).resolves.toMatchObject({ invoiceAddress: { source: 'billing' } });
	});

	it('records a business with no accounts contact, on account by an unnamed actor, without notices', async () => {
		const noAccounts = harness({
			business: business({ contacts: [{ id: 'c', name: 'Owner', email: 'owner@nila.test', mobile: null }] }),
		});
		const order = await noAccounts.svc.create(
			input({ method: 'onAccount', creditOverrideReason: null }),
			{ id: null, name: null },
			rights,
			NOW,
		);
		expect(order.buyer).toMatchObject({ email: 'owner@nila.test', mobile: kolkata.mobile });
		expect(order.history[0]?.messages).toEqual([]);
		expect(noAccounts.ledger[0]).toMatchObject({ by: 'unknown', note: null, dueOn: '2026-12-20' });
		const nobody = harness({ business: business({ contacts: [] }) });
		const bare = await nobody.svc.create(
			input(link, { delivery: { kind: 'new', address: { ...kolkata, mobile: null } as never, saveAs: null } }),
			actor,
			rights,
			NOW,
		);
		expect(bare.buyer).toMatchObject({ email: null, mobile: null });
	});

	it('keeps each line’s regular price, MRP only above the price, and no zone rule for retail or unpriced lines', async () => {
		const { svc } = harness({
			cart: cart([
				cartLine({ zonePrice: null, mrpINR: 25_000, setOnSale: true }),
				{
					...secondLine,
					mrpINR: 9_000,
					zonePrice: {
						kind: 'priced',
						unitPriceINR: 10_000,
						retailUnitPriceINR: 10_000,
						rule: { tier: 'retail', ruleId: 'r0', ruleName: 'Retail' },
						belowCost: false,
						addOns: null,
					},
				},
			]),
			facts: [
				{ categoryPaths: [], currentSaleINR: null },
				{ categoryPaths: [], currentSaleINR: 9_500 },
			],
			shipping: shippingResult({ lines: [] }),
		});
		const order = await svc.create(input(keepOpen), actor, rights, NOW);
		expect(order.lines.map((row) => row.pricing)).toMatchObject([
			{ regularUnitINR: 20_000, mrpUnitINR: 25_000, zoneRule: null, discounted: false },
			{ regularUnitINR: 10_000, mrpUnitINR: null, zoneRule: null, discounted: false },
		]);
	});
	it('records a set as its own line with its pieces beneath, billed to an older saved address', async () => {
		const { svc } = harness({
			zone: null,
			cart: cart([
				cartLine({
					zonePrice: null,
					setHeading: 'components',
					children: [
						{
							role: 'piece',
							key: 'blouse',
							parentKey: null,
							level: null,
							productId: 'p9',
							title: 'Blouse',
							sku: 'BL-1',
							image: null,
							variantId: null,
							variantLabel: null,
							quantity: 1,
							priceINR: 20_000,
							mrpINR: null,
						},
					],
				}),
			]),
		});
		const order = await svc.create(
			input(keepOpen, { buyer: toPerson, billing: { kind: 'saved', savedAddressId: 'adr_old' } }),
			{ id: 'adm_2', name: null },
			rights,
			NOW,
		);
		expect(order.lines.find((row) => row.lineId === 'line_1~blouse')).toMatchObject({
			productId: 'p9',
			addedBy: 'adm_2',
		});
		expect(order.addresses?.billing).toMatchObject({ savedAddressId: 'adr_old', country: 'IN' });
	});
});
