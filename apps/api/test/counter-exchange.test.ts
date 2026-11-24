import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { PERMISSIONS_KEY } from '../src/auth/session.guard';
import { CounterController } from '../src/counter/counter.controller';
import { CounterModule } from '../src/counter/counter.module';
import { CounterExchangeService, phoneOf } from '../src/counter/counter-exchange.service';

/** Exchange at the counter (accounts brief P3): a credit note for what comes back, a new sale for what goes out. */

const NOW = new Date('2026-11-24T06:00:00.000Z');
const ORDERS: Record<string, unknown> = {
	ord_c: {
		id: 'ord_c',
		orderNumber: 'ST-2611-000009',
		channel: 'counter',
		shipsFromLocationId: 'loc_gar',
		totalINR: 1900,
		buyer: { name: 'Shreya Ghosh', mobile: '+91 98311 22334', gstin: null },
		addresses: { billing: { line1: 'Kolkata' } },
	},
	ord_gst: {
		id: 'ord_gst',
		orderNumber: 'ST-2611-000010',
		channel: 'counter',
		shipsFromLocationId: 'loc_gar',
		totalINR: 1900,
		buyer: {
			name: 'Bose Textiles',
			mobile: { countryCallingCode: '91', number: '9831122334' },
			gstin: '19AAAAA0000A1Z5',
		},
		addresses: { billing: { line1: '5 Lake Rd' } },
	},
	ord_anon: {
		id: 'ord_anon',
		orderNumber: 'ST-2611-000011',
		channel: 'counter',
		shipsFromLocationId: 'loc_gar',
		totalINR: 60_000,
		buyer: { name: 'Counter sale', mobile: null, gstin: null },
		addresses: {},
	},
	ord_nobuyer: {
		id: 'ord_nobuyer',
		orderNumber: 'ST-4',
		channel: 'counter',
		shipsFromLocationId: 'loc_gar',
		totalINR: 10,
	},
	ord_far: { id: 'ord_far', orderNumber: 'ST-3', channel: 'counter', shipsFromLocationId: null, totalINR: 10 },
	ord_shop: { id: 'ord_shop', channel: 'shop', shipsFromLocationId: 'loc_gar' },
};

function setup(options: { scope?: { all: boolean; ids: string[] }; backINR?: number } = {}) {
	const steps: string[] = [];
	const returns = {
		view: vi.fn(async () => ({
			invoiceNumber: 'TI/26-27/000153',
			deliveredOn: '2026-11-23',
			windowOpen: true,
			returnable: [{ lineId: 'a', sku: 'TNT', title: 'Tant', bought: 1, returnedBefore: 0, returnable: true }],
		})),
		start: vi.fn(async () => (steps.push('start'), { id: 'ret_1' })),
		step: vi.fn(async () => void steps.push('received')),
		check: vi.fn(async () => void steps.push('check')),
		fromReturn: vi.fn(async () => (steps.push('draft'), { id: 'cn_1', version: 0 })),
		issue: vi.fn(
			async () => (
				steps.push('issue'),
				{ id: 'cn_1', number: 'CN/26-27/000014', totalINR: options.backINR ?? 1250 }
			),
		),
		refund: vi.fn(async () => void steps.push('refund')),
	};
	const sales = {
		openTill: vi.fn(async () => (steps.push('till'), 'led_till')),
		sell: vi.fn(async () => (steps.push('sell'), { orderId: 'ord_new', invoiceNumber: 'TI/26-27/000154' })),
	};
	const service = new CounterExchangeService(
		returns as never,
		sales as never,
		{ scope: async () => ({ current: null, ...(options.scope ?? { all: false, ids: ['loc_gar'] }) }) } as never,
		{
			findById: async (id: string) => ORDERS[id] ?? null,
			findByNumber: async (n: string) => (n === 'ST-2611-000009' ? ORDERS['ord_c'] : null),
		} as never,
		{ withTransaction: (work: (context: object) => Promise<unknown>) => work({}) } as never,
		{
			list: async (q: { search: string }) => ({
				items: [
					{ number: 'TI/26-27/000153', orderId: 'ord_c' },
					{ number: 'TI/26-27/000155', orderId: 'ord_shop' },
				].filter((i) => i.number.includes(q.search)),
				total: 1,
			}),
		} as never,
	);
	return { service, returns, sales, steps };
}

const principal = { userId: 'adm_priya' } as never;
const write = (patch: Record<string, unknown> = {}) =>
	({
		back: [{ lineId: 'a', quantity: 1, goes: 'stock' }],
		out: [{ productId: 'p_ptc', variationId: null, quantity: 1, scanned: true }],
		reason: 'size_or_fit',
		settle: 'cash',
		reference: '',
		expectedBackINR: 1250,
		expectedOutINR: 650,
		...patch,
	}) as never;

describe('an exchange at the counter (P3)', () => {
	it('credits what came back, refunds it in cash from the till and sells what goes out with that cash, in one go', async () => {
		const { service, returns, sales, steps } = setup();
		const done = await service.exchange('ord_c', write(), principal, NOW);
		expect(done).toEqual({
			creditNoteId: 'cn_1',
			creditNoteNumber: 'CN/26-27/000014',
			backINR: 1250,
			outINR: 650,
			differenceINR: -600,
			sale: { orderId: 'ord_new', invoiceNumber: 'TI/26-27/000154' },
		});
		expect(steps).toEqual(['till', 'start', 'received', 'check', 'draft', 'issue', 'refund', 'sell']);
		expect(returns.start).toHaveBeenCalledWith(
			'ord_c',
			expect.objectContaining({
				lines: [{ lineId: 'a', quantity: 1 }],
				reason: 'size_or_fit',
				refundTo: 'original_payment',
			}),
			'adm_priya',
			NOW,
		);
		expect(returns.refund).toHaveBeenCalledWith(
			'cn_1',
			{ how: 'by_hand', method: 'cash', ledgerId: 'led_till', reference: 'CASH CN/26-27/000014' },
			'adm_priya',
			NOW,
		);
		expect(sales.sell).toHaveBeenCalledWith(
			expect.objectContaining({
				locationId: 'loc_gar',
				payments: [{ method: 'cash', amountINR: 650, reference: '' }],
				cashHandedINR: 650,
				buyer: { phone: '+91 98311 22334', name: 'Shreya Ghosh', address: '', gstin: '' },
				expectedTotalINR: 650,
			}),
			principal,
			NOW,
			'cn_1',
		);
	});

	it('takes a difference the buyer pays by UPI after the credit’s cash, and keeps a damaged piece back', async () => {
		const { service, sales, returns } = setup({ backINR: 650 });
		const done = await service.exchange(
			'ord_gst',
			write({
				back: [{ lineId: 'a', quantity: 1, goes: 'damaged' }],
				settle: 'upi',
				reference: '409912345678',
				expectedBackINR: 650,
				expectedOutINR: 1250,
			}),
			undefined,
			NOW,
		);
		expect(done.differenceINR).toBe(600);
		expect(returns.check).toHaveBeenCalledWith(
			'ret_1',
			{ lines: [{ lineId: 'a', outcome: 'damaged', note: '' }] },
			null,
			NOW,
		);
		expect(sales.sell).toHaveBeenCalledWith(
			expect.objectContaining({
				payments: [
					{ method: 'cash', amountINR: 650, reference: '' },
					{ method: 'upi', amountINR: 600, reference: '409912345678' },
				],
				cashHandedINR: 650,
				buyer: {
					phone: '+91 9831122334',
					name: 'Bose Textiles',
					address: '5 Lake Rd',
					gstin: '19AAAAA0000A1Z5',
				},
			}),
			undefined,
			NOW,
			'cn_1',
		);
		// Even money by card: nothing is owed, so the credit's cash pays it all.
		const even = setup({ backINR: 1250 });
		await even.service.exchange('ord_c', write({ settle: 'card', expectedOutINR: 1250 }), principal, NOW);
		expect(even.sales.sell).toHaveBeenCalledWith(
			expect.objectContaining({ payments: [{ method: 'cash', amountINR: 1250, reference: '' }] }),
			principal,
			NOW,
			'cn_1',
		);
	});

	it('is a plain return when nothing goes out, refunded in cash', async () => {
		const { service, sales } = setup();
		const done = await service.exchange('ord_anon', write({ out: [], expectedOutINR: 999 }), principal, NOW);
		expect([done.outINR, done.differenceINR, done.sale]).toEqual([0, -1250, null]);
		expect(sales.sell).not.toHaveBeenCalled();
	});

	it('refuses a bill that isn’t the counter’s or is out of reach, a changed price, and money back other than cash', async () => {
		const { service } = setup();
		await expect(service.exchange('ord_shop', write(), principal, NOW)).rejects.toThrow('counter_sale_not_found');
		await expect(service.exchange('ord_none', write(), principal, NOW)).rejects.toThrow('counter_sale_not_found');
		await expect(service.exchange('ord_far', write(), principal, NOW)).rejects.toThrow('location_out_of_scope');
		await expect(service.exchange('ord_c', write({ expectedBackINR: 1200 }), principal, NOW)).rejects.toThrow(
			'counter_price_changed',
		);
		await expect(service.exchange('ord_c', write({ settle: 'upi' }), principal, NOW)).rejects.toThrow(
			'counter_exchange_refund_in_cash',
		);
		// Within a rupee of round-off is the same money.
		await expect(
			service.exchange('ord_c', write({ expectedBackINR: 1249.5 }), principal, NOW),
		).resolves.toBeTruthy();
		await expect(
			setup({ scope: { all: true, ids: [] } }).service.exchange('ord_far', write(), principal, NOW),
		).resolves.toBeTruthy();
	});
});

describe('finding a counter bill by its number', () => {
	it('takes the order number or the tax invoice number, and only a counter bill in reach', async () => {
		const { service } = setup();
		expect(await service.find(' st-2611-000009 ', principal)).toEqual({ orderId: 'ord_c' });
		expect(await service.find('ti/26-27/000153', principal)).toEqual({ orderId: 'ord_c' });
		await expect(service.find('TI/26-27/000155', principal)).rejects.toThrow('counter_sale_not_found');
		await expect(service.find('TI/26-27', principal)).rejects.toThrow('counter_sale_not_found');
	});
});

describe('a counter bill for the exchange page', () => {
	it('lists what can still come back, with the buyer as the bill had them', async () => {
		const { service, returns } = setup();
		expect(await service.bill('ord_c', principal, NOW)).toEqual({
			orderId: 'ord_c',
			orderNumber: 'ST-2611-000009',
			locationId: 'loc_gar',
			buyerName: 'Shreya Ghosh',
			buyerPhone: '+91 98311 22334',
			invoiceNumber: 'TI/26-27/000153',
			deliveredOn: '2026-11-23',
			windowOpen: true,
			lines: [{ lineId: 'a', sku: 'TNT', title: 'Tant', bought: 1, returnedBefore: 0, returnable: true }],
		});
		expect(returns.view).toHaveBeenCalledWith('ord_c', '2026-11-24');
		expect((await service.bill('ord_anon', principal, NOW)).buyerName).toBe('');
		expect((await service.bill('ord_nobuyer', principal)).buyerPhone).toBe('');
		expect(phoneOf(null)).toBe('');
	});
});

describe('exchange routes', () => {
	it('are behind cash.count and wired into the API', async () => {
		const exchanges = {
			bill: vi.fn(async () => 'bill'),
			exchange: vi.fn(async () => 'done'),
			find: vi.fn(async () => 'found'),
		};
		const controller = new CounterController({} as never, {} as never, exchanges as never, {} as never);
		expect(await controller.bill('ord_c', principal)).toBe('bill');
		expect(await controller.exchange('ord_c', write(), principal)).toBe('done');
		expect(exchanges.exchange).toHaveBeenCalledWith('ord_c', write(), principal);
		expect(await controller.find({ number: 'ST-1' }, principal)).toBe('found');
		expect(exchanges.find).toHaveBeenCalledWith('ST-1', principal);
		for (const route of ['bill', 'exchange', 'find'] as const)
			expect(new Reflector().get(PERMISSIONS_KEY, CounterController.prototype[route])).toEqual(['cash.count']);
		expect(Reflect.getMetadata('providers', CounterModule)).toContain(CounterExchangeService);
	});
});
