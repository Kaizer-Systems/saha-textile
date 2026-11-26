import { StockMovementRefusedError } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { StockApprovalsService } from '../src/purchasing/stock-approvals.service';

/**
 * The approvals queue (i05, i05b) with numbered adjustments (accounts brief D5, E3): every path, and an approved
 * write-off numbered and posted to the books in the approval's transaction.
 */

const request = (over: Record<string, unknown> = {}) => ({
	id: 'adj_1',
	kind: 'adjustment',
	variantId: 'var_1',
	productId: 'prd_1',
	sku: 'PTC-CRM-M',
	action: 'remove',
	quantity: 2,
	reasonCode: 'damage',
	holdId: null,
	note: 'Two stained.',
	valueAtCostINR: 620,
	costBreakdown: '2 × ₹310',
	countId: null,
	countNumber: null,
	status: 'pending',
	requestedBy: 'usr_2',
	requestedByName: 'Store manager',
	...over,
});
const facts = {
	variantId: 'var_1',
	productId: 'prd_1',
	sku: 'PTC-CRM-M',
	soldBy: 'piece',
	onHand: 14,
	held: 2,
	reserved: 0,
	tracked: true,
	hsnCode: '5208',
};

function setup(options: { found?: unknown; applyFails?: Error; books?: boolean; hold?: unknown } = {}) {
	const saved: unknown[] = [];
	const records: { text: string; entityId: string }[] = [];
	const writer = {
		facts: vi.fn(async () => facts),
		holdById: vi.fn(async () => options.hold ?? null),
		apply: vi.fn(async (change: { action: string; quantity: number }) => {
			if (options.applyFails) throw options.applyFails;
			return {
				onHandBefore: 14,
				onHandAfter: change.action === 'remove' ? 12 : 16,
				heldBefore: 0,
				heldAfter: 0,
				valueINR: 620,
				breakdown: '',
				holdId: null,
			};
		}),
		refreshShop: vi.fn(async () => undefined),
	};
	const counts = {
		apply: vi.fn(
			async (_id: string, _by: string, _actor: string, _x: boolean, save: (context: unknown) => Promise<void>) =>
				save({ tx: 1 }),
		),
		reopen: vi.fn(async () => undefined),
	};
	const adjustmentBooks = {
		number: vi.fn(async () => 'SA/26-27/0004'),
		posted: vi.fn(async () => ({
			number: 'SA/26-27/0004',
			outcome: 'writtenOff',
			itcReversedINR: 31,
			journalNumber: 'JV/26-27/000013',
		})),
	};
	const service = new StockApprovalsService(
		{
			list: async () => ({ items: [request()], total: 1 }),
			findById: async () => (options.found === undefined ? request() : options.found),
			save: async (row: unknown) => void saved.push(row),
		} as never,
		writer as never,
		counts as never,
		{
			nameOf: async (id: string | null) => (id ? `Name of ${id}` : 'Someone'),
			inTransaction: async (work: (context: unknown) => Promise<unknown>) => work({ tx: 1 }),
			record: async (entry: { text: string; entityId: string }) => void records.push(entry),
		} as never,
		options.books === false ? null : (adjustmentBooks as never),
	);
	return { service, saved, records, writer, counts, adjustmentBooks };
}

const owner = { userId: 'adm_1', permissions: ['stock.cost', 'stock.approve'] } as never;
const approver = { userId: 'adm_3', permissions: ['stock.approve'] } as never;

describe('the approvals queue (i05)', () => {
	it('lists requests, hiding value and cost from those who can’t see cost', async () => {
		const { service } = setup();
		expect((await service.list({} as never, owner)).items[0]).toMatchObject({ valueAtCostINR: 620 });
		expect((await service.list({} as never, approver)).items[0]).toMatchObject({
			valueAtCostINR: null,
			costBreakdown: null,
		});
	});

	it('refuses a request that is gone, decided, or the approver’s own', async () => {
		await expect(setup({ found: null }).service.approve('adj_x', owner)).rejects.toThrow('Request not found');
		await expect(
			setup({ found: request({ status: 'applied' }) }).service.approve('adj_1', owner),
		).rejects.toMatchObject({
			response: { issues: [{ code: 'already_decided' }] },
		});
		await expect(
			setup({ found: request({ requestedBy: 'adm_1' }) }).service.approve('adj_1', owner),
		).rejects.toMatchObject({
			response: { issues: [{ code: 'own_request' }] },
		});
	});
});

describe('approving (D5: numbered and posted)', () => {
	it('approves a write-off: applied, numbered SA, its voucher and input tax kept, the shop refreshed', async () => {
		const { service, saved, records, adjustmentBooks, writer } = setup();
		const decided = await service.approve('adj_1', owner);
		expect(adjustmentBooks.posted).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'adj_1',
				action: 'remove',
				outcome: 'writtenOff',
				hsnCode: '5208',
				valueINR: 620,
			}),
			'SA/26-27/0004',
			{ tx: 1 },
			'adm_1',
		);
		expect(decided).toMatchObject({
			status: 'applied',
			number: 'SA/26-27/0004',
			journalNumber: 'JV/26-27/000013',
			itcReversedINR: 31,
			valueAtCostINR: 620,
		});
		expect(saved).toHaveLength(1);
		expect(records[0]?.text).toContain("approved Store manager's write-off of 2 × PTC-CRM-M (Damaged, ₹620)");
		expect(writer.refreshShop).toHaveBeenCalledWith(['prd_1']);
	});

	it('approves an addition and a request with its own outcome, a held write-off and an unnamed requester', async () => {
		const added = setup({
			found: request({ action: 'add', reasonCode: null, valueAtCostINR: null, requestedByName: null }),
		});
		const decided = await added.service.approve('adj_1', owner);
		expect(added.adjustmentBooks.posted).toHaveBeenCalledWith(
			expect.objectContaining({ action: 'add', outcome: null }),
			'SA/26-27/0004',
			{ tx: 1 },
			'adm_1',
		);
		expect(decided.valueAtCostINR).toBeNull();
		expect(added.records[0]?.text).toContain("approved Name of usr_2's addition of 2 × PTC-CRM-M ()");
		const kept = setup({ found: request({ outcome: 'writtenOff' }) });
		await kept.service.approve('adj_1', owner);
		const hold = { id: 'hold_1', quantity: 2, status: 'open' };
		const held = setup({ found: request({ holdId: 'hold_1' }), hold });
		await held.service.approve('adj_1', owner);
		expect(held.writer.holdById).toHaveBeenCalledWith('hold_1');
		const unbooked = setup({ books: false });
		expect(await unbooked.service.approve('adj_1', owner)).not.toHaveProperty('number');
	});

	it('applies a count’s differences with the decision, and refuses an incomplete or no longer possible request', async () => {
		const count = setup({ found: request({ kind: 'count', countId: 'cnt_1', variantId: null, action: null }) });
		const decided = await count.service.approve('adj_1', owner);
		expect(decided.status).toBe('applied');
		expect(count.counts.apply).toHaveBeenCalledWith('cnt_1', 'usr_2', 'adm_1', false, expect.any(Function));
		expect(count.saved).toHaveLength(1);
		await expect(
			setup({ found: request({ variantId: null }) }).service.approve('adj_1', owner),
		).rejects.toMatchObject({
			response: { issues: [{ code: 'request_incomplete' }] },
		});
		await expect(setup({ found: request({ action: null }) }).service.approve('adj_1', owner)).rejects.toMatchObject(
			{
				response: { issues: [{ code: 'request_incomplete' }] },
			},
		);
		await expect(setup({ found: request({ quantity: 99 }) }).service.approve('adj_1', owner)).rejects.toMatchObject(
			{
				response: { issues: [{ code: 'adjustment_refused' }] },
			},
		);
		await expect(
			setup({ applyFails: new StockMovementRefusedError('moved') as never }).service.approve('adj_1', owner),
		).rejects.toMatchObject({ response: { issues: [{ code: 'stock_moved_meanwhile' }] } });
		await expect(setup({ applyFails: new Error('db down') }).service.approve('adj_1', owner)).rejects.toThrow(
			'db down',
		);
	});
});

describe('rejecting (i05)', () => {
	it('wants a reason, and tells the requester why for a write-off, an addition or a count', async () => {
		await expect(setup().service.reject('adj_1', ' no ', owner)).rejects.toMatchObject({
			response: { issues: [{ code: 'reason_required' }] },
		});
		const off = setup();
		expect(await off.service.reject('adj_1', 'No photo of the stain', owner)).toMatchObject({
			status: 'rejected',
			rejectReason: 'No photo of the stain',
		});
		expect(off.records[0]).toMatchObject({
			entityId: 'adj_1',
			text: expect.stringContaining("Store manager's write-off of 2"),
		});
		const add = setup({ found: request({ action: 'add', requestedByName: null }) });
		await add.service.reject('adj_1', 'Count again first', owner);
		expect(add.records[0]?.text).toContain("Name of usr_2's addition of 2");
		const count = setup({ found: request({ kind: 'count', countId: 'cnt_1', countNumber: 'SC/26-27/0002' }) });
		await count.service.reject('adj_1', 'Shelf B was skipped', owner);
		expect(count.counts.reopen).toHaveBeenCalledWith('cnt_1', 'adm_1', { tx: 1 });
		expect(count.records[0]).toMatchObject({
			entityId: 'cnt_1',
			text: expect.stringContaining('count SC/26-27/0002'),
		});
		const loose = setup({ found: request({ kind: 'count', countId: null }) });
		await loose.service.reject('adj_1', 'Not a real count', undefined);
		expect(loose.counts.reopen).not.toHaveBeenCalled();
		expect(loose.records[0]?.entityId).toBe('adj_1');
	});
});
