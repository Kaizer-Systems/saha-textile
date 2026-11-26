import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { StockCountsService, countAuditText } from '../src/purchasing/stock-counts.service';

/**
 * A stock count's posting in the books and its edit-log line (accounts brief D5; the owner's 24 Nov ask: wording to a
 * CA audit's standard). Each item that differed is its own voucher under one stock adjustment number.
 */

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
	counterIds: ['adm_2'],
	counterNames: ['Asha'],
	status: 'awaiting_approval',
	startedAt: '2026-11-24T04:00:00.000Z',
	startedBy: 'adm_1',
	lines: [line()],
	totals: {},
	postedAt: null,
	postedBy: null,
	approvalRequestId: null,
	posting: null,
	updatedBy: null,
	version: 2,
	...over,
});

function build(found: unknown, books: { journal?: (id: string) => string | null; itc?: number | null } = {}) {
	const posted: unknown[][] = [];
	const writes: { referenceNumber: string }[] = [];
	const saved: { posting: unknown }[] = [];
	const support = {
		thumbnails: async () => new Map(),
		today: () => '2026-11-24',
		settings: async () => ({ numberFormats: { stockCount: 'SC/{fy}/{seq6}' } }),
		names: async () => new Map(),
		record: vi.fn(async () => undefined),
		nameOf: async (id: string | null) => (id === 'adm_1' ? 'Rina' : 'Asha'),
		guardStale: async <T>(work: () => Promise<T>) => work(),
		staleConflict: async () => new ConflictException('stale_version'),
		inTransaction: async <T>(work: (context: unknown) => Promise<T>) => work({ session: 'tx' }),
	};
	const service = new StockCountsService(
		{
			findById: async () => found,
			save: vi.fn(async (next: { posting: unknown }) => (saved.push(next), 3)),
		} as never,
		{
			items: async () => new Map([['v1', { variantId: 'v1', hsnCode: '5007' }]]),
			movedSince: async () => new Map(),
			openLayers: async () => [
				{ id: 'l1', variantId: 'v1', receivedAt: '2026-01-01', quantityRemaining: 9, unitCostINR: 400 },
				{ id: 'l2', variantId: 'v2', receivedAt: '2026-01-01', quantityRemaining: 900, unitCostINR: 12 },
			],
		} as never,
		{ save: vi.fn() } as never,
		{ next: async () => 3 } as never,
		{
			apply: vi.fn(async (change: { referenceNumber: string }) => void writes.push(change)),
			refreshShop: vi.fn(),
		} as never,
		support as never,
		{
			number: vi.fn(async () => 'SA/26-27/0014'),
			posted: vi.fn(async (adjustment: { id: string }, number: string) => {
				posted.push([adjustment, number]);
				return {
					number,
					outcome: null,
					itcReversedINR: books.itc === undefined ? 20 : books.itc,
					journalNumber: books.journal ? books.journal(adjustment.id) : `JV/${posted.length}`,
				};
			}),
		} as never,
	);
	return { service, posted, writes, saved, support };
}

describe('a count’s posting in the books', () => {
	it('takes one stock adjustment number, then a voucher per item that differed with the input tax taken back', async () => {
		const found = count({
			lines: [
				line({ counted: 3 }),
				line({ variantId: 'v2', productId: 'p2', sku: 'MUL', soldBy: 'metre', expected: 100, counted: 115 }),
				line({ variantId: 'v3', counted: 5 }),
			],
		});
		const { service, posted, writes, saved, support } = build(found);
		const done = await service.apply('sc_1', 'adm_2', 'adm_1', false);
		expect(writes.map((w) => w.referenceNumber)).toEqual(['SA/26-27/0014', 'SA/26-27/0014']);
		expect(
			posted.map(([a, n]) => [
				(a as { id: string; action: string; outcome: string | null; hsnCode: string | null; valueINR: number })
					.id,
				(a as { action: string }).action,
				(a as { outcome: string | null }).outcome,
				(a as { hsnCode: string | null }).hsnCode,
				(a as { valueINR: number }).valueINR,
				n,
			]),
		).toEqual([
			['sc_1:v1', 'remove', 'writtenOff', '5007', 800, 'SA/26-27/0014'],
			['sc_1:v2', 'add', null, null, 1320, 'SA/26-27/0014'],
		]);
		expect(saved[0]!.posting).toEqual({
			adjustmentNumber: 'SA/26-27/0014',
			journalNumbers: ['JV/1', 'JV/2'],
			itcReversedINR: 40,
		});
		expect(done.posting).toEqual(saved[0]!.posting);
		const text = (support.record.mock.lastCall as unknown as [{ text: string }])[0].text;
		expect(text).toContain(
			'3 SKUs counted, 2 differ: short 2 pieces (₹800 at cost), over 11.0 m (₹1,320 at cost); net −2 pieces and +11.0 m, +₹520 at cost.',
		);
		expect(text).toContain(
			'Stock adjustment SA/26-27/0014, 2 journals JV/1, JV/2; input tax reversed ₹40 (s.17(5)(h)).',
		);
		expect(text).toMatch(/Counted by Asha; approved by Rina\.$/);
	});

	it('keeps the adjustment number when the books aren’t set up, and takes none when nothing differs', async () => {
		const notSet = build(count({ lines: [line({ counted: 4 })] }), { journal: () => null, itc: null });
		await notSet.service.apply('sc_1', 'adm_2', null, false);
		expect(notSet.saved[0]!.posting).toEqual({
			adjustmentNumber: 'SA/26-27/0014',
			journalNumbers: [],
			itcReversedINR: 0,
		});
		expect((notSet.support.record.mock.lastCall as unknown as [{ text: string }])[0].text).toContain(
			'Stock adjustment SA/26-27/0014.',
		);
		const same = build(count({ lines: [line({ counted: 5 })] }));
		await same.service.apply('sc_1', 'adm_2', null, false);
		expect([same.saved[0]!.posting, same.posted.length]).toEqual([null, 0]);
	});
});

describe('a count’s totals keep pieces and metres apart (owner, 24 Nov)', () => {
	it('sums short, over and net in pieces and in tenths of a metre, and the approval request carries both', async () => {
		const found = count({
			status: 'review',
			lines: [
				line({ counted: 1 }),
				line({
					variantId: 'v2',
					productId: 'p2',
					sku: 'MUL',
					soldBy: 'metre',
					atStart: 100,
					expected: 100,
					counted: 115,
				}),
				line({
					variantId: 'v3',
					productId: 'p3',
					sku: 'CHI',
					soldBy: 'metre',
					atStart: 40,
					expected: 40,
					counted: 35,
				}),
			],
		});
		const { service } = build(found);
		const requests = (service as unknown as { requests: { save: { mock: { calls: unknown[][] } } } }).requests;
		const reviewer = { userId: 'adm_2', permissions: ['stock_count.post', 'stock.cost'] } as never;
		await service.post('sc_1', reviewer);
		const request = requests.save.mock.calls[0]![0] as { quantity: number; countSummary: unknown };
		expect(request.countSummary).toEqual({
			skus: 3,
			differences: 3,
			missing: 4,
			found: 0,
			missingTenths: 5,
			foundTenths: 15,
		});
		expect(request.quantity).toBe(-4);
		const view = await service.get('sc_1', reviewer);
		expect(view.totals).toMatchObject({
			missingPieces: 4,
			missingTenths: 5,
			foundPieces: 0,
			foundTenths: 15,
			netPieces: -4,
			netTenths: 10,
		});
	});
});

describe('the edit-log line for a count', () => {
	const base = {
		who: 'Rina',
		verb: 'asked to post' as const,
		at: '2026-11-24T05:10:00.000Z',
		approver: null,
		selfApproved: false,
		posting: null,
	};

	it('words only metres, a single counter, many not counted, and leaves cost out where it isn’t seen', () => {
		const text = countAuditText({
			...base,
			count: count({
				lines: [line({ soldBy: 'metre', difference: -15 }), line({ counted: null }), line({ counted: null })],
			}) as never,
			notCounted: 2,
		});
		expect(text).toBe(
			'Rina asked to post count SC/26-27/000001 (Rack 3), 24 Nov 2026, 10:40 am IST: 1 SKU counted, 1 differs: short 1.5 m; net −1.5 m. 2 items not counted stay as they are. Counted by Asha.',
		);
		expect(
			countAuditText({
				...base,
				count: count({ lines: [line({ difference: 0, counted: 5 })] }) as never,
				notCounted: 0,
			}),
		).toBe(
			'Rina asked to post count SC/26-27/000001 (Rack 3), 24 Nov 2026, 10:40 am IST: 1 SKU counted, no differences. Counted by Asha.',
		);
		expect(
			countAuditText({
				...base,
				count: count({
					lines: [line({ difference: 2, valueINR: 0 }), line({ difference: -2, valueINR: 0 })],
				}) as never,
				notCounted: 0,
				posting: { adjustmentNumber: 'SA/1', journalNumbers: ['JV/9'], itcReversedINR: 0 },
			}),
		).toContain(
			'short 2 pieces (₹0 at cost), over 2 pieces (₹0 at cost); net 0 pieces, ₹0 at cost. Stock adjustment SA/1, 1 journal JV/9.',
		);
	});
});
