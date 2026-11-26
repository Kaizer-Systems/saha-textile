import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { PERMISSIONS_KEY } from '../src/auth/session.guard';
import { CounterController } from '../src/counter/counter.controller';
import { CounterModule } from '../src/counter/counter.module';
import { CounterSummaryService } from '../src/counter/counter-summary.service';

/** The counter summary (accounts brief P4): a store's day; the cashier's copy leaves out cash. */

const order = (id: string, patch: Record<string, unknown> = {}) => ({
	id,
	channel: 'counter',
	shipsFromLocationId: 'loc_gar',
	totalINR: 1000,
	createdAt: `2026-11-24T0${id.length % 9}:00:00.000Z`,
	lines: [{ couponINR: 0 }, { couponINR: 50 }],
	history: [{ detail: { counter: 'sold' } }],
	...patch,
});
const DAY = [
	order('o1', { createdAt: '2026-11-24T04:30:00.000Z' }),
	order('o22', {
		createdAt: '2026-11-24T10:15:00.000Z',
		history: [{ detail: { counter: 'exchange' } }],
		totalINR: 650,
	}),
	order('o333', { createdAt: undefined, history: [] }),
	order('far', { shipsFromLocationId: 'loc_bar' }),
];
const PAYMENTS: Record<string, unknown[]> = {
	o1: [
		{ method: 'cash', amountINR: 2500, state: 'received' },
		{ method: 'upi', amountINR: 1500, state: 'received' },
	],
	o22: [{ method: 'cash', amountINR: 650, state: 'received' }],
	o333: [
		{ method: 'card', amountINR: 900, state: 'received' },
		{ method: 'card', amountINR: 100, state: 'failed' },
		{ method: 'setOff', amountINR: 5, state: 'received' },
	],
};
const NOTES = [
	{ id: 'cn1', orderId: 'o_old', locationId: 'loc_gar', totalINR: 1250 },
	{ id: 'cn2', orderId: 'o_shop', locationId: 'loc_gar', totalINR: 300 },
	{ id: 'cn3', orderId: 'o_old', locationId: 'loc_bar', totalINR: 99 },
];

function setup(options: { manager?: boolean; scope?: string[] | null; tills?: unknown[]; emptyPage?: boolean } = {}) {
	const list = vi.fn(async (q: { page: number }) =>
		options.emptyPage
			? { orders: [], total: 500 }
			: q.page === 1
				? { orders: DAY.slice(0, 2), total: 104 }
				: { orders: DAY.slice(2), total: 104 },
	);
	const service = new CounterSummaryService(
		{
			access: async () => ({
				all: options.scope === undefined || options.scope === null,
				locationIds: options.scope ?? [],
				manager: options.manager ?? true,
			}),
		} as never,
		{
			list,
			findById: async (id: string) =>
				({ o_old: { channel: 'counter' }, o_shop: { channel: 'shop' } })[id] ?? null,
		} as never,
		{ listByOrder: async (id: string) => PAYMENTS[id] ?? [] } as never,
		{
			listForOrder: async (id: string) =>
				id === 'o1'
					? [
							{ number: 'TI/26-27/000154', status: 'issued' },
							{ number: 'TI/26-27/000150', status: 'cancelled' },
						]
					: [{ number: `TI/26-27/${id}`, status: 'issued' }],
		} as never,
		{
			list: async (q: { page: number }) =>
				q.page === 1 ? { items: NOTES.slice(0, 2), total: 103 } : { items: NOTES.slice(2), total: 103 },
		} as never,
		{ list: async () => [{ id: 'loc_gar', name: 'Gariahat store' }] } as never,
		{
			boxes: async () =>
				options.tills ?? [
					{ id: 'petty', kind: 'fixed_float', active: true, locationId: 'loc_gar' },
					{ id: 'old', kind: 'day_sheet', active: false, locationId: 'loc_gar' },
					{ id: 't0', kind: 'day_sheet', active: true, locationId: 'loc_gar' },
					{ id: 't1', kind: 'day_sheet', active: true, locationId: 'loc_gar' },
					{ id: 't2', kind: 'day_sheet', active: true, locationId: 'loc_gar' },
				],
			sheetOn: async (boxId: string) =>
				boxId === 't1' ? { status: 'open' } : boxId === 't2' ? { status: 'closed' } : null,
		} as never,
	);
	return { service, list };
}

const principal = { userId: 'adm_meera' } as never;
const query = { date: '2026-11-24', locationId: 'loc_gar' };

describe('the counter summary (P4)', () => {
	it('adds up the day’s bills by how they were paid, the returns, the exchanges and the sheet, for a manager', async () => {
		const { service, list } = setup();
		expect(await service.summary(query, principal)).toEqual({
			date: '2026-11-24',
			locationId: 'loc_gar',
			locationName: 'Gariahat store',
			byMethod: [
				{ method: 'cash', bills: 2, amountINR: 3150 },
				{ method: 'upi', bills: 1, amountINR: 1500 },
				{ method: 'card', bills: 1, amountINR: 900 },
			],
			returns: { notes: 1, amountINR: 1250 },
			exchangeNew: { bills: 1, amountINR: 650 },
			netSalesINR: 4300,
			billNumbers: ['TI/26-27/000154', 'TI/26-27/o22', 'TI/26-27/o333'],
			firstAt: '2026-11-24T04:30:00.000Z',
			lastAt: '2026-11-24T10:15:00.000Z',
			discountsINR: 150,
			sheetStatus: 'open',
			cash: true,
		});
		expect(list).toHaveBeenCalledWith(
			expect.objectContaining({ channel: 'counter', from: '2026-11-24', to: '2026-11-24', page: 2 }),
		);
	});

	it('leaves cash and the net out of the cashier’s copy', async () => {
		const summary = await setup({ manager: false, scope: ['loc_gar'] }).service.summary(query, principal);
		expect(summary.byMethod[0]).toEqual({ method: 'cash', bills: 2, amountINR: null });
		expect(summary.byMethod[1]?.amountINR).toBe(1500);
		expect([summary.netSalesINR, summary.cash]).toEqual([null, false]);
	});

	it('is empty on a quiet day with no sheet, and refuses a store out of reach or unknown', async () => {
		const quiet = await setup({ emptyPage: true, tills: [] }).service.summary(query, principal);
		expect([quiet.billNumbers, quiet.firstAt, quiet.lastAt, quiet.sheetStatus]).toEqual([[], null, null, null]);
		await expect(setup({ scope: ['loc_bar'] }).service.summary(query, principal)).rejects.toThrow(
			'location_out_of_scope',
		);
		await expect(setup().service.summary({ ...query, locationId: 'loc_none' }, principal)).rejects.toThrow(
			'location_unknown',
		);
	});
});

describe('counter summary route', () => {
	it('is behind cash.count and wired into the API', async () => {
		const summaries = { summary: vi.fn(async () => 'day') };
		const controller = new CounterController({} as never, {} as never, {} as never, summaries as never);
		expect(await controller.summary(query, principal)).toBe('day');
		expect(new Reflector().get(PERMISSIONS_KEY, CounterController.prototype.summary)).toEqual(['cash.count']);
		expect(Reflect.getMetadata('providers', CounterModule)).toContain(CounterSummaryService);
	});
});
