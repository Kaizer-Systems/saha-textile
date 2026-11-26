import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { PERMISSIONS_KEY } from '../src/auth/session.guard';
import { CounterController } from '../src/counter/counter.controller';
import { CounterModule } from '../src/counter/counter.module';
import { CounterSalesService, counterAddress, counterLines } from '../src/counter/counter-sales.service';

/** Counter mode (accounts brief P1, P2): a sale over a store's counter, invoiced and paid at once. */

const NOW = new Date('2026-11-23T06:10:00.000Z');
const STORE = {
	id: 'loc_gar',
	name: 'Gariahat store',
	active: true,
	address: '12 Rashbehari',
	city: 'Kolkata',
	stateCode: '19',
	pin: '700029',
};
const line = (id: string, price: number, qty = 1) => ({
	lineId: id,
	productId: `p_${id}`,
	variationId: null,
	title: `Item ${id}`,
	sku: `SKU-${id}`,
	quantity: qty,
	soldBy: 'piece',
	imageUrl: null,
	unitPriceINR: price,
	unitPrice: price,
	lineTotal: price * qty,
	lineTotalINR: price * qty,
	mrpINR: id === 'a' ? price + 100 : null,
	setHeading: null,
	children: [],
	addOnsZonePriced: false,
	addons: [],
	options: [],
	measurements: [],
});

function setup(
	options: {
		limit?: number | null;
		openSheet?: boolean;
		clearing?: boolean;
		customer?: boolean;
		scope?: string[] | null;
		problem?: string | null;
	} = {},
) {
	const saved: unknown[] = [];
	const posted: unknown[] = [];
	const moves: string[] = [];
	let n = 0;
	const service = new CounterSalesService(
		{
			price: vi.fn(async (input: { lines: unknown[] }) => ({
				lines: [{ ...line('a', 1250), problem: options.problem ?? null }, line('b', 350, 2)].slice(
					0,
					input.lines.length,
				),
				subtotalINR: input.lines.length === 1 ? 1250 : 1950,
			})),
		} as never,
		{
			reserve: vi.fn(async () => void moves.push('reserve')),
			sell: vi.fn(async (_order: unknown, lines: { held: boolean; lineId?: string }[]) => {
				moves.push(`sell:${lines.every((l) => l.held)}`);
				// The cost each piece left at, as the stock store answers.
				return new Map(lines.flatMap((l) => (l.lineId ? [[l.lineId, 2500] as const] : [])));
			}),
		} as never,
		{
			issueAtCounter: vi.fn(async (order: { orderNumber: string }) => ({
				id: 'inv_1',
				number: 'TI/26-27/000151',
				order,
			})),
		} as never,
		{ paymentReceived: vi.fn(async (payment: unknown) => void posted.push(payment)) } as never,
		{
			chart: async () => ({
				ledgers:
					options.clearing === false
						? []
						: [{ id: 'led_upi', active: true, systemKey: 'upi_card_clearing', roles: [] }],
			}),
		} as never,
		{ orderNumber: async () => 'ST-2611-000001', issue: async () => `RC/26-27/00000${++n}` } as never,
		{ limitOn: async () => (options.limit === undefined ? 200_000 : options.limit) } as never,
		{
			access: async (principal?: { userId: string }) => ({
				userId: principal?.userId ?? null,
				all: options.scope === undefined || options.scope === null,
				locationIds: options.scope ?? [],
			}),
		} as never,
		{ create: vi.fn(async (order: unknown) => order) } as never,
		{ save: vi.fn(async (payment: unknown) => void saved.push(payment)) } as never,
		{
			findByPhone: async () =>
				options.customer ? { id: 'cus_1', displayName: 'Shreya Ghosh', email: 's@example.test' } : null,
		} as never,
		{ list: async () => [STORE, { ...STORE, id: 'loc_old', active: false }] } as never,
		{
			boxes: async () => [
				{ id: 'box_petty', ledgerId: 'led_petty', locationId: 'loc_gar', kind: 'fixed_float', active: true },
				{ id: 'box_till', ledgerId: 'led_till', locationId: 'loc_gar', kind: 'day_sheet', active: true },
			],
			openSheet: async (boxId: string) =>
				options.openSheet === false ? null : boxId === 'box_till' ? { id: 'sh1' } : null,
		} as never,
		{ withTransaction: (work: (context: object) => Promise<unknown>) => work({}) } as never,
	);
	return { service, saved, posted, moves };
}

const principal = { userId: 'adm_priya' } as never;
const sale = (patch: Record<string, unknown> = {}) =>
	({
		locationId: 'loc_gar',
		lines: [
			{ productId: 'p_a', variationId: null, quantity: 1, scanned: true },
			{ productId: 'p_b', variationId: null, quantity: 2, scanned: false },
		],
		buyer: { phone: '+91 98311 22334', name: 'Shreya Ghosh', address: '', gstin: '' },
		payments: [
			{ method: 'upi', amountINR: 950, reference: '409912345678' },
			{ method: 'cash', amountINR: 1000, reference: '' },
		],
		cashHandedINR: 1500,
		print: 'roll80',
		expectedTotalINR: 1950,
		...patch,
	}) as never;

describe('a counter sale (P2)', () => {
	it('sells, invoices, takes each payment where it lands and gives the change, in one go', async () => {
		const { service, saved, posted, moves } = setup({ customer: true });
		const result = await service.sell(sale(), principal, NOW);
		expect(result).toEqual({
			orderId: expect.stringMatching(/^ord_/),
			orderNumber: 'ST-2611-000001',
			invoiceId: 'inv_1',
			invoiceNumber: 'TI/26-27/000151',
			totalINR: 1950,
			changeINR: 500,
			receiptNumbers: ['RC/26-27/000001', 'RC/26-27/000002'],
			print: 'roll80',
		});
		expect(moves).toEqual(['reserve', 'sell:true']);
		expect(saved.map((p) => [(p as { method: string }).method, (p as { ledgerId: string }).ledgerId])).toEqual([
			['upi', 'led_upi'],
			['cash', 'led_till'],
		]);
		expect(posted).toHaveLength(2);
	});

	it('marks a sale that is the going-out half of an exchange', async () => {
		const created: { history: { detail: Record<string, string> }[] }[] = [];
		const { service } = setup();
		const orders = (service as unknown as { orders: { create: (o: never) => Promise<unknown> } }).orders;
		const create = orders.create;
		orders.create = async (o: never) => (created.push(o), create(o));
		await service.sell(sale(), principal, NOW, 'cn_1');
		expect(created[0]?.history[0]?.detail).toEqual({ counter: 'exchange', creditNoteId: 'cn_1' });
	});

	it('sells for UPI only with no open sheet, and with no phone or name', async () => {
		const { service } = setup({ openSheet: false });
		const result = await service.sell(
			sale({
				lines: [{ productId: 'p_a', variationId: null, quantity: 1, scanned: false }],
				payments: [{ method: 'card', amountINR: 1250, reference: '' }],
				buyer: { phone: '', name: '', address: '', gstin: '' },
				cashHandedINR: 0,
				expectedTotalINR: 1250,
			}),
			undefined,
			NOW,
		);
		expect(result.changeINR).toBe(0);
	});

	it('refuses what a counter can’t take', async () => {
		const refused = async (options: Parameters<typeof setup>[0], patch: Record<string, unknown>, code: string) =>
			expect(setup(options).service.sell(sale(patch), principal, NOW)).rejects.toThrow(code);
		await refused({ scope: ['loc_bar'] }, {}, 'location_out_of_scope');
		await refused({}, { locationId: 'loc_old' }, 'location_unknown');
		await refused({}, { locationId: 'loc_none' }, 'location_unknown');
		await refused({}, { expectedTotalINR: 1900 }, 'counter_price_changed');
		await refused(
			{},
			{ payments: [{ method: 'cash', amountINR: 100, reference: '' }] },
			'counter_payments_dont_add_up',
		);
		await refused(
			{},
			{ buyer: { phone: '', name: 'X', address: '', gstin: '19AAAAA0000A1Z5' } },
			'counter_address_needed',
		);
		await refused({ limit: 900 }, {}, 'cash_receipt_over_limit');
		await refused({}, { cashHandedINR: 900 }, 'cash_handed_short');
		await refused({ openSheet: false }, {}, 'cash_sheet_not_open');
		await refused({ clearing: false }, {}, 'role_not_mapped:upi_card_clearing');
		await refused({ problem: 'out_of_stock' }, {}, 'counter_line_problem:out_of_stock:SKU-a');
		// Only a few left is still sold.
		await expect(setup({ problem: 'limited' }).service.sell(sale(), principal, NOW)).resolves.toBeTruthy();
		// No limit set: any cash is taken.
		await expect(setup({ limit: null }).service.sell(sale(), principal, NOW)).resolves.toBeTruthy();
	});

	it('needs the buyer’s address from ₹50,000, and takes it when given', async () => {
		const big = setup();
		const write = sale({ expectedTotalINR: 1950 });
		await expect(
			big.service.sell(
				{
					...(write as object),
					buyer: { phone: '', name: 'A', address: '5 Lake Rd', gstin: '19AAAAA0000A1Z5' },
				} as never,
				principal,
				NOW,
			),
		).resolves.toBeTruthy();
	});
});

describe('the counter’s order lines', () => {
	it('keeps a set as its own line with its pieces beneath, each marked as added by the person selling', () => {
		const set = {
			...line('s', 3000),
			setHeading: 'components',
			children: [
				{
					role: 'piece',
					key: 'k1',
					parentKey: null,
					level: null,
					productId: 'p_c',
					title: 'Petticoat',
					sku: 'PTC',
					image: null,
					variantId: null,
					variantLabel: null,
					quantity: 1,
					priceINR: 3000,
					mrpINR: null,
				},
			],
		};
		const lines = counterLines([set as never], NOW.toISOString(), 'adm_priya');
		expect(lines.length).toBeGreaterThan(1);
		expect(lines.at(-1)).toMatchObject({ lineId: 's~k1', addedBy: 'adm_priya' });
	});
});

describe('the counter bill’s address', () => {
	it('is the buyer’s as typed, else the store’s city and State', () => {
		expect(counterAddress('', '', STORE)).toMatchObject({
			fullName: 'Counter sale',
			line1: 'Kolkata',
			city: 'Kolkata',
			gstStateCode: '19',
		});
		expect(counterAddress('Shreya', '5 Lake Rd', STORE)).toMatchObject({ fullName: 'Shreya', line1: '5 Lake Rd' });
		expect(counterAddress('', '', { ...STORE, city: '', address: '' })).toMatchObject({
			line1: 'Counter',
			city: 'Counter',
		});
		expect(counterAddress('', '', { ...STORE, city: '' })).toMatchObject({ line1: '12 Rashbehari' });
	});
});

describe('counter routes', () => {
	it('sells as the person acting, behind cash.count, and is wired into the API', async () => {
		const sell = vi.fn(async () => 'sold');
		const controller = new CounterController({ sell } as never, {} as never, {} as never, {} as never);
		expect(await controller.sell(sale(), principal)).toBe('sold');
		expect(sell).toHaveBeenCalledWith(sale(), principal);
		expect(new Reflector().get(PERMISSIONS_KEY, CounterController.prototype.sell)).toEqual(['cash.count']);
		expect(Reflect.getMetadata('providers', CounterModule)).toContain(CounterSalesService);
	});
});
