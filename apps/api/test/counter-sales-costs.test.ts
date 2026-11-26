import { describe, expect, it, vi } from 'vitest';

import { CounterSalesService } from '../src/counter/counter-sales.service';

/**
 * A counter sale books its cost of goods (found by the full accounts run): each line carries the cost the stock store
 * sold it at, before the order is saved and the invoice issued. A line the store gave no cost for keeps none.
 */

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
const line = (id: string | undefined, price: number) => ({
	lineId: id,
	productId: `p_${id ?? 'loose'}`,
	variationId: null,
	title: `Item ${id ?? 'loose'}`,
	sku: `SKU-${id ?? 'loose'}`,
	quantity: 1,
	soldBy: 'piece',
	imageUrl: null,
	unitPriceINR: price,
	unitPrice: price,
	lineTotal: price,
	lineTotalINR: price,
	mrpINR: null,
	setHeading: null,
	children: [],
	addOnsZonePriced: false,
	addons: [],
	options: [],
	measurements: [],
	problem: null,
});

type CostedLine = { lineId?: string; held: boolean; unitCostINR: number | null };

/** The counter service with a cart of three lines: one the store costs, one it has no cost for, one with no id. */
function setup() {
	const created: { lines: CostedLine[] }[] = [];
	const sell = vi.fn(async () => new Map([['a', 2500]]));
	const issueAtCounter = vi.fn(async (order: { lines: CostedLine[] }) => ({
		id: 'inv_1',
		number: 'TI/26-27/000151',
		order,
	}));
	const service = new CounterSalesService(
		{
			price: async () => ({
				lines: [line('a', 1250), line('b', 700), line(undefined, 500)],
				subtotalINR: 2450,
			}),
		} as never,
		{ reserve: async () => undefined, sell } as never,
		{ issueAtCounter } as never,
		{ paymentReceived: async () => undefined } as never,
		{
			chart: async () => ({
				ledgers: [{ id: 'led_upi', active: true, systemKey: 'upi_card_clearing', roles: [] }],
			}),
		} as never,
		{ orderNumber: async () => 'ST-2611-000001', issue: async () => 'RC/26-27/000001' } as never,
		{ limitOn: async () => 200_000 } as never,
		{ access: async () => ({ userId: 'adm_priya', all: true, locationIds: [] }) } as never,
		{ create: async (order: { lines: CostedLine[] }) => (created.push(order), order) } as never,
		{ save: async () => undefined } as never,
		{ findByPhone: async () => null } as never,
		{ list: async () => [STORE] } as never,
		{ boxes: async () => [], openSheet: async () => null } as never,
		{ withTransaction: (work: (context: object) => Promise<unknown>) => work({}) } as never,
	);
	return { service, sell, issueAtCounter, created };
}

describe('the cost a counter sale books', () => {
	it('stamps each line with the cost the stock store sold it at, before the order is saved and invoiced', async () => {
		const { service, sell, issueAtCounter, created } = setup();
		await service.sell(
			{
				locationId: 'loc_gar',
				lines: [
					{ productId: 'p_a', variationId: null, quantity: 1, scanned: true },
					{ productId: 'p_b', variationId: null, quantity: 1, scanned: true },
					{ productId: 'p_loose', variationId: null, quantity: 1, scanned: false },
				],
				buyer: { phone: '', name: '', address: '', gstin: '' },
				payments: [{ method: 'card', amountINR: 2450, reference: '' }],
				cashHandedINR: 0,
				print: 'roll80',
				expectedTotalINR: 2450,
			} as never,
			{ userId: 'adm_priya' } as never,
			NOW,
		);
		// The store is asked while every piece is still held.
		expect(sell).toHaveBeenCalledOnce();
		// 'b' is missing from the store's answer and the third line has no id: neither has a cost of its own.
		const costs = (lines: CostedLine[]) => lines.map((l) => [l.lineId, l.held, l.unitCostINR]);
		const expected = [
			['a', false, 2500],
			['b', false, null],
			[undefined, false, null],
		];
		expect(costs(created[0]?.lines ?? [])).toEqual(expected);
		const invoiced = issueAtCounter.mock.calls[0]?.[0];
		expect(costs(invoiced?.lines ?? [])).toEqual(expected);
	});
});
