import type { BadRequestException } from '@nestjs/common';
import { StockMovementRefusedError } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import { OpeningStockService } from '../src/purchasing/opening-stock.service';

/**
 * Opening stock (o01): the check, the one-time post with its cost layers, ledger rows and number,
 * the units each product counts as received (owner, 24 Nov), and the list of loads. Every store is
 * in memory; the real-database run is `purchasing-flow.test.ts`.
 */

const TODAY = '2026-11-24';

type Row = Record<string, unknown>;

const factOf = (o: Row = {}): Row => ({
	variantId: 'v1',
	productId: 'p1',
	sku: 'SAR-1',
	title: { en: 'Tant saree' },
	productType: 'simple',
	soldBy: 'piece',
	tracked: true,
	...o,
});

const FACTS: Row[] = [
	factOf(),
	factOf({ variantId: 'v2', sku: 'SAR-2', title: { bn: 'তাঁত' } }),
	factOf({ variantId: 'v3', productId: 'p2', sku: 'FAB-1', soldBy: 'metre', title: { en: 'Mul cotton' } }),
	factOf({ variantId: 'v4', productId: 'p3', sku: 'GONE-1' }),
	factOf({ variantId: 'v5', productId: 'p4', sku: 'BUN-1', productType: 'bundle' }),
	factOf({ variantId: 'v6', productId: 'p5', sku: 'MTO-1', tracked: false }),
	factOf({ variantId: 'v7', sku: 'OLD-1' }),
];

const rowOf = (o: Row = {}) =>
	({ row: 1, sku: 'SAR-1', quantity: 3, unitCostINR: 1_000, receivedOn: null, note: '', ...o }) as never;

interface Options {
	previous?: Row | null;
	booksClosedUpTo?: string | null;
	/** The SKUs the second look-up (inside the post) no longer finds. */
	goneOnPost?: string[];
	moveFails?: unknown;
	products?: Record<string, Row | null>;
	loads?: Row[];
}

function setup(o: Options = {}) {
	const layers: Row[] = [];
	const moves: Row[] = [];
	const saved: Row[] = [];
	const audit: { action: string; text: string }[] = [];
	const refreshed: unknown[] = [];
	const productSaves: Row[] = [];
	let lookups = 0;
	const service = new OpeningStockService(
		{
			bySku: async (skus: readonly string[]) => {
				lookups += 1;
				const gone = lookups > 1 ? new Set(o.goneOnPost ?? []) : new Set<string>();
				return new Map(
					FACTS.filter(
						(fact) => skus.includes(fact['sku'] as string) && !gone.has(fact['sku'] as string),
					).map((fact) => [fact['sku'] as string, fact]),
				);
			},
			withMovements: async () => new Set(['v7']),
		} as never,
		{
			findByRequestKey: async () => o.previous ?? null,
			save: async (load: Row) => void saved.push(load),
			list: async () => o.loads ?? [],
		} as never,
		{ createLayer: async (layer: Row) => void layers.push(layer) } as never,
		{
			move: async (move: Row) => {
				if (o.moveFails) throw o.moveFails;
				moves.push(move);
			},
		} as never,
		{ next: async () => 3, peek: async () => 4 } as never,
		{ refreshShop: async (ids: unknown) => void refreshed.push(ids) } as never,
		{
			today: () => TODAY,
			settings: async () => ({
				numberFormats: { openingStock: 'OS/{fy}/{seq6}' },
				booksClosedUpTo: o.booksClosedUpTo ?? null,
			}),
			inTransaction: <T>(work: (context: object) => Promise<T>) => work({}),
			record: async (input: { action: string; text: string }) => void audit.push(input),
			nameOf: async (id: string | null) => (id ? 'Asha' : 'Someone'),
			names: async () => new Map([['adm_a', 'Asha']]),
		} as never,
		{
			findById: async (id: string) =>
				o.products && id in o.products ? o.products[id] : { id, lifetimeUnitsReceived: 1, backInStockAt: null },
			save: async (product: Row) => void productSaves.push(product),
		} as never,
	);
	return { service, layers, moves, saved, audit, refreshed, productSaves };
}

async function codeOf(work: Promise<unknown>): Promise<{ code: string; message: string }> {
	try {
		await work;
	} catch (error) {
		const issue = ((error as BadRequestException).getResponse() as { issues: { code: string; message: string }[] })
			.issues[0];
		return { code: issue?.code ?? '', message: issue?.message ?? '' };
	}
	throw new Error('expected a refusal');
}

describe('opening stock (o01)', () => {
	it('checks every row: ready pieces and metres, unknown, bundle, untracked, repeated, moved, cost and date', async () => {
		const { service } = setup();
		const result = await service.check([
			rowOf(),
			rowOf({ row: 2, sku: ' FAB-1 ', quantity: 12.5, unitCostINR: 150 }),
			rowOf({ row: 3, sku: 'NOPE-1' }),
			rowOf({ row: 4, sku: '' }),
			rowOf({ row: 5, sku: 'BUN-1' }),
			rowOf({ row: 6, sku: 'MTO-1' }),
			rowOf({ row: 7, sku: 'OLD-1' }),
			rowOf({ row: 8, sku: 'SAR-2', unitCostINR: null }),
			rowOf({ row: 9, sku: 'GONE-1', receivedOn: '2026-12-01' }),
			rowOf({ row: 10, sku: 'SAR-9', quantity: 1 }),
			rowOf({ row: 11, sku: 'SAR-9', quantity: 1 }),
		]);
		expect(result.rows.map((row) => row.result)).toEqual([
			'ready',
			'ready',
			'unknown_sku',
			'unknown_sku',
			'unknown_sku',
			'unknown_sku',
			'already_has_stock',
			'cost_missing',
			'date_invalid',
			'unknown_sku',
			'unknown_sku',
		]);
		expect(result.rows[0]).toMatchObject({ variantId: 'v1', title: 'Tant saree', soldBy: 'piece' });
		// A title with no English falls back to the SKU; an unknown row has neither.
		expect(result.rows[7]).toMatchObject({ title: 'SAR-2' });
		expect(result.rows[2]).toMatchObject({ variantId: null, title: null, soldBy: null });
		expect(result.counts).toEqual({
			ready: 2,
			readyPieces: 3,
			readyTenths: 125,
			costMissing: 1,
			unknownSku: 6,
			alreadyHasStock: 1,
			invalid: 1,
		});
		expect(result.nextNumber).toMatch(/^OS\/.+0004$/);
	});

	it('marks a SKU typed twice as repeated on both rows', async () => {
		const { service } = setup();
		const result = await service.check([rowOf(), rowOf({ row: 2, sku: 'SAR-1 ' })]);
		expect(result.rows.map((row) => row.result)).toEqual(['repeated', 'repeated']);
		expect(result.counts.invalid).toBe(2);
	});

	it('answers a repeated request key with the first load and posts nothing', async () => {
		const previous = { id: 'os_1', number: 'OS/2026-27/000003' };
		const { service, moves } = setup({ previous });
		expect(await service.post([rowOf()], 'key-1', 'adm_a')).toBe(previous);
		expect(moves).toEqual([]);
	});

	it('refuses while any row is not ready, saying how many', async () => {
		const { service } = setup();
		expect(await codeOf(service.post([rowOf({ sku: 'NOPE-1' })], 'key-2', 'adm_a'))).toEqual({
			code: 'rows_not_ready',
			message: '1 row is not ready. Fix or remove them first.',
		});
		expect(
			(await codeOf(service.post([rowOf({ sku: 'NOPE-1' }), rowOf({ row: 2, sku: 'NOPE-2' })], 'k', null)))
				.message,
		).toBe('2 rows are not ready. Fix or remove them first.');
	});

	it('refuses once the books are closed up to today', async () => {
		const { service } = setup({ booksClosedUpTo: TODAY });
		expect((await codeOf(service.post([rowOf()], 'key-3', 'adm_a'))).code).toBe('books_closed');
	});

	it('posts layers, ledger rows, the record and the audit line, and counts the units as received', async () => {
		const { service, layers, moves, saved, audit, refreshed, productSaves } = setup({
			products: { p3: null },
		});
		const load = await service.post(
			[
				rowOf(),
				rowOf({
					row: 2,
					sku: 'SAR-2',
					quantity: 2,
					unitCostINR: 900,
					receivedOn: '2026-03-14',
					note: 'Shelf B',
				}),
				rowOf({ row: 3, sku: 'FAB-1', quantity: 12.5, unitCostINR: 150 }),
				rowOf({ row: 4, sku: 'GONE-1', quantity: 1, unitCostINR: 500 }),
			],
			'key-4',
			'adm_a',
		);
		expect(load).toMatchObject({ postedBy: 'adm_a', totalUnits: 131 });
		expect(load.number).toMatch(/^OS\/.+000003$/);
		// Metres are tenths in stock, and their cost per metre becomes a cost per tenth.
		expect(load.rows.map((row) => [row.sku, row.quantity, row.unitCostINR, row.receivedOn, row.note])).toEqual([
			['SAR-1', 3, 1_000, TODAY, ''],
			['SAR-2', 2, 900, '2026-03-14', 'Shelf B'],
			['FAB-1', 125, 15, TODAY, ''],
			['GONE-1', 1, 500, TODAY, ''],
		]);
		expect(load.totalValueINR).toBe(3_000 + 1_800 + 1_875 + 500);
		expect(layers.map((layer) => [layer['sourceType'], layer['quantityReceived'], layer['receivedAt']])).toEqual([
			['opening_stock', 3, `${TODAY}T06:30:00.000Z`],
			['opening_stock', 2, '2026-03-14T06:30:00.000Z'],
			['opening_stock', 125, `${TODAY}T06:30:00.000Z`],
			['opening_stock', 1, `${TODAY}T06:30:00.000Z`],
		]);
		expect(moves.map((move) => [move['quantityDelta'], move['note'], move['source']])).toEqual([
			[3, null, 'opening_stock'],
			[2, 'Shelf B', 'opening_stock'],
			[125, null, 'opening_stock'],
			[1, null, 'opening_stock'],
		]);
		expect(saved).toEqual([load]);
		expect(audit[0]?.text).toBe(
			`Asha posted opening stock ${load.number}: 4 SKUs, 6 pieces and 12.5 m, ₹7,175 at cost.`,
		);
		// Two rows of one product add up; metres count in tenths; a product gone meanwhile is skipped.
		expect(productSaves.map((product) => [product['id'], product['lifetimeUnitsReceived']])).toEqual([
			['p1', 1 + 5],
			['p2', 1 + 125],
		]);
		expect(productSaves.every((product) => product['backInStockAt'] === null)).toBe(true);
		expect(refreshed).toEqual([['p1', 'p1', 'p2', 'p3']]);
	});

	it('refuses a SKU that left the catalogue between the check and the post', async () => {
		const { service, productSaves } = setup({ goneOnPost: ['SAR-1'] });
		expect(await codeOf(service.post([rowOf()], 'key-5', 'adm_a'))).toEqual({
			code: 'unknown_sku',
			message: 'SAR-1 is not in the catalogue.',
		});
		expect(productSaves).toEqual([]);
	});

	it('turns a stock race and a second load of the same SKU into refusals, and passes anything else on', async () => {
		expect(
			(await codeOf(setup({ moveFails: new StockMovementRefusedError('v1') }).service.post([rowOf()], 'k', null)))
				.code,
		).toBe('stock_moved_meanwhile');
		expect(
			(
				await codeOf(
					setup({ moveFails: Object.assign(new Error('dup'), { code: 11000 }) }).service.post(
						[rowOf()],
						'k',
						null,
					),
				)
			).code,
		).toBe('already_has_stock');
		await expect(setup({ moveFails: new Error('disk full') }).service.post([rowOf()], 'k', null)).rejects.toThrow(
			'disk full',
		);
		await expect(setup({ moveFails: 'offline' }).service.post([rowOf()], 'k', null)).rejects.toBe('offline');
	});

	it('lists loads with who posted them, and their value only for stock cost', async () => {
		const loads = [
			{
				id: 'os_2',
				number: 'OS/2',
				postedAt: TODAY,
				postedBy: 'adm_a',
				rows: [{}, {}],
				totalUnits: 5,
				totalValueINR: 900,
			},
			{
				id: 'os_1',
				number: 'OS/1',
				postedAt: TODAY,
				postedBy: null,
				rows: [{}],
				totalUnits: 1,
				totalValueINR: 10,
			},
			{
				id: 'os_0',
				number: 'OS/0',
				postedAt: TODAY,
				postedBy: 'adm_gone',
				rows: [],
				totalUnits: 0,
				totalValueINR: 0,
			},
		];
		const { service } = setup({ loads });
		expect(await service.list(true)).toEqual([
			{
				id: 'os_2',
				number: 'OS/2',
				postedAt: TODAY,
				postedBy: 'adm_a',
				postedByName: 'Asha',
				skus: 2,
				totalUnits: 5,
				totalValueINR: 900,
			},
			{
				id: 'os_1',
				number: 'OS/1',
				postedAt: TODAY,
				postedBy: null,
				postedByName: null,
				skus: 1,
				totalUnits: 1,
				totalValueINR: 10,
			},
			{
				id: 'os_0',
				number: 'OS/0',
				postedAt: TODAY,
				postedBy: 'adm_gone',
				postedByName: null,
				skus: 0,
				totalUnits: 0,
				totalValueINR: 0,
			},
		]);
		expect((await service.list(false)).map((load) => load.totalValueINR)).toEqual([null, null, null]);
	});
});
