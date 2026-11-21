import { Order, OrderSettings, type AdminCartView, type AdminOrderCreate } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

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

const view = (over: Partial<AdminCartView['lines'][number]> = {}): AdminCartView => ({
	currency: 'INR',
	markupPercent: 0,
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
			zonePrice: {
				kind: 'priced',
				unitPriceINR: 20_000,
				retailUnitPriceINR: 25_000,
				rule: { tier: 'allProducts', ruleId: 'r1', ruleName: 'Wholesale' },
				belowCost: false,
			},
			problem: null,
			...over,
		},
	],
});

const input = (payment: AdminOrderCreate['payment'], key = 'key-0000000000000001'): AdminOrderCreate => ({
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
	idempotencyKey: key,
});

const tenOff = {
	id: 'cpn_ten',
	code: 'TEN',
	title: '10% off',
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
};

const freeShip = { ...tenOff, id: 'cpn_free', code: 'FREESHIP', title: 'Free delivery', kind: 'freeDelivery', value: 0 };

function harness(cart = view(), limitINR = 200_000, outstanding = 0, orderSettings: Record<string, unknown> = {}) {
	const created: Order[] = [];
	const ledger: Array<Record<string, unknown>> = [];
	const reserved: number[] = [];
	const payments: unknown[] = [];
	const saved: Array<[string, unknown]> = [];
	const told: string[] = [];
	const svc = new AdminOrderCreateService(
		{
			price: async () => cart,
			buyerZone: async () => ({ zone: { id: 'zone_w', code: 'WHOLESALE', name: 'Wholesale', version: 3 } }),
		} as never,
		{
			factsFor: async () => [{ facts: { categoryPaths: [['cat_silk']], currentSaleINR: null } }],
		} as never,
		{ convert: async () => ({ rateFromINR: 1 }) } as never,
		{
			check: async () => checked,
			add: async (id: string, address: unknown) => void saved.push([id, address]),
		} as never,
		{
			tryCart: async () => ({
				status: 'priced',
				zone: 'domestic',
				amountINR: 200,
				lines: [{ lineId: 'x', route: 'ruleSet' }],
				groups: [{ ruleSetId: 'rs1', ruleSetName: 'Domestic', version: 2, trace: [] }],
			}),
		} as never,
		{ orderNumber: async () => 'ST-2611-482190', issue: async () => 'RC/26-27/000001' } as never,
		{ reserve: async (_o: Order, lines: Order['lines']) => reserved.push(lines.length) } as never,
		{
			findByIdempotencyKey: async (key: string) =>
				created.find((row) => (row as Order & { key?: string }).key === key) ?? null,
			create: async (order: Order, key: string) => {
				const saved = { ...order, key } as Order;
				created.push(saved);
				return saved;
			},
			countPlacedByCustomer: async () => 0,
		} as never,
		{ save: async (payment: unknown) => payments.push(payment) } as never,
		{ get: async () => OrderSettings.parse(orderSettings) } as never,
		{
			findById: async () => ({
				id: 'biz_1',
				legalName: 'Boutique Nila',
				gstin: '19ABCDE1234F1Z5',
				contacts: [{ id: 'c', name: 'Accounts', email: 'accounts@nila.test', mobile: null, isAccounts: true }],
				addresses: [],
				roles: {
					supplier: false,
					customer: { zoneId: 'zone_w', creditLimitINR: limitINR, creditDays: 30, standing: 'active' },
				},
			}),
		} as never,
		{
			findById: async (id: string) =>
				id === 'cus_1' ? { id: 'cus_1', displayName: 'Kavita Iyer', status: 'active', addresses: [] } : null,
			list: async (query: { q: string; pageSize: number }) => ({
				items: [
					{
						id: 'cus_1',
						displayName: 'Kavita Iyer',
						email: 'kavita@example.test',
						phone: '+91 9831122334',
						status: 'active',
						addresses: [{}, {}],
					},
					{
						id: 'cus_2',
						displayName: '',
						email: 'gone@example.test',
						phone: null,
						status: 'blocked',
						addresses: [],
					},
					{ id: 'cus_3', email: null, phone: '+91 9000000000', status: 'pending', addresses: [] },
				].slice(0, query.pageSize),
				meta: {},
			}),
		} as never,
		{
			balance: async () => outstanding,
			append: async (entry: Record<string, unknown>) => ledger.push(entry),
		} as never,
		{
			findByCode: async (code: string) => (code === 'TEN' ? tenOff : code === 'FREESHIP' ? freeShip : null),
			listUsable: async () => [tenOff],
			usesBy: async () => 0,
			recordUse: async () => undefined,
		} as never,
		{ getSettings: async () => ({ abroadPolicy: 'exportOffIndianInvoice', homeCountry: 'IN' }) } as never,
		{ withTransaction: async (work: (context: unknown) => Promise<unknown>) => work({}) } as never,
		{
			plan: (_order: unknown, templates: string[]) =>
				templates.map((template) => ({ channel: 'email' as const, template })),
			send: async (order: { orderNumber: string }, templates: string[]) =>
				void told.push(...templates.map((template) => `${order.orderNumber}:${template}`)),
		} as never,
	);
	return { svc, created, ledger, reserved, payments, saved, told };
}

const actor = { id: 'adm_1', name: null };
const rights = { belowCost: false, creditOverride: false, keepOpen: true };

describe('create order (oc01–oc03, ck01–ck08)', () => {
	it('lists a business buyer’s saved addresses for the checkout, and refuses an unknown customer', async () => {
		const { svc } = harness();
		expect(await svc.buyerAddresses({ kind: 'business', businessId: 'biz_1' })).toEqual([]);
		await expect(svc.buyerAddresses({ kind: 'person', customerId: 'cus_x' })).rejects.toMatchObject({
			response: { issues: [{ code: 'customer_missing' }] },
		});
	});

	it('saves a new address to the customer only when the order is placed, never on a quote', async () => {
		const { svc, saved } = harness();
		const body: AdminOrderCreate = {
			...input({ method: 'paymentLink' }),
			cart: { ...input({ method: 'paymentLink' }).cart, buyer: { kind: 'person', customerId: 'cus_1' } },
			delivery: { kind: 'new', address: kolkata as never, saveAs: 'Home' },
		};
		await svc.quote(body, rights);
		await svc.quote(body, rights);
		expect(saved).toHaveLength(0);
		await svc.create(body, actor, rights);
		expect(saved).toEqual([['cus_1', expect.objectContaining({ label: 'Home', isDefault: false })]]);
	});

	it('tries an unsaved coupon on a real cart, line by line', async () => {
		const { svc } = harness();
		const { id: _id, enabled: _on, usedCount: _used, ...fields } = tenOff;
		const result = await svc.couponTry({
			coupon: { ...fields, audience: { kind: 'firstOrder' } } as never,
			items: [{ productId: 'p1', variantId: 'v1', quantity: 2 }],
			deliveryINR: 200,
			withCodes: [],
		});
		expect(result).toMatchObject({
			refusal: null,
			applied: { code: 'TEN', amountINR: 4_000 },
			lines: [{ reason: 'applied', amountINR: 4_000, onSale: false }],
			totalBeforeINR: 40_200,
			totalAfterINR: 36_200,
		});
	});

	it('tries a combining coupon together with the others that combine (cp04)', async () => {
		const { svc } = harness();
		const { id: _id, enabled: _on, usedCount: _used, ...fields } = tenOff;
		const result = await svc.couponTry({
			coupon: { ...fields, code: 'WEDDING10' } as never,
			items: [{ productId: 'p1', variantId: 'v1', quantity: 2 }],
			deliveryINR: 100,
			withCodes: ['FREESHIP'],
		});
		expect(result.used.map((row) => row.code)).toEqual(['WEDDING10', 'FREESHIP']);
		expect(result.deliveryOff).toEqual({ code: 'FREESHIP', amountINR: 100 });
		expect(result.lines[0]?.byCoupon).toEqual([{ code: 'WEDDING10', amountINR: 4_000 }]);
		expect(result.totalAfterINR).toBe(36_000);
	});

	it('lists the coupons a checkout can use, with what each would take off', async () => {
		const { svc } = harness();
		expect(await svc.couponOptions(input({ method: 'paymentLink' }), rights)).toEqual([
			expect.objectContaining({ code: 'TEN', wouldTakeINR: 4_000, refusal: null }),
		]);
		expect(await svc.couponOptions({ ...input({ method: 'paymentLink' }), couponCodes: ['TEN'] }, rights)).toEqual(
			[],
		);
	});

	it('finds shop customers for the picker by name, phone or email, leaving out blocked ones', async () => {
		const { svc } = harness();
		expect(await svc.searchCustomers('9831', 10)).toEqual([
			{
				id: 'cus_1',
				name: 'Kavita Iyer',
				email: 'kavita@example.test',
				phone: '+91 9831122334',
				addressCount: 2,
			},
			{ id: 'cus_3', name: '+91 9000000000', email: null, phone: '+91 9000000000', addressCount: 0 },
		]);
	});

	it('places an order on account: zone snapshot, pieces kept, the account debited with its due date', async () => {
		const { svc, ledger, reserved, told } = harness();
		const order = await svc.create(
			input({ method: 'onAccount', creditOverrideReason: null }),
			actor,
			rights,
			new Date('2026-11-20T06:00:00Z'),
		);
		expect(order).toMatchObject({
			orderNumber: 'ST-2611-482190',
			status: 'placed',
			paymentStatus: 'on_account',
			placedWith: 'onAccount',
			zone: { zoneId: 'zone_w', version: 3 },
			totalINR: 40_200,
			buyer: { kind: 'business', email: 'accounts@nila.test', gstin: '19ABCDE1234F1Z5' },
		});
		expect(order.lines[0]).toMatchObject({
			held: true,
			pricing: { zoneRule: { ruleId: 'r1' }, regularUnitINR: 25_000 },
		});
		expect(order.addresses?.invoice).toMatchObject({ source: 'billing', needed: false });
		expect(reserved).toEqual([1]);
		// Placed at once on account: Order confirmed goes once it is saved, and the history says so.
		expect(told).toEqual(['ST-2611-482190:order_confirmed']);
		expect(order.history[0]).toMatchObject({
			kind: 'created',
			messages: [{ channel: 'email', template: 'order_confirmed' }],
		});
		expect(ledger[0]).toMatchObject({
			kind: 'orderOnAccount',
			amountINR: 40_200,
			dueOn: '2026-12-20',
			documentNumber: 'ST-2611-482190',
		});
	});

	it('returns the first order for a repeated key (a double click)', async () => {
		const { svc, created, told } = harness();
		const first = await svc.create(input({ method: 'keepOpen' }), actor, rights);
		const again = await svc.create(input({ method: 'keepOpen' }), actor, rights);
		expect(again.id).toBe(first.id);
		expect(created).toHaveLength(1);
		expect(first).toMatchObject({ status: 'open' });
		// An order kept open tells the customer nothing yet.
		expect(told).toEqual([]);
	});

	it('offers "Keep the order open" only while open orders are on, to staff who may keep them', async () => {
		const allowed = await harness().svc.quote(input({ method: 'keepOpen' }), rights);
		expect(allowed.methodsOff.find((row) => row.method === 'keepOpen')).toBeUndefined();
		const noRight = harness();
		expect(
			(await noRight.svc.quote(input({ method: 'keepOpen' }), { ...rights, keepOpen: false })).methodsOff,
		).toContainEqual({ method: 'keepOpen', reason: 'noPermission' });
		await expect(
			noRight.svc.create(input({ method: 'keepOpen' }), actor, { ...rights, keepOpen: false }),
		).rejects.toMatchObject({ response: { issues: [{ code: 'method_off', params: { reason: 'noPermission' } }] } });
		const switchedOff = harness(view(), 200_000, 0, { openOrders: { enabled: false, remindAfterDays: null } });
		expect((await switchedOff.svc.quote(input({ method: 'keepOpen' }), rights)).methodsOff).toContainEqual({
			method: 'keepOpen',
			reason: 'switchedOff',
		});
		await expect(switchedOff.svc.create(input({ method: 'keepOpen' }), actor, rights)).rejects.toMatchObject({
			response: { issues: [{ code: 'method_off', params: { reason: 'switchedOff' } }] },
		});
		expect(noRight.created).toHaveLength(0);
	});

	it('refuses over the credit limit unless overridden with the permission and a reason (K9)', async () => {
		const over = harness(view(), 30_000, 0);
		await expect(
			over.svc.create(input({ method: 'onAccount', creditOverrideReason: null }), actor, rights),
		).rejects.toMatchObject({
			response: { issues: [{ code: 'method_off', params: { reason: 'overLimit' } }] },
		});
		const allowed = harness(view(), 30_000, 0);
		const order = await allowed.svc.create(
			input({ method: 'onAccount', creditOverrideReason: 'Owner agreed on the phone' }),
			actor,
			{ belowCost: false, creditOverride: true, keepOpen: true },
		);
		expect(order.status).toBe('placed');
	});

	it('records a payment typed at checkout and places the order when it covers the total', async () => {
		const { svc, payments } = harness();
		const order = await svc.create(
			input({
				method: 'manual',
				payment: {
					method: 'upi',
					amountINR: 40_200,
					reference: '402112345678',
					receivedOn: '2026-11-20',
					received: true,
					note: null,
					proofMediaId: null,
					collector: null,
					collectedBy: null,
				},
			}),
			actor,
			rights,
		);
		expect(order).toMatchObject({ status: 'placed', paymentStatus: 'paid' });
		expect(payments).toHaveLength(1);
	});

	it('refuses a line the zone does not price, and a below-cost zone price without the cost permission', async () => {
		const noPrice = harness(view({ problem: 'noZonePrice', zonePrice: { kind: 'noPrice', reason: 'noRule' } }));
		await expect(noPrice.svc.create(input({ method: 'keepOpen' }), actor, rights)).rejects.toMatchObject({
			response: { issues: [{ code: 'cart_problems', params: { skus: 'SAR-1' } }] },
		});
		const cheap = view();
		cheap.lines[0] = {
			...cheap.lines[0],
			zonePrice: { ...(cheap.lines[0]?.zonePrice as object), belowCost: true },
		} as never;
		await expect(harness(cheap).svc.create(input({ method: 'keepOpen' }), actor, rights)).rejects.toMatchObject({
			response: { issues: [{ code: 'zone_price_below_cost' }] },
		});
		await expect(
			harness(cheap).svc.create(input({ method: 'keepOpen' }), actor, { ...rights, belowCost: true }),
		).resolves.toMatchObject({ status: 'open' });
	});
});
