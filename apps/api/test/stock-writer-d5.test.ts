import { describe, expect, it, vi } from 'vitest';

import { StockWriter, type StockChange } from '../src/purchasing/stock-writer';

/**
 * The stock writer (P2, accounts brief D5 E3): every change it makes, and the cost layers it reports — drawn
 * oldest-first with the documents they came from, or made for pieces added (a reversal's at the cost they left at).
 */

const fact = { variantId: 'var_1', productId: 'prd_1', sku: 'PTC-CRM-M', soldBy: 'piece', hsnCode: '5208' };
const layer = (
	id: string,
	receivedAt: string,
	remaining: number,
	unitCostINR: number,
	sourceNumber: string | null,
) => ({
	id,
	variantId: 'var_1',
	receivedAt,
	sourceType: 'opening_stock',
	sourceNumber,
	purchaseInvoiceId: null,
	sourceLineId: null,
	quantityReceived: remaining,
	quantityRemaining: remaining,
	unitCostINR,
});
const open = [
	layer('lay_new', '2026-10-01T00:00:00.000Z', 5, 330, 'PE/26-27/000009'),
	layer('lay_old', '2026-04-01T00:00:00.000Z', 1, 310, 'OS/26-27/000001'),
];

function setup(
	options: { known?: unknown[]; hold?: unknown; outbox?: boolean; bundles?: boolean; item?: boolean } = {},
) {
	const moves: Record<string, unknown>[] = [];
	const savedHolds: Record<string, unknown>[] = [];
	const created: Record<string, unknown>[] = [];
	const consumed: [string, number][] = [];
	const outbox = { request: vi.fn(async () => Promise.reject(new Error('search down'))) };
	const bundles = { refreshContaining: vi.fn(async () => undefined) };
	const writer = new StockWriter(
		{
			items: async () => new Map(options.item === false ? [] : [['var_1', fact]]),
			openLayers: async () => open,
			layersOf: async () => options.known ?? open,
		} as never,
		{
			consumeLayer: async (id: string, quantity: number) => void consumed.push([id, quantity]),
			move: async (movement: { quantityDelta: number; heldDelta: number }) => {
				moves.push(movement);
				return { onHandAfter: 14 + movement.quantityDelta, heldAfter: 2 + movement.heldDelta };
			},
		} as never,
		{ createLayer: async (row: Record<string, unknown>) => void created.push(row) } as never,
		{
			findById: async () => options.hold ?? null,
			save: async (hold: Record<string, unknown>) => void savedHolds.push(hold),
		} as never,
		options.outbox === false ? null : (outbox as never),
		options.bundles === false ? null : (bundles as never),
	);
	return { writer, moves, savedHolds, created, consumed, outbox, bundles };
}

const change = (over: Partial<StockChange> = {}): StockChange => ({
	variantId: 'var_1',
	action: 'remove',
	quantity: 2,
	reasonCode: 'damage',
	holdReason: null,
	holdId: null,
	note: 'Two stained.',
	referenceType: 'stock_adjustment',
	referenceId: 'adj_1',
	referenceNumber: null,
	actor: 'adm_1',
	approver: 'adm_1',
	source: 'manual_adjustment',
	...over,
});
const ctx = { tx: 1 } as never;

describe('the stock writer', () => {
	it('reads an item, refuses one it doesn’t know, and finds holds', async () => {
		const { writer } = setup({ hold: { id: 'hold_1' } });
		expect(await writer.facts('var_1')).toBe(fact);
		await expect(setup({ item: false }).writer.facts('var_x')).rejects.toThrow('Item not found');
		expect(await writer.holdById('hold_1')).toEqual({ id: 'hold_1' });
	});

	it('values pieces oldest-first and names the document each layer came from', async () => {
		const value = await setup().writer.valueOf(fact as never, 2);
		expect(value).toMatchObject({
			valueINR: 640,
			layers: [
				{ quantity: 1, unitCostINR: 310, source: 'OS/26-27/000001' },
				{ quantity: 1, unitCostINR: 330, source: 'PE/26-27/000009' },
			],
		});
	});

	it('writes pieces off: the layers drawn, the movement with its reason and note', async () => {
		const { writer, moves, consumed } = setup();
		const done = await writer.apply(change(), ctx);
		expect(consumed).toEqual([
			['lay_old', 1],
			['lay_new', 1],
		]);
		expect(done).toMatchObject({
			onHandBefore: 14,
			onHandAfter: 12,
			heldBefore: 2,
			heldAfter: 2,
			valueINR: 640,
			holdId: null,
			layers: [
				{ quantity: 1, unitCostINR: 310, source: 'OS/26-27/000001' },
				{ quantity: 1, unitCostINR: 330, source: 'PE/26-27/000009' },
			],
		});
		expect(moves[0]).toMatchObject({ source: 'manual_adjustment', reasonCode: 'damage', note: 'Two stained.' });
	});

	it('writes off held pieces: part of a hold shrinks it, all of it closes it, a missing hold is refused', async () => {
		const part = setup({ hold: { id: 'hold_1', quantity: 3, status: 'open' } });
		const done = await part.writer.apply(change({ holdId: 'hold_1' }), ctx);
		expect([done.heldBefore, done.heldAfter, done.holdId]).toEqual([2, 0, 'hold_1']);
		expect(part.savedHolds[0]).toMatchObject({ quantity: 1, status: 'open' });
		const all = setup({ hold: { id: 'hold_1', quantity: 2, status: 'open' } });
		await all.writer.apply(change({ holdId: 'hold_1' }), ctx);
		expect(all.savedHolds[0]).toMatchObject({ status: 'written_off', closedBy: 'adm_1' });
		await expect(setup().writer.apply(change({ holdId: 'hold_x' }), ctx)).rejects.toThrow('Hold not found');
	});

	it('adds pieces at the latest known cost, at a given cost (a reversal), or at nothing when none is known', async () => {
		const latest = setup();
		const found = await latest.writer.apply(
			change({ action: 'add', note: '', referenceNumber: 'SA/26-27/0005', holdId: 'hold_1' }),
			ctx,
		);
		expect(latest.created[0]).toMatchObject({
			unitCostINR: 330,
			quantityRemaining: 2,
			sourceNumber: 'SA/26-27/0005',
		});
		expect(found).toMatchObject({
			valueINR: 660,
			onHandAfter: 16,
			layers: [{ quantity: 2, unitCostINR: 330, source: 'SA/26-27/0005' }],
		});
		expect(latest.moves[0]).toMatchObject({ note: null });
		expect(latest.savedHolds).toEqual([]);
		const back = setup();
		expect((await back.writer.apply(change({ action: 'add', unitCostINR: 310 }), ctx)).valueINR).toBe(620);
		const none = setup({ known: [] });
		expect((await none.writer.apply(change({ action: 'add', unitCostINR: null }), ctx)).valueINR).toBe(0);
	});

	it('holds pieces with a reason (quality check when none), and releases part or all of a hold', async () => {
		const held = setup();
		const done = await held.writer.apply(change({ action: 'hold', holdReason: 'damaged' }), ctx);
		expect(done.holdId).toMatch(/^hold_/);
		expect(done.layers).toEqual([]);
		expect(held.moves[0]).toMatchObject({ source: 'hold', reasonCode: null, heldDelta: 2 });
		expect(held.savedHolds[0]).toMatchObject({ reason: 'damaged', status: 'open' });
		const checked = setup();
		await checked.writer.apply(change({ action: 'hold' }), ctx);
		expect(checked.savedHolds[0]).toMatchObject({ reason: 'quality_check' });
		const part = setup({ hold: { id: 'hold_1', quantity: 3 } });
		await part.writer.apply(change({ action: 'release', holdId: 'hold_1' }), ctx);
		expect(part.moves[0]).toMatchObject({ source: 'release', heldDelta: -2 });
		expect(part.savedHolds[0]).toMatchObject({ quantity: 1 });
		const all = setup({ hold: { id: 'hold_1', quantity: 2 } });
		await all.writer.apply(change({ action: 'release', holdId: 'hold_1' }), ctx);
		expect(all.savedHolds[0]).toMatchObject({ status: 'released' });
		const loose = setup();
		await loose.writer.apply(change({ action: 'release' }), ctx);
		expect(loose.savedHolds).toEqual([]);
	});

	it('refreshes the shop’s search entries and the bundles holding the pieces, whatever search says', async () => {
		const { writer, outbox, bundles } = setup();
		await writer.refreshShop(['prd_1', 'prd_1', 'prd_2']);
		expect(outbox.request).toHaveBeenCalledWith(['prd_1', 'prd_2'], expect.any(Date));
		expect(bundles.refreshContaining).toHaveBeenCalledWith(['prd_1', 'prd_1', 'prd_2']);
		await setup({ outbox: false, bundles: false }).writer.refreshShop(['prd_1']);
	});
});
