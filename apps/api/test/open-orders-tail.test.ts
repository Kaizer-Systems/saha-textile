import { Order, OrderSettings } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { OpenOrdersService } from '../src/admin-orders/open-orders.service';

const line = (lineId: string, total: number, over: Record<string, unknown> = {}) => ({
	lineId,
	productId: `p_${lineId}`,
	variationId: null,
	title: { en: `Saree ${lineId}` },
	sku: `SAR-${lineId}`,
	quantity: 1,
	unitPriceINR: total,
	unitPricePaid: total,
	lineTotalINR: total,
	lineTotalPaid: total,
	held: true,
	...over,
});

const delivery = { fullName: 'Nila', line1: '1 High St', city: 'Kolkata', country: 'IN' };

const open = (over: Record<string, unknown> = {}) =>
	Order.parse({
		id: 'ord_1',
		orderNumber: 'ST-2611-482190',
		currency: 'INR',
		lines: [line('a', 20_000)],
		subtotalINR: 20_000,
		subtotalPaid: 20_000,
		totalINR: 20_000,
		totalPaid: 20_000,
		status: 'open',
		openedAt: '2026-09-01T05:00:00.000Z',
		buyer: { kind: 'business', businessId: 'biz_1', name: 'Boutique Nila' },
		addresses: { billing: delivery, delivery },
		...over,
	});

const priced = (over: Record<string, unknown> = {}) => ({
	status: 'priced',
	amountINR: 500,
	groups: [
		{ ruleSetId: 'rs1', version: 2, trace: [{ step: 'base' }] },
		{ ruleSetId: null, version: null, ruleSetName: 'Loose', trace: [] },
	],
	lines: [{ lineId: 'a', units: 1, discounted: false }],
	...over,
});

interface Setup {
	quote?: Record<string, unknown>;
	business?: Record<string, unknown> | null;
	viewLines?: Array<Record<string, unknown>>;
}

function harness(order: Order, setup: Setup = {}) {
	let stored = order;
	const tried: unknown[] = [];
	const ledger: Array<Record<string, unknown>> = [];
	const svc = new OpenOrdersService(
		{
			get: async () => stored,
			detail: async () => ({ order: stored }),
			tell: async () => undefined,
			told: () => [],
			settle: async (next: Order) => {
				stored = next;
				return next;
			},
			updateRaw: async (next: Order) => {
				stored = next;
				return next;
			},
		} as never,
		{ price: async () => ({ lines: setup.viewLines ?? [] }) } as never,
		{
			tryCart: async (request: unknown) => {
				tried.push(request);
				return setup.quote ?? priced();
			},
		} as never,
		{ reserve: async () => undefined, release: async () => undefined } as never,
		{ listByOrder: async () => [] } as never,
		{ get: async () => OrderSettings.parse({}) } as never,
		{ findById: async () => setup.business ?? null } as never,
		{ balance: async () => 0, append: async (entry: Record<string, unknown>) => ledger.push(entry) } as never,
		{ withTransaction: async (work: (context: unknown) => Promise<unknown>) => work({}) } as never,
	);
	return { svc, tried, ledger, current: () => stored };
}

const actor = { id: 'adm_1', name: null };
const rights = { belowCost: false, creditOverride: false, keepOpen: true };
const close = (then: string) => ({ then, currency: 'INR', revision: 0 }) as never;
const account = { id: 'biz_1', roles: { customer: { creditLimitINR: 900_000, creditDays: 30, standing: 'active' } } };

describe('open orders: the last cases', () => {
	it('adds a set with its pieces beneath it, each piece added by the same person', async () => {
		const { svc, current } = harness(open({ lines: [] }), {
			viewLines: [
				{
					lineId: 'set_1',
					productId: 'p_set',
					variationId: null,
					title: 'Peacock set',
					sku: 'SET-1',
					quantity: 1,
					soldBy: 'piece',
					imageUrl: null,
					unitPriceINR: 4_000,
					lineTotalINR: 4_000,
					mrpINR: null,
					zonePrice: null,
					problem: null,
					options: [],
					measurements: [],
					addOnsZonePriced: false,
					setHeading: 'components',
					children: [
						{
							role: 'piece',
							key: 'a',
							parentKey: null,
							level: null,
							productId: 'p_a',
							title: 'Piece a',
							sku: 'PC-a',
							image: null,
							variantId: null,
							variantLabel: null,
							quantity: 1,
							priceINR: 4_000,
							mrpINR: null,
						},
					],
				},
			],
		});
		await svc.addLines('ord_1', { lines: [], revision: 0 } as never, actor, rights);
		expect(current().lines.map((row) => [row.lineId, row.role, row.addedBy, row.held])).toEqual([
			['set_1', 'bundle', 'adm_1', false],
			['set_1~a', 'piece', 'adm_1', true],
		]);
	});

	it('previews a parcel to an address with no country code or pincode, its trace and pieces, for a person', async () => {
		const { svc, tried } = harness(
			open({
				buyer: { kind: 'person', customerId: 'cus_1', name: 'Ananya' },
				lines: [line('a', 20_000), line('s', 0, { role: 'bundle', quantity: 3 })],
			}),
			{ quote: priced({ zone: undefined }) },
		);
		const preview = await svc.closePreview('ord_1');
		expect(tried[0]).toMatchObject({ delivery: { country: 'IN', state: null, pincode: null } });
		expect(preview).toMatchObject({
			pieces: 1,
			shippingINR: 500,
			zone: null,
			shippingTrace: [JSON.stringify({ step: 'base' })],
			shippingPieces: [{ lineId: 'a', units: 1, discounted: false }],
			toAccount: null,
			problem: null,
		});
	});

	it('names what stops a close: no delivery address, a parcel that cannot be priced, a business with no account', async () => {
		const bare = harness(open({ addresses: undefined }));
		expect(await bare.svc.closePreview('ord_1')).toMatchObject({ problem: 'no_addresses', shippingINR: null });
		const stuck = harness(open(), { quote: priced({ status: 'no_rule', amountINR: null }) });
		expect(await stuck.svc.closePreview('ord_1')).toMatchObject({ problem: 'cannot_ship', shippingTrace: [] });
		const unpriced = harness(open(), { quote: priced({ amountINR: null }) });
		expect((await unpriced.svc.closePreview('ord_1')).problem).toBe('cannot_ship');
		const supplierOnly = harness(open(), { business: { id: 'biz_1', roles: { supplier: {} } } });
		expect((await supplierOnly.svc.closePreview('ord_1')).toAccount).toBeNull();
	});

	it('refuses to close with nothing on it, without an address, or when the parcel cannot be priced', async () => {
		await expect(
			harness(open({ lines: [] })).svc.close('ord_1', close('recordLater'), actor),
		).rejects.toMatchObject({ response: { issues: [{ code: 'nothing_to_close' }] } });
		await expect(
			harness(open({ addresses: undefined })).svc.close('ord_1', close('recordLater'), actor),
		).rejects.toMatchObject({ response: { issues: [{ code: 'no_addresses' }] } });
		await expect(
			harness(open(), { quote: priced({ status: 'no_rule', amountINR: null }) }).svc.close(
				'ord_1',
				close('recordLater'),
				actor,
			),
		).rejects.toMatchObject({ response: { issues: [{ code: 'cannot_ship', params: { status: 'no_rule' } }] } });
	});

	it('refuses to put a person’s order on account', async () => {
		const { svc } = harness(open({ buyer: { kind: 'person', customerId: 'cus_1', name: 'Ananya' } }));
		await expect(svc.close('ord_1', close('toAccount'), actor)).rejects.toMatchObject({
			response: { issues: [{ code: 'not_a_business' }] },
		});
	});

	it('closes onto the account with the parcel’s trace, rule sets and pieces, booked by "unknown" without a name', async () => {
		const { svc, current, ledger } = harness(open(), { business: account });
		await svc.close('ord_1', close('toAccount'), { id: null, name: null } as never);
		expect(current().shipping).toMatchObject({
			deliveryCountry: 'IN',
			trace: [JSON.stringify({ step: 'base' })],
			ruleSets: [{ id: 'rs1', version: 2, name: '' }],
			pieces: [{ lineId: 'a', units: 1, discounted: false }],
		});
		expect(ledger[0]).toMatchObject({ kind: 'orderOnAccount', amountINR: 20_500, by: 'unknown' });
	});
});
