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
			imageUrl: null,
			unitPriceINR: 20_000,
			unitPrice: 20_000,
			lineTotal: 40_000,
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

function harness(cart = view(), limitINR = 200_000, outstanding = 0) {
	const created: Order[] = [];
	const ledger: Array<Record<string, unknown>> = [];
	const reserved: number[] = [];
	const payments: unknown[] = [];
	const svc = new AdminOrderCreateService(
		{
			price: async () => cart,
			buyerZone: async () => ({ zone: { id: 'zone_w', code: 'WHOLESALE', name: 'Wholesale', version: 3 } }),
		} as never,
		{
			factsFor: async () => [{ facts: { categoryPaths: [['cat_silk']], currentSaleINR: null } }],
		} as never,
		{ convert: async () => ({ rateFromINR: 1 }) } as never,
		{ check: async () => checked, add: async () => undefined } as never,
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
		{ get: async () => OrderSettings.parse({}) } as never,
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
		{ findById: async () => null } as never,
		{
			balance: async () => outstanding,
			append: async (entry: Record<string, unknown>) => ledger.push(entry),
		} as never,
		{ findByCode: async () => null, usesBy: async () => 0, recordUse: async () => undefined } as never,
		{ getSettings: async () => ({ abroadPolicy: 'exportOffIndianInvoice', homeCountry: 'IN' }) } as never,
		{ withTransaction: async (work: (context: unknown) => Promise<unknown>) => work({}) } as never,
	);
	return { svc, created, ledger, reserved, payments };
}

const actor = { id: 'adm_1', name: null };
const rights = { belowCost: false, creditOverride: false };

describe('create order (oc01–oc03, ck01–ck08)', () => {
	it('places an order on account: zone snapshot, pieces kept, the account debited with its due date', async () => {
		const { svc, ledger, reserved } = harness();
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
		expect(ledger[0]).toMatchObject({
			kind: 'orderOnAccount',
			amountINR: 40_200,
			dueOn: '2026-12-20',
			documentNumber: 'ST-2611-482190',
		});
	});

	it('returns the first order for a repeated key (a double click)', async () => {
		const { svc, created } = harness();
		const first = await svc.create(input({ method: 'keepOpen' }), actor, rights);
		const again = await svc.create(input({ method: 'keepOpen' }), actor, rights);
		expect(again.id).toBe(first.id);
		expect(created).toHaveLength(1);
		expect(first).toMatchObject({ status: 'open' });
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
			{ belowCost: false, creditOverride: true },
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
			harness(cheap).svc.create(input({ method: 'keepOpen' }), actor, { belowCost: true, creditOverride: false }),
		).resolves.toMatchObject({ status: 'open' });
	});
});
