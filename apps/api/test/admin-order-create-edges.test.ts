import { Order, OrderSettings, type AdminCartView, type AdminOrderCreate } from '@saha-textile/contracts';
import { DuplicateOrderKeyError } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { AdminOrderCreateService } from '../src/admin-orders/admin-order-create.service';

const kolkata = {
	fullName: 'Boutique Nila',
	line1: '12 Lake Road',
	city: 'Kolkata',
	subdivisionCode: 'WB',
	postalCode: '700029',
	countryCode: 'IN',
	mobile: { countryCallingCode: '91', number: '9830012345' },
};
const checked = {
	...kolkata,
	state: 'West Bengal',
	gstStateCode: '19',
	country: 'IN',
	phone: '+91 9830012345',
	altMobile: null,
};

const cartView = (currency = 'INR', markupPercent = 0): AdminCartView => ({
	currency,
	markupPercent,
	subtotalINR: 40_000,
	subtotal: 40_000,
	lines: [
		{
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
			zonePrice: null,
			problem: null,
			options: [],
			measurements: [],
			addOnsZonePriced: false,
			children: [],
			setHeading: null,
			setOnSale: false,
		},
	],
});

const coupon = (code: string, over: Record<string, unknown> = {}) => ({
	id: `cpn_${code.toLowerCase()}`,
	code,
	title: code,
	kind: 'percentOff',
	value: 10,
	capINR: null,
	scope: { kind: 'wholeOrder' },
	excludedProductIds: [],
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
	...over,
});

const priced = (amountINR: number, routes: string[] = ['ruleSet']) => ({
	status: 'priced',
	zone: 'domestic',
	amountINR,
	lines: routes.map((route, index) => ({ lineId: `x${index}`, route, units: 1, discounted: false })),
	groups: [{ ruleSetId: 'rs1', ruleSetName: null, version: 2, trace: [] }],
});

interface Options {
	view?: AdminCartView;
	tryCart?: () => Promise<unknown>;
	shippingSettings?: unknown;
	coupons?: Array<ReturnType<typeof coupon>>;
	customers?: unknown[];
	create?: (order: Order, key: string) => Promise<Order>;
	findByKey?: (key: string) => Promise<Order | null>;
	orderSettings?: Record<string, unknown>;
	notices?: boolean;
	customerAddresses?: unknown[];
}

function harness(options: Options = {}) {
	const created: Order[] = [];
	const payments: Array<Record<string, unknown>> = [];
	const coupons = options.coupons ?? [coupon('TEN')];
	const shipping = { tryCart: vi.fn(options.tryCart ?? (async () => priced(200))) };
	const svc = new AdminOrderCreateService(
		{
			price: async () => options.view ?? cartView(),
			buyerZone: async () => ({ zone: null }),
		} as never,
		{ factsFor: async () => [{ facts: { categoryPaths: [['cat_silk']], currentSaleINR: null } }] } as never,
		{ convert: async () => ({ rateFromINR: 0.0095 }) } as never,
		{ check: async () => checked, add: async () => undefined } as never,
		shipping as never,
		{ orderNumber: async () => 'ST-2611-482190', issue: async () => 'RC/26-27/000001' } as never,
		{ route: async () => null, reserve: async () => undefined } as never,
		{
			findByIdempotencyKey: options.findByKey ?? (async () => null),
			create:
				options.create ??
				(async (order: Order) => {
					created.push(order);
					return order;
				}),
			countPlacedByCustomer: async () => 0,
		} as never,
		{ save: async (payment: Record<string, unknown>) => void payments.push(payment) } as never,
		{ get: async () => OrderSettings.parse(options.orderSettings ?? {}) } as never,
		{
			findById: async () => ({
				id: 'biz_1',
				legalName: 'Boutique Nila',
				gstin: null,
				contacts: [],
				addresses: [],
				roles: {
					supplier: false,
					customer: { zoneId: 'zone_w', creditLimitINR: 200_000, creditDays: 30, standing: 'active' },
				},
			}),
		} as never,
		{
			findById: async (id: string) =>
				id === 'cus_1'
					? {
							id: 'cus_1',
							displayName: 'Kavita Iyer',
							status: 'active',
							addresses: options.customerAddresses ?? [],
						}
					: null,
			list: async () => ({ items: options.customers ?? [], meta: {} }),
		} as never,
		{ balance: async () => 0, append: async () => undefined } as never,
		{
			findByCode: async (code: string) => coupons.find((row) => row.code === code) ?? null,
			listUsable: async () => coupons,
			usesBy: async () => 0,
			recordUse: async () => undefined,
		} as never,
		{
			getSettings: async () =>
				options.shippingSettings === undefined
					? { abroadPolicy: 'exportOffIndianInvoice', homeCountry: 'IN' }
					: options.shippingSettings,
		} as never,
		{ withTransaction: async (work: (context: unknown) => Promise<unknown>) => work({}) } as never,
		(options.notices === false
			? null
			: {
					plan: (_order: unknown, templates: string[]) =>
						templates.map((template) => ({ channel: 'email' as const, template })),
					send: async () => undefined,
				}) as never,
	);
	return { svc, created, payments, shipping };
}

const input = (payment: AdminOrderCreate['payment'], over: Partial<AdminOrderCreate> = {}): AdminOrderCreate => ({
	cart: {
		buyer: { kind: 'business', businessId: 'biz_1' },
		currency: 'INR',
		lines: [{ productId: 'p1', variationId: 'v1', quantity: 2, addons: [] }],
	},
	delivery: { kind: 'new', address: kolkata as never, saveAs: null },
	billing: null,
	indianInvoiceAddress: null,
	couponCodes: [],
	payment,
	comment: null,
	idempotencyKey: 'key-0000000000000001',
	...over,
});
const actor = { id: 'adm_1', name: null };
const rights = { belowCost: false, creditOverride: false, keepOpen: true };
const keepOpen = { method: 'keepOpen' } as AdminOrderCreate['payment'];

describe('create order: the remaining cases', () => {
	it('names a customer with nothing else by their id', async () => {
		const { svc } = harness({
			customers: [{ id: 'cus_9', displayName: '  ', email: null, phone: null, status: 'active', addresses: [] }],
		});
		expect((await svc.searchCustomers('', 10))[0]?.name).toBe('cus_9');
	});

	it('lists usable coupons by what they would take off, delivery included, refused ones last', async () => {
		const { svc } = harness({
			coupons: [
				coupon('SMALL', { kind: 'amountOff', value: 100 }),
				coupon('BIG', { minOrderINR: 10_000_000 }),
				coupon('TEN'),
				coupon('FREESHIP', { kind: 'freeDelivery', value: 0 }),
			],
		});
		const options = await svc.couponOptions(input(keepOpen), rights);
		expect(options.map((row) => [row.code, row.wouldTakeINR, row.refusal === null])).toEqual([
			['TEN', 4_000, true],
			['FREESHIP', 200, true],
			['SMALL', 100, true],
			['BIG', 0, false],
		]);
	});

	it('tries a coupon alone when it does not combine, and only with switched-on combining others', async () => {
		const others = [
			coupon('OFF', { enabled: false }),
			coupon('SOLO', { combines: false }),
			coupon('FREESHIP', { kind: 'freeDelivery', value: 0 }),
		];
		const { svc } = harness({ coupons: others });
		const { id: _id, enabled: _on, usedCount: _used, ...fields } = coupon('WEDDING10');
		const items = [{ productId: 'p1', variantId: 'v1', quantity: 2 }];
		const alone = await svc.couponTry({
			coupon: { ...fields, combines: false } as never,
			items,
			deliveryINR: 100,
			withCodes: ['FREESHIP'],
		});
		expect(alone.used.map((row) => row.code)).toEqual(['WEDDING10']);
		const together = await svc.couponTry({
			coupon: fields as never,
			items,
			deliveryINR: 100,
			withCodes: ['OFF', 'SOLO', 'WEDDING10', 'FREESHIP', 'NONE'],
		});
		expect(together.used.map((row) => row.code)).toEqual(['WEDDING10', 'FREESHIP']);
	});

	it('works out the delivery charge for a try when none is given, and none when the tester fails or there are no settings', async () => {
		const { id: _id, enabled: _on, usedCount: _used, ...fields } = coupon('TEN');
		const items = [{ productId: 'p1', variantId: 'v1', quantity: 2 }];
		const priced300 = harness({ tryCart: async () => priced(300) });
		expect(
			(await priced300.svc.couponTry({ coupon: fields as never, items, deliveryINR: 0, withCodes: [] }))
				.deliveryINR,
		).toBe(300);
		const broken = harness({
			tryCart: async () => Promise.reject(new Error('rules down')),
			shippingSettings: null,
		});
		expect(
			(await broken.svc.couponTry({ coupon: fields as never, items, deliveryINR: 0, withCodes: [] })).deliveryINR,
		).toBe(0);
		const unpriced = harness({
			tryCart: async () => ({ status: 'unpriced', amountINR: null, lines: [], groups: [] }),
		});
		expect(
			(await unpriced.svc.couponTry({ coupon: fields as never, items, deliveryINR: 0, withCodes: [] }))
				.deliveryINR,
		).toBe(0);
	});

	it('lists a shop customer’s saved addresses for the checkout', async () => {
		const { svc } = harness({ customerAddresses: [{ id: 'adr_1' }] });
		expect(await svc.buyerAddresses({ kind: 'person', customerId: 'cus_1' })).toEqual([{ id: 'adr_1' }]);
	});

	it('refuses an order with pieces that cannot go to the address', async () => {
		const { svc } = harness({ tryCart: async () => priced(0, ['cantShip']) });
		await expect(svc.create(input(keepOpen), actor, rights)).rejects.toMatchObject({
			response: { issues: [{ code: 'cannot_ship' }] },
		});
	});

	it('records a payment typed but not yet received as waiting, with no receipt, and leaves the order awaiting payment', async () => {
		const { svc, payments } = harness();
		const order = await svc.create(
			input({
				method: 'manual',
				payment: {
					method: 'bankTransfer',
					amountINR: 40_200,
					reference: 'NEFT1',
					receivedOn: null,
					received: false,
					note: null,
					proofMediaId: null,
				},
			} as never),
			actor,
			rights,
		);
		expect(payments[0]).toMatchObject({ state: 'pending', receivedOn: null, receiptNumber: null });
		expect(order.status).toBe('awaiting_payment');
	});

	it('tries the next order number after a clash, returns the first order for a key used meanwhile, and lets other failures through', async () => {
		let tries = 0;
		const retried = harness({
			create: async (order) => {
				tries += 1;
				if (tries < 3) throw new DuplicateOrderKeyError('orderNumber');
				return order;
			},
		});
		expect((await retried.svc.create(input(keepOpen), actor, rights)).status).toBe('open');
		expect(tries).toBe(3);

		const first = { id: 'ord_first' } as Order;
		let looked = 0;
		const raced = harness({
			findByKey: async () => (looked++ === 0 ? null : first),
			create: async () => Promise.reject(new DuplicateOrderKeyError('idempotencyKey')),
		});
		expect(await raced.svc.create(input(keepOpen), actor, rights)).toBe(first);

		const vanished = harness({ create: async () => Promise.reject(new DuplicateOrderKeyError('idempotencyKey')) });
		await expect(vanished.svc.create(input(keepOpen), actor, rights)).rejects.toBeInstanceOf(
			DuplicateOrderKeyError,
		);
		const broken = harness({ create: async () => Promise.reject(new Error('database down')) });
		await expect(broken.svc.create(input(keepOpen), actor, rights)).rejects.toThrow('database down');
	});

	it('prices a foreign-currency order through PayPal at the stored rate, offering manual methods only in the order currency when set so', async () => {
		const gbp = harness({ view: cartView('GBP', 4), orderSettings: { manualPaymentCurrency: 'orderCurrency' } });
		const quote = await gbp.svc.quote(
			input(keepOpen, { cart: { ...input(keepOpen).cart, currency: 'GBP' } }),
			rights,
		);
		expect(quote).toMatchObject({ currency: 'GBP', gateway: 'paypal' });
		expect(quote.methodsOff).toContainEqual({ method: 'upi', reason: 'foreignCurrency' });
		const order = await gbp.svc.create(
			input(keepOpen, { cart: { ...input(keepOpen).cart, currency: 'GBP' } }),
			actor,
			rights,
		);
		expect(order.currencyRecord).toMatchObject({ source: 'fetch', inrPerUnit: expect.any(Number) });
		const homeOnly = harness({ view: cartView('GBP', 4) });
		const homeQuote = await homeOnly.svc.quote(input(keepOpen), rights);
		expect(homeQuote.methodsOff.some((row) => row.reason === 'foreignCurrency')).toBe(false);
	});

	it('places an on-account order with no message planned when there is no notice service', async () => {
		const { svc } = harness({ notices: false });
		const order = await svc.create(
			input({ method: 'onAccount', creditOverrideReason: null } as never),
			actor,
			rights,
		);
		expect(order.status).toBe('placed');
		expect(order.history[0]?.messages).toEqual([]);
	});
});
