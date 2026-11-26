import { StockMovementRefusedError } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import {
	StockAdjustmentPages,
	StockAdjustmentPagesController,
	stockAdjustmentData,
} from '../src/purchasing/stock-adjustment-pages';

/** A posted stock adjustment's page (accounts brief D5, E3): what it changed, Reverse and the print. */

const posted = (over: Record<string, unknown> = {}) => ({
	id: 'adj_1',
	kind: 'adjustment',
	variantId: 'var_1',
	productId: 'prd_1',
	sku: 'PTC-CRM-M',
	title: 'Cream petticoat',
	imageUrl: null,
	soldBy: 'piece',
	action: 'remove',
	quantity: 2,
	reasonCode: 'damage',
	holdId: null,
	note: 'Two stained.',
	photoAssetIds: ['ast_1'],
	valueAtCostINR: 620,
	costBreakdown: '2 at ₹310',
	countId: null,
	countNumber: null,
	countSummary: null,
	status: 'applied',
	requestedBy: 'usr_2',
	requestedByName: 'Store manager',
	requestedAt: '2026-11-22T05:00:00.000Z',
	decidedBy: 'adm_1',
	decidedByName: 'Owner',
	decidedAt: '2026-11-22T06:00:00.000Z',
	rejectReason: null,
	selfApproved: false,
	number: 'SA/26-27/0004',
	outcome: 'writtenOff',
	itcReversedINR: 31,
	journalNumber: 'JV/26-27/000013',
	reverses: null,
	reversedBy: null,
	reversedAt: null,
	applied: {
		onHandBefore: 14,
		onHandAfter: 12,
		layers: [{ quantity: 2, unitCostINR: 310, source: 'OS/26-27/000001' }],
	},
	...over,
});

const facts = { variantId: 'var_1', productId: 'prd_1', sku: 'PTC-CRM-M', soldBy: 'piece', hsnCode: '5208' };

function setup(options: { rows?: Record<string, unknown>; superAdmin?: boolean; applyFails?: Error } = {}) {
	const rows: Record<string, unknown> = options.rows ?? { adj_1: posted() };
	const saved: Record<string, unknown>[] = [];
	const records: { action: string; text: string }[] = [];
	const writer = {
		facts: vi.fn(async () => facts),
		apply: vi.fn(async (change: { action: string; quantity: number; unitCostINR: number | null }) => {
			if (options.applyFails) throw options.applyFails;
			return {
				onHandBefore: 12,
				onHandAfter: change.action === 'add' ? 14 : 10,
				heldBefore: 0,
				heldAfter: 0,
				valueINR: 620,
				breakdown: change.action === 'add' ? '' : '2 at ₹310',
				holdId: null,
				layers: [{ quantity: 2, unitCostINR: 310, source: null }],
			};
		}),
		refreshShop: vi.fn(async () => undefined),
	};
	const books = {
		reversed: vi.fn(async () => ({ number: 'SA/26-27/0005', journalNumber: 'JV/26-27/000014' })),
		nextNumber: vi.fn(async () => 'SA/26-27/0005'),
	};
	const formats = {
		seller: vi.fn(async () => ({ name: 'K.R. Marketing' })),
		renderActive: vi.fn(async () => new Uint8Array([1, 2])),
	};
	const pages = new StockAdjustmentPages(
		{
			findById: async (id: string) => (rows[id] as never) ?? null,
			save: async (row: Record<string, unknown>) => void saved.push(row),
		},
		writer as never,
		{
			nameOf: async (id: string | null) => (id ? 'Owner' : 'Someone'),
			inTransaction: async (work: (context: unknown) => Promise<unknown>) => work({ tx: 1 }),
			record: async (entry: { action: string; text: string }) => void records.push(entry),
		} as never,
		books as never,
		{ isSuperAdmin: async () => options.superAdmin ?? true },
		formats as never,
	);
	return { pages, saved, records, writer, books, formats };
}

const owner = { userId: 'adm_1', permissions: ['stock.cost', 'stock.approve', 'stock.index'] } as never;
const staff = { userId: 'usr_3', permissions: ['stock.index'] } as never;
const why = { reason: 'Counted wrong, the two were found' };

describe('the adjustment page (E3)', () => {
	it('shows what a write-off changed: stock ledger, cost layers, value and input tax, and offers Reverse', async () => {
		const detail = await setup().pages.detail('adj_1', owner);
		expect(detail.whatChanged).toEqual({
			ledger: { change: -2, onHandBefore: 14, onHandAfter: 12 },
			layers: [{ quantity: 2, unitCostINR: 310, source: 'OS/26-27/000001' }],
			valueINR: 620,
			itc: { amountINR: 31, journalNumber: 'JV/26-27/000013' },
		});
		expect([detail.reverses, detail.reversedBy, detail.canReverse, detail.reverseNumber]).toEqual([
			null,
			null,
			true,
			'SA/26-27/0005',
		]);
		expect(detail.request.valueAtCostINR).toBe(620);
	});

	it('hides cost and input tax from those who can’t see cost, and offers Reverse only to a super admin', async () => {
		const detail = await setup({ superAdmin: false }).pages.detail('adj_1', staff);
		expect(detail.whatChanged).toMatchObject({ layers: [], valueINR: null, itc: { amountINR: null } });
		expect(detail.request).toMatchObject({ valueAtCostINR: null, costBreakdown: null, itcReversedINR: null });
		expect(detail.request.applied?.layers).toEqual([]);
		expect([detail.canReverse, detail.reverseNumber]).toEqual([false, null]);
		const unapplied = await setup({
			rows: { adj_1: posted({ applied: undefined, journalNumber: null, itcReversedINR: undefined }) },
		}).pages.detail('adj_1', staff);
		expect(unapplied.whatChanged).toEqual({ ledger: null, layers: [], valueINR: null, itc: null });
		expect(unapplied.request.applied).toBeNull();
		const noTax = await setup({
			rows: { adj_1: posted({ itcReversedINR: undefined, applied: null }) },
		}).pages.detail('adj_1', owner);
		expect(noTax.whatChanged).toMatchObject({ layers: [], itc: { amountINR: null } });
	});

	it('names the reversal and what a reversal reverses; neither can be reversed again', async () => {
		const rows = {
			adj_1: posted({ reversedBy: 'adj_2', reversedAt: '2026-11-24T05:00:00.000Z' }),
			adj_2: posted({ id: 'adj_2', action: 'add', number: 'SA/26-27/0005', reverses: 'adj_1' }),
		};
		const reversed = await setup({ rows }).pages.detail('adj_1', owner);
		expect(reversed.reversedBy).toEqual({ id: 'adj_2', number: 'SA/26-27/0005', byName: 'Store manager' });
		expect(reversed.canReverse).toBe(false);
		const reversal = await setup({ rows }).pages.detail('adj_2', owner);
		expect(reversal.reverses).toEqual({ id: 'adj_1', number: 'SA/26-27/0004' });
		expect(reversal.canReverse).toBe(false);
		const older = {
			adj_1: posted({ reversedBy: 'adj_2' }),
			adj_2: posted({ id: 'adj_2', number: undefined, reverses: 'adj_1' }),
		};
		expect((await setup({ rows: older }).pages.detail('adj_1', owner)).reversedBy?.number).toBeNull();
		const unnumbered = { adj_1: posted({ number: undefined }), adj_2: posted({ id: 'adj_2', reverses: 'adj_1' }) };
		expect((await setup({ rows: unnumbered }).pages.detail('adj_2', owner)).reverses?.number).toBeNull();
		expect((await setup({ rows: unnumbered }).pages.detail('adj_1', owner)).canReverse).toBe(false);
		const waiting = { adj_1: posted({ status: 'pending' }) };
		expect((await setup({ rows: waiting }).pages.detail('adj_1', owner)).canReverse).toBe(false);
	});

	it('finds only adjustments', async () => {
		await expect(setup({ rows: {} }).pages.detail('adj_x', owner)).rejects.toThrow('Adjustment not found');
		const count = { cnt_req: posted({ id: 'cnt_req', kind: 'count' }) };
		await expect(setup({ rows: count }).pages.detail('cnt_req', owner)).rejects.toThrow('Adjustment not found');
	});
});

describe('Reverse (E3, super admin)', () => {
	it('brings written-off pieces back at the cost they left at, numbered and posted; the original is marked reversed', async () => {
		const { pages, saved, records, writer, books } = setup();
		const now = new Date('2026-11-24T05:00:00.000Z');
		const reversal = await pages.reverse('adj_1', { reason: '  Counted wrong, the two were found ' }, owner, now);
		expect(writer.apply).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'add',
				quantity: 2,
				unitCostINR: 310,
				note: 'Counted wrong, the two were found',
			}),
			{ tx: 1 },
		);
		expect(books.reversed).toHaveBeenCalledWith(
			{ id: 'adj_1', number: 'SA/26-27/0004' },
			reversal.id,
			{ tx: 1 },
			'adm_1',
			now,
		);
		expect(reversal).toMatchObject({
			action: 'add',
			number: 'SA/26-27/0005',
			journalNumber: 'JV/26-27/000014',
			reverses: 'adj_1',
			costBreakdown: null,
			photoAssetIds: [],
			selfApproved: true,
			requestedByName: 'Owner',
			applied: { onHandBefore: 12, onHandAfter: 14 },
		});
		expect(saved[1]).toMatchObject({ id: 'adj_1', reversedBy: reversal.id, reversedAt: now.toISOString() });
		expect(records[0]?.text).toBe(
			'Owner reversed SA/26-27/0004 with SA/26-27/0005 (+2 × PTC-CRM-M): Counted wrong, the two were found.',
		);
		expect(writer.refreshShop).toHaveBeenCalledWith(['prd_1']);
	});

	it('takes added pieces out again oldest-first, and costs a write-off with no value at nothing', async () => {
		const added = setup({ rows: { adj_1: posted({ action: 'add' }) } });
		const reversal = await added.pages.reverse('adj_1', why, owner);
		expect(added.writer.apply).toHaveBeenCalledWith(
			expect.objectContaining({ action: 'remove', unitCostINR: null }),
			{ tx: 1 },
		);
		expect(reversal.costBreakdown).toBe('2 at ₹310');
		expect(added.records[0]?.text).toContain('(−2 × PTC-CRM-M)');
		const uncosted = setup({ rows: { adj_1: posted({ valueAtCostINR: null }) } });
		await uncosted.pages.reverse('adj_1', why, undefined);
		expect(uncosted.writer.apply).toHaveBeenCalledWith(expect.objectContaining({ unitCostINR: 0, actor: null }), {
			tx: 1,
		});
	});

	it('refuses anyone but a super admin, an unposted, reversed or reversing adjustment, and a missing reason', async () => {
		await expect(setup({ superAdmin: false }).pages.reverse('adj_1', why, owner)).rejects.toMatchObject({
			response: { issues: [{ message: 'reverse_super_admin_only' }] },
		});
		const code = (rows: Record<string, unknown>, reason = why.reason) =>
			setup({ rows })
				.pages.reverse('adj_1', { reason }, owner)
				.catch((error: { response: unknown }) => error.response);
		expect(await code({ adj_1: posted({ status: 'pending' }) })).toMatchObject({
			issues: [{ code: 'adjustment_not_posted' }],
		});
		expect(await code({ adj_1: posted({ number: undefined }) })).toMatchObject({
			issues: [{ code: 'adjustment_not_posted' }],
		});
		expect(await code({ adj_1: posted({ reversedBy: 'adj_2' }) })).toMatchObject({
			issues: [{ code: 'adjustment_already_reversed' }],
		});
		expect(await code({ adj_1: posted({ reverses: 'adj_0' }) })).toMatchObject({
			issues: [{ code: 'adjustment_is_a_reversal' }],
		});
		expect(await code({ adj_1: posted() }, ' no ')).toMatchObject({ issues: [{ code: 'reason_required' }] });
	});

	it('says when the pieces have left the stock since, and lets other failures through', async () => {
		await expect(
			setup({ applyFails: new StockMovementRefusedError('short') as never }).pages.reverse('adj_1', why, owner),
		).rejects.toMatchObject({ response: { issues: [{ code: 'stock_moved_meanwhile' }] } });
		await expect(setup({ applyFails: new Error('db down') }).pages.reverse('adj_1', why, owner)).rejects.toThrow(
			'db down',
		);
	});
});

describe('the adjustment print', () => {
	it('prints the adjustment on its document format', async () => {
		const { pages, formats } = setup();
		expect(await pages.print('adj_1')).toEqual({
			fileName: 'stock-adjustment-SA-26-27-0004.pdf',
			data: new Uint8Array([1, 2]),
		});
		expect(formats.renderActive).toHaveBeenCalledWith(
			'stockAdjustment',
			expect.objectContaining({ number: 'SA/26-27/0004' }),
		);
		const loose = setup({ rows: { adj_1: posted({ number: undefined }) } });
		expect((await loose.pages.print('adj_1')).fileName).toBe('stock-adjustment-adj-1.pdf');
	});

	it('draws before, change, after and the reason; an addition, an unapplied or unnamed one leaves blanks', () => {
		const seller = { name: 'K.R. Marketing' } as never;
		expect(stockAdjustmentData(posted() as never, seller)).toMatchObject({
			doc: 'stockAdjustment',
			number: 'SA/26-27/0004',
			date: '22 Nov 2026',
			values: { adjustmentNo: 'SA/26-27/0004', date: '22 Nov 2026' },
			rows: [
				{
					cells: {
						index: '1',
						item: 'Cream petticoat · PTC-CRM-M',
						before: '14',
						change: '−2',
						after: '12',
						reason: 'Damaged',
					},
					sku: 'PTC-CRM-M',
				},
			],
			signatures: { approvedBy: 'Owner' },
		});
		const bare = stockAdjustmentData(
			posted({
				action: 'add',
				number: undefined,
				applied: undefined,
				reasonCode: null,
				sku: null,
				decidedAt: null,
				decidedByName: null,
			}) as never,
			seller,
		);
		expect(bare).toMatchObject({
			number: 'adj_1',
			rows: [{ cells: { item: 'Cream petticoat', before: '', change: '+2', after: '', reason: '' }, sku: '' }],
			signatures: { approvedBy: '' },
		});
	});
});

describe('the adjustment routes', () => {
	it('serve the page, Reverse and the PDF', async () => {
		const pages = {
			detail: vi.fn(async () => 'detail'),
			reverse: vi.fn(async () => 'reversal'),
			print: vi.fn(async () => ({ fileName: 'stock-adjustment-SA.pdf', data: new Uint8Array([7]) })),
		};
		const controller = new StockAdjustmentPagesController(pages as never);
		expect(await controller.detail('adj_1', owner)).toBe('detail');
		expect(await controller.reverse('adj_1', why, owner)).toBe('reversal');
		expect(pages.reverse).toHaveBeenCalledWith('adj_1', why, owner);
		const headers: Record<string, string> = {};
		const reply = {
			header: (name: string, value: string) => {
				headers[name] = value;
				return reply;
			},
			send: vi.fn(),
		};
		await controller.print('adj_1', reply as never);
		expect(headers['Content-Disposition']).toBe('attachment; filename="stock-adjustment-SA.pdf"');
		expect(reply.send).toHaveBeenCalledWith(Buffer.from([7]));
	});
});
