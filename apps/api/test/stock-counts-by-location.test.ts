import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { StockCountsService } from '../src/purchasing/stock-counts.service';
import { StockWriter, type StockChange } from '../src/purchasing/stock-writer';
import { CaroStockService } from '../src/reports/caro-stock';

/**
 * Stock counts by location (brief 25 SC1, SC2): a count of one location expects that location's stock (none where it
 * holds none), a count of every location the totals; the writer's moves carry the location when given; and the CARO
 * report filtered by location keeps only that location's own counts.
 */

const fact = (variantId: string, sku: string, onHand: number) => ({
	variantId,
	productId: `p_${variantId}`,
	sku,
	title: { en: sku },
	optionsLabel: '',
	galleryAssetId: null,
	soldBy: 'piece',
	onHand,
	tracked: true,
	productType: 'simple',
	categoryName: 'Sarees',
});

function counts() {
	const writer = {
		onHandAt: vi.fn(async () => new Map([['v1', 2]])),
		apply: vi.fn(),
		refreshShop: vi.fn(),
	};
	const service = new StockCountsService(
		{ save: vi.fn(async () => 1), lastDifferences: vi.fn() } as never,
		{
			// Five pieces of A and seven of B across every location.
			items: async () =>
				new Map([
					['v1', fact('v1', 'A-1', 5)],
					['v2', fact('v2', 'B-2', 7)],
				]),
		} as never,
		{} as never,
		{ next: async () => 4 } as never,
		writer as never,
		{
			thumbnails: async () => new Map(),
			today: () => '2026-11-24',
			settings: async () => ({ numberFormats: { stockCount: 'SC/{fy}/{seq6}' } }),
			names: async () => new Map(),
			record: vi.fn(async () => undefined),
			nameOf: async () => 'Rina',
			guardStale: async <T>(work: () => Promise<T>) => work(),
			staleConflict: async () => new ConflictException('stale_version'),
			inTransaction: async <T>(work: (context: unknown) => Promise<T>) => work({ session: 'tx' }),
		} as never,
	);
	return { service, writer };
}
const start = (locationId: string | null) =>
	({
		label: 'Rack 3',
		scope: { kind: 'skus', categoryIds: [], variantIds: ['v1', 'v2'] },
		locationId,
		blind: false,
		counterIds: [],
	}) as never;

describe('starting a count at a location (SC1)', () => {
	it('expects that location’s stock, nothing where it holds none', async () => {
		const { service, writer } = counts();
		const made = await service.start(start('loc_shop'), 'adm_1');
		expect(writer.onHandAt).toHaveBeenCalledWith(['v1', 'v2'], 'loc_shop');
		expect(made.locationId).toBe('loc_shop');
		expect(made.lines.map((l) => [l.sku, l.atStart, l.expected])).toEqual([
			['A-1', 2, 2],
			['B-2', 0, 0],
		]);
	});

	it('expects the totals for a count of every location', async () => {
		const { service, writer } = counts();
		const made = await service.start(start(null), 'adm_1');
		expect(writer.onHandAt).not.toHaveBeenCalled();
		expect(made.locationId).toBeNull();
		expect(made.lines.map((l) => [l.sku, l.expected])).toEqual([
			['A-1', 5],
			['B-2', 7],
		]);
	});
});

function writer() {
	const moves: Record<string, unknown>[] = [];
	const locationStock = vi.fn(async () => [
		{ variantId: 'v1', locationId: 'loc_shop', onHand: 2 },
		{ variantId: 'v1', locationId: 'loc_bar', onHand: 3 },
		{ variantId: 'v2', locationId: 'loc_bar', onHand: 7 },
	]);
	const service = new StockWriter(
		{
			items: async () =>
				new Map([['v1', { variantId: 'v1', productId: 'p1', sku: 'A-1', soldBy: 'piece', hsnCode: '5007' }]]),
			openLayers: async () => [],
			layersOf: async () => [],
		} as never,
		{
			locationStock,
			move: async (movement: Record<string, unknown>) => {
				moves.push(movement);
				return { onHandAfter: 3, heldAfter: 1 };
			},
		} as never,
		{ createLayer: async () => undefined } as never,
		{ findById: async () => null, save: async () => undefined } as never,
	);
	return { service, moves, locationStock };
}
const hold = (over: Partial<StockChange> = {}): StockChange => ({
	variantId: 'v1',
	action: 'hold',
	quantity: 1,
	reasonCode: null,
	holdReason: 'quality_check',
	holdId: null,
	note: '',
	referenceType: 'stock_count',
	referenceId: 'sc_1',
	referenceNumber: 'SC/26-27/000004',
	actor: 'adm_1',
	approver: null,
	source: 'stock_count',
	...over,
});

describe('the stock writer at a location (SC1)', () => {
	it('reads each item’s on-hand at one location, leaving out items it holds none of', async () => {
		const { service, locationStock } = writer();
		expect([...(await service.onHandAt(['v1', 'v2'], 'loc_shop')).entries()]).toEqual([['v1', 2]]);
		expect(locationStock).toHaveBeenCalledWith(['v1', 'v2']);
	});

	it('moves stock at the location given, and with no location when none is', async () => {
		const { service, moves } = writer();
		await service.apply(hold({ locationId: 'loc_shop' }), { tx: 1 } as never);
		await service.apply(hold({ locationId: null }), { tx: 1 } as never);
		await service.apply(hold(), { tx: 1 } as never);
		expect(moves.map((m) => m['locationId'])).toEqual(['loc_shop', undefined, undefined]);
		expect(moves.map((m) => 'locationId' in m)).toEqual([true, false, false]);
	});
});

const posted = (id: string, locationId: string | null | undefined) => ({
	id,
	number: `SC/${id}`,
	label: id,
	postedAt: '2027-03-31T12:00:00.000Z',
	lines: [],
	...(locationId === undefined ? {} : { locationId }),
});

describe('the CARO stock report by location (SC2)', () => {
	const service = new CaroStockService({
		list: async (query: { page: number }) => ({
			items:
				query.page === 1
					? [
							posted('shop', 'loc_shop'),
							posted('bar', 'loc_bar'),
							posted('all', null),
							posted('old', undefined),
						]
					: [],
		}),
	} as never);

	it('keeps only the location’s own counts, leaving out counts of every location', async () => {
		const report = await service.report({ from: '2026-04-01', to: '2027-03-31', locationId: 'loc_shop' });
		expect(report.locationId).toBe('loc_shop');
		expect(report.counts.map((c) => [c.id, c.locationId])).toEqual([['shop', 'loc_shop']]);
	});

	it('keeps every count without a filter, a count made before locations reading as every location', async () => {
		const report = await service.report({ from: '2026-04-01', to: '2027-03-31', locationId: null });
		expect(report.counts.map((c) => [c.id, c.locationId])).toEqual([
			['shop', 'loc_shop'],
			['bar', 'loc_bar'],
			['all', null],
			['old', null],
		]);
	});
});
