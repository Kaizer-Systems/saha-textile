import { ConflictException } from '@nestjs/common';
import { StaleVersionError, StockMovementRefusedError } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { StockCountsService } from '../src/purchasing/stock-counts.service';

const poster = { userId: 'adm_1', permissions: ['stock_count.post', 'stock.cost', 'stock.approve'] } as never;
const reviewer = { userId: 'adm_1', permissions: ['stock_count.post', 'stock.cost'] } as never;
const counter = { userId: 'adm_2', permissions: [] } as never;

const fact = (over: Record<string, unknown> = {}) => ({
	variantId: 'v1',
	productId: 'p1',
	sku: 'SAR-1',
	title: { en: 'Baluchari saree' },
	optionsLabel: 'maroon',
	galleryAssetId: null,
	soldBy: 'piece',
	onHand: 5,
	tracked: true,
	productType: 'simple',
	categoryName: 'Sarees',
	...over,
});

const line = (over: Record<string, unknown> = {}) => ({
	variantId: 'v1',
	productId: 'p1',
	sku: 'SAR-1',
	title: 'Baluchari saree',
	optionsLabel: 'maroon',
	imageUrl: null,
	soldBy: 'piece',
	atStart: 5,
	soldDuring: 0,
	expected: 5,
	counted: null,
	difference: null,
	valueINR: null,
	note: null,
	countedBy: null,
	countedAt: null,
	recount: false,
	...over,
});

const count = (over: Record<string, unknown> = {}) => ({
	id: 'sc_1',
	number: 'SC/26-27/000001',
	label: 'Rack 3',
	scope: { kind: 'skus', variantIds: ['v1'] },
	blind: false,
	counterIds: [],
	counterNames: [],
	status: 'counting',
	startedAt: '2026-11-24T04:00:00.000Z',
	startedBy: 'adm_1',
	lines: [line()],
	totals: {},
	postedAt: null,
	postedBy: null,
	approvalRequestId: null,
	updatedBy: null,
	version: 2,
	...over,
});

interface Parts {
	found?: unknown;
	facts?: Map<string, unknown>;
	moved?: Map<string, number>;
	layers?: unknown[];
	save?: (next: unknown, version: number | null) => Promise<number>;
	apply?: (change: { action: string; quantity: number; note: string }) => Promise<void>;
}

function build(parts: Parts = {}) {
	const counts = {
		findById: vi.fn(async () => ('found' in parts ? parts.found : count())),
		list: vi.fn(async () => ({ items: [], total: 0 })),
		save: vi.fn(parts.save ?? (async (_next: unknown, version: number | null) => (version ?? 0) + 1)),
		lastDifferences: vi.fn(async () => ['v1']),
	};
	const stock = {
		variantIdsInScope: vi.fn(async () => ['v1', 'v2']),
		items: vi.fn(async () => parts.facts ?? new Map([['v1', fact()]])),
		movedSince: vi.fn(async () => parts.moved ?? new Map()),
		openLayers: vi.fn(async () => parts.layers ?? []),
	};
	const requests = { save: vi.fn(async () => undefined) };
	const writer = {
		apply: vi.fn(parts.apply ?? (async (_change: { action: string; quantity: number; note: string }) => undefined)),
		refreshShop: vi.fn(async () => undefined),
	};
	const support = {
		thumbnails: async () => new Map([['img_1', 'https://cdn.test/img_1.webp']]),
		today: () => '2026-11-24',
		settings: async () => ({ numberFormats: { stockCount: 'SC/{fy}/{seq6}' } }),
		names: async () => new Map([['adm_2', 'Raju']]),
		record: vi.fn(async () => undefined),
		nameOf: async () => 'Rina',
		guardStale: async <T>(work: () => Promise<T>) => work(),
		staleConflict: async () => new ConflictException('stale_version'),
		inTransaction: async <T>(work: (context: unknown) => Promise<T>) => work({ session: 'tx' }),
	};
	const service = new StockCountsService(
		counts as never,
		stock as never,
		requests as never,
		{ next: async () => 3 } as never,
		writer as never,
		support as never,
	);
	return { service, counts, stock, requests, writer, support };
}

describe('stock counts: starting one (c02)', () => {
	it('lists counts as the repository pages them', async () => {
		const { service, counts } = build();
		await service.list({ filter: 'open', page: 1, pageSize: 20 });
		expect(counts.list).toHaveBeenCalledWith({ filter: 'open', page: 1, pageSize: 20 });
	});

	it('counts what differed last time, labelled by its first item’s category, or by its number', async () => {
		const { service, counts } = build({
			facts: new Map([
				['v2', fact({ variantId: 'v2', sku: 'B-2', title: {}, galleryAssetId: 'img_1' })],
				['v1', fact({ sku: 'A-1', galleryAssetId: 'img_gone' })],
				['v3', fact({ variantId: 'v3', tracked: false })],
				['v4', fact({ variantId: 'v4', productType: 'bundle' })],
			]),
		});
		const made = await service.start(
			{ label: '', scope: { kind: 'last_differences' }, blind: true, counterIds: ['adm_2', 'adm_gone'] } as never,
			'adm_1',
		);
		expect(counts.lastDifferences).toHaveBeenCalled();
		expect(made).toMatchObject({ number: 'SC/26-27/000003', label: 'Sarees', counterNames: ['Raju', 'Someone'] });
		expect(made.lines.map((row) => [row.sku, row.title, row.imageUrl])).toEqual([
			['A-1', 'Baluchari saree', null],
			['B-2', 'B-2', 'https://cdn.test/img_1.webp'],
		]);
		const unnamed = await build({ facts: new Map([['v1', fact({ categoryName: null })]]) }).service.start(
			{ label: '', scope: { kind: 'skus', variantIds: ['v1', 'v1'] }, blind: false, counterIds: [] } as never,
			null,
		);
		expect(unnamed.label).toBe('SC/26-27/000003');
	});

	it('names a whole-shop count, and asks the stock for the chosen categories', async () => {
		const { service, stock, support } = build();
		const whole = await service.start(
			{ label: '', scope: { kind: 'all', categoryIds: [] }, blind: false, counterIds: [] } as never,
			'adm_1',
		);
		expect(whole.label).toBe('Whole shop');
		expect(support.record).toHaveBeenCalledWith(
			expect.objectContaining({ text: expect.stringContaining('expected figures shown') }),
		);
		const some = await service.start(
			{
				label: 'Silk',
				scope: { kind: 'categories', categoryIds: ['cat_1'] },
				blind: true,
				counterIds: [],
			} as never,
			'adm_1',
		);
		expect(some.label).toBe('Silk');
		expect(stock.variantIdsInScope).toHaveBeenLastCalledWith({ kind: 'categories', categoryIds: ['cat_1'] });
	});

	it('refuses no categories, and a choice with nothing to count', async () => {
		await expect(
			build().service.start(
				{ label: '', scope: { kind: 'categories', categoryIds: [] }, blind: false, counterIds: [] } as never,
				null,
			),
		).rejects.toMatchObject({ response: { issues: [{ message: 'Pick at least one category.' }] } });
		await expect(
			build({ facts: new Map() }).service.start(
				{ label: '', scope: { kind: 'skus', variantIds: [] }, blind: false, counterIds: [] } as never,
				null,
			),
		).rejects.toMatchObject({ response: { issues: [{ message: 'Nothing to count in that choice.' }] } });
	});
});

describe('stock counts: reading one', () => {
	it('says a count it can’t find is missing', async () => {
		await expect(build({ found: null }).service.get('sc_x', poster)).rejects.toThrow('Stock count not found');
	});

	it('values what is short at FIFO cost and what is found at the newest cost, or nothing without layers', async () => {
		const { service } = build({
			found: count({
				lines: [
					line({ variantId: 'v1', counted: 3 }),
					line({ variantId: 'v2', counted: 7 }),
					line({ variantId: 'v3', counted: 6 }),
					line({ variantId: 'v4', counted: 5 }),
					line({ variantId: 'v5', atStart: null, counted: null }),
				],
			}),
			moved: new Map([['v1', -1]]),
			layers: [
				{ id: 'l1', variantId: 'v1', receivedAt: '2026-01-01', quantityRemaining: 10, unitCostINR: 100 },
				{ id: 'l2', variantId: 'v2', receivedAt: '2026-01-01', quantityRemaining: 1, unitCostINR: 100 },
				{ id: 'l3', variantId: 'v2', receivedAt: '2026-06-01', quantityRemaining: 1, unitCostINR: 150 },
			],
		});
		const view = await service.get('sc_1', reviewer);
		// soldDuring is -0 when nothing moved; `+ 0` reads it as 0.
		expect(
			view.lines.map((row) => [row.expected, row.difference, row.valueINR, (row.soldDuring ?? 0) + 0]),
		).toEqual([
			[4, -1, -100, 1],
			[5, 2, 300, 0],
			[5, 1, 0, 0],
			[5, 0, 0, 0],
			[0, null, 0, 0],
		]);
		expect(view.totals).toEqual({
			skus: 5,
			counted: 4,
			differences: 3,
			missingUnits: 1,
			missingValueINR: -100,
			foundUnits: 3,
			foundValueINR: 300,
			netUnits: 2,
			netValueINR: 200,
		});
	});

	it('hides expected figures from a counter on a blind count, but not once it is posted', async () => {
		const blind = build({ found: count({ blind: true, lines: [line({ counted: 4 })] }) });
		const view = await blind.service.get('sc_1', counter);
		expect(view.lines[0]).toMatchObject({ atStart: null, expected: null, difference: null, valueINR: null });
		expect(view.totals).toMatchObject({ differences: 0, missingValueINR: null, netValueINR: null });
		expect((await blind.service.get('sc_1', reviewer)).lines[0]?.expected).toBe(5);
		const posted = build({ found: count({ blind: true, status: 'posted', lines: [line({ counted: 4 })] }) });
		const shown = await posted.service.get('sc_1', counter);
		expect(shown.lines[0]).toMatchObject({ expected: 5, difference: -1, valueINR: null });
		expect(shown.totals.missingValueINR).toBeNull();
	});
});

describe('stock counts: entering counts (g02)', () => {
	const body = { lines: [{ variantId: 'v1', counted: 4, note: 'one torn' }] };

	it('refuses a closed count, someone not on it, and items not in it', async () => {
		await expect(
			build({ found: count({ status: 'review' }) }).service.enter('sc_1', body as never, counter),
		).rejects.toMatchObject({ response: { message: 'wrong_status' } });
		await expect(
			build({ found: count({ counterIds: ['adm_9'] }) }).service.enter('sc_1', body as never, counter),
		).rejects.toMatchObject({ response: { message: 'not_a_counter' } });
		await expect(
			build().service.enter('sc_1', { lines: [{ variantId: 'v9', counted: 1, note: null }] } as never, counter),
		).rejects.toMatchObject({ response: { message: 'not_in_count', issues: [{ path: ['not_in_count', 'v9'] }] } });
	});

	it('lets a named counter, a reviewer and a signed-out kiosk save', async () => {
		const named = await build({ found: count({ counterIds: ['adm_2'] }) }).service.enter(
			'sc_1',
			body as never,
			counter,
		);
		expect(named.version).toBe(3);
		await build({ found: count({ counterIds: ['adm_9'] }) }).service.enter('sc_1', body as never, reviewer);
		await build({ found: count({ counterIds: ['adm_9'] }) }).service.enter('sc_1', body as never, undefined);
	});

	it('lays its lines over a newer copy and tries again when another phone saved first', async () => {
		const stale = new StaleVersionError('stock_count', 'sc_1', { version: 3, updatedAt: '', updatedBy: null });
		let calls = 0;
		const { service, counts } = build({
			found: count({ lines: [line(), line({ variantId: 'v2', counted: 9 })] }),
			save: async () => {
				calls += 1;
				if (calls < 3) throw stale;
				return 5;
			},
		});
		const saved = await service.enter('sc_1', body as never, counter);
		expect(saved.version).toBe(5);
		expect(counts.save).toHaveBeenCalledTimes(3);
		expect(counts.save.mock.calls[2]?.[0]).toMatchObject({
			lines: [
				expect.objectContaining({ counted: 4, note: 'one torn', countedBy: 'adm_2' }),
				expect.objectContaining({ counted: 9 }),
			],
		});
	});

	it('gives up after six tries with the conflict the form shows, and passes other errors on', async () => {
		const stale = new StaleVersionError('stock_count', 'sc_1', { version: 3, updatedAt: '', updatedBy: null });
		const tired = build({ save: async () => Promise.reject(stale) });
		await expect(tired.service.enter('sc_1', body as never, counter)).rejects.toBeInstanceOf(ConflictException);
		expect(tired.counts.save).toHaveBeenCalledTimes(6);
		const broken = build({ save: async () => Promise.reject(new Error('disk full')) });
		await expect(broken.service.enter('sc_1', body as never, counter)).rejects.toThrow('disk full');
	});
});

describe('stock counts: finish, recount, reopen', () => {
	it('finishes only a count being counted', async () => {
		await expect(build({ found: count({ status: 'review' }) }).service.finish('sc_1', null)).rejects.toMatchObject({
			response: { message: 'wrong_status' },
		});
		const done = await build({
			found: count({ lines: [line({ counted: 5 }), line({ variantId: 'v2' })] }),
		}).service.finish('sc_1', 'adm_1');
		expect(done).toMatchObject({ status: 'review', version: 3 });
	});

	it('sends chosen lines back cleared, only from review, and says how many', async () => {
		await expect(build().service.recount('sc_1', ['v1'], null)).rejects.toMatchObject({
			response: { message: 'wrong_status' },
		});
		const two = build({
			found: count({
				status: 'review',
				lines: [
					line({ counted: 3 }),
					line({ variantId: 'v2', counted: 2 }),
					line({ variantId: 'v3', counted: 1 }),
				],
			}),
		});
		const back = await two.service.recount('sc_1', ['v1', 'v2'], 'adm_1');
		expect(back.lines.map((row) => [row.counted, row.recount])).toEqual([
			[null, true],
			[null, true],
			[1, false],
		]);
		expect(two.support.record).toHaveBeenCalledWith(
			expect.objectContaining({ text: 'Rina sent 2 lines of SC/26-27/000001 back for a recount.' }),
		);
		const one = build({ found: count({ status: 'review' }) });
		await one.service.recount('sc_1', ['v1'], null);
		expect(one.support.record).toHaveBeenCalledWith(
			expect.objectContaining({ text: 'Rina sent 1 line of SC/26-27/000001 back for a recount.' }),
		);
	});

	it('reopens a rejected count for review inside the caller’s transaction', async () => {
		const { service, counts } = build({
			found: count({ status: 'awaiting_approval', approvalRequestId: 'adj_1' }),
		});
		const context = { session: 'tx' } as never;
		await service.reopen('sc_1', 'adm_1', context);
		expect(counts.findById).toHaveBeenCalledWith('sc_1', context);
		expect(counts.save).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'review', approvalRequestId: null }),
			2,
			context,
		);
	});
});

describe('stock counts: posting (c03)', () => {
	it('refuses a count not under review', async () => {
		await expect(build().service.post('sc_1', poster)).rejects.toMatchObject({
			response: { message: 'wrong_status' },
		});
	});

	it('asks for approval without Approve write-offs, saying the net change and its value', async () => {
		const { service, requests, support } = build({
			found: count({ status: 'review', lines: [line({ counted: 4 })] }),
			layers: [{ id: 'l1', variantId: 'v1', receivedAt: '2026-01-01', quantityRemaining: 5, unitCostINR: 100 }],
		});
		const waiting = await service.post('sc_1', reviewer);
		expect(waiting).toMatchObject({ status: 'awaiting_approval', version: 3 });
		expect(requests.save).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'count', quantity: -1, valueAtCostINR: -100 }),
			'count:sc_1:2',
			{ session: 'tx' },
		);
		expect(support.record).toHaveBeenCalledWith(
			expect.objectContaining({ text: expect.stringContaining('net -1, ₹-100 at cost.') }),
			{ session: 'tx' },
		);
		const found = build({ found: count({ status: 'review', lines: [line({ counted: 6 })] }) });
		await found.service.post('sc_1', reviewer);
		expect(found.support.record).toHaveBeenCalledWith(
			expect.objectContaining({ text: expect.stringContaining('1 differences, net +1, ₹0 at cost.') }),
			{ session: 'tx' },
		);
	});

	it('posts at once with Approve write-offs, writing each difference as a correction', async () => {
		const { service, writer, support } = build({
			found: count({
				status: 'review',
				lines: [
					line({ counted: 4, note: 'torn' }),
					line({ variantId: 'v2', productId: 'p2', counted: 7 }),
					line({ variantId: 'v3', counted: 5 }),
					line({ variantId: 'v4' }),
				],
			}),
		});
		const posted = await service.post('sc_1', poster);
		expect(posted).toMatchObject({ status: 'posted', postedBy: 'adm_1', version: 3 });
		expect(writer.apply.mock.calls.map((call) => [call[0].action, call[0].quantity, call[0].note])).toEqual([
			['remove', 1, 'torn'],
			['add', 2, 'Count SC/26-27/000001'],
		]);
		expect(writer.refreshShop).toHaveBeenCalledWith(['p1', 'p2']);
		expect(support.record).toHaveBeenLastCalledWith(
			expect.objectContaining({
				text: expect.stringMatching(/net \+1, ₹0 at cost\. 1 not counted stay as they are\. Self-approved\.$/),
			}),
			{ session: 'tx' },
		);
	});
});

describe('stock counts: applying an approved count', () => {
	it('refuses a count already posted or still being counted', async () => {
		await expect(
			build({ found: count({ status: 'posted' }) }).service.apply('sc_1', null, null, false),
		).rejects.toMatchObject({
			response: { issues: [{ message: 'Count SC/26-27/000001 is already posted.' }] },
		});
		await expect(build().service.apply('sc_1', null, null, false)).rejects.toMatchObject({
			response: { issues: [{ message: 'Count SC/26-27/000001 is still being counted.' }] },
		});
	});

	it('posts an approved count with nothing differing, running the approval’s own write alongside', async () => {
		const alongside = vi.fn(async () => undefined);
		const { service, support } = build({
			found: count({ status: 'awaiting_approval', lines: [line({ counted: 5 })] }),
		});
		const posted = await service.apply('sc_1', 'adm_2', null, false, alongside);
		expect(posted.postedBy).toBe('adm_2');
		expect(alongside).toHaveBeenCalledWith({ session: 'tx' });
		expect(support.record).toHaveBeenLastCalledWith(
			expect.objectContaining({
				actor: 'adm_2',
				// "(0 pieces)", not "(none)": describeUnits([]) never answers '' (reported to the coverage chat).
				text: 'Rina posted count SC/26-27/000001 (Rack 3): 1 SKUs, 0 differences (0 pieces), net +0, ₹0 at cost.',
			}),
			{ session: 'tx' },
		);
	});

	it('names an approver as the one who posted, and a net loss without a plus', async () => {
		const short = build({ found: count({ status: 'awaiting_approval', lines: [line({ counted: 3 })] }) });
		await short.service.apply('sc_1', 'adm_2', 'adm_1', false);
		expect(short.support.record).toHaveBeenLastCalledWith(
			expect.objectContaining({
				actor: 'adm_1',
				text: expect.stringContaining('(2 pieces), net -2, ₹0 at cost.'),
			}),
			{ session: 'tx' },
		);
		const posted = await build({ found: count({ status: 'awaiting_approval' }) }).service.apply(
			'sc_1',
			'adm_2',
			'adm_1',
			false,
		);
		expect(posted.postedBy).toBe('adm_1');
	});

	it('refuses a figure below what is held, and passes other errors on', async () => {
		const held = build({
			found: count({ status: 'review', lines: [line({ counted: 1 })] }),
			apply: async () => Promise.reject(new StockMovementRefusedError('v1')),
		});
		await expect(held.service.apply('sc_1', null, null, true)).rejects.toMatchObject({
			response: { message: 'count_below_held' },
		});
		const broken = build({
			found: count({ status: 'review', lines: [line({ counted: 1 })] }),
			apply: async () => Promise.reject(new Error('disk full')),
		});
		await expect(broken.service.apply('sc_1', null, null, true)).rejects.toThrow('disk full');
	});
});
