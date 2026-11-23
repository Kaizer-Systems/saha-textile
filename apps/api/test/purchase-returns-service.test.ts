import { StaleVersionError, StockMovementRefusedError } from '@saha-textile/core-domain';
import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { PurchaseReturnsService } from '../src/purchasing/purchase-returns.service';

/**
 * Purchase returns and debit notes (r01–r04), with the debit note and a supplier's refund in the books (Postings and
 * Convert brief P1). Every store is in memory; the books are a recorder.
 */

type Row = Record<string, unknown>;
const at = '2026-11-20T05:00:00.000Z';
const TODAY = '2026-11-24';

const entryLine = (o: Row = {}): Row => ({
	lineId: 'l1',
	productId: 'p1',
	variantId: 'v1',
	sku: 'SAR-1',
	title: 'Saree',
	optionsLabel: 'Red',
	soldBy: 'piece',
	imageUrl: null,
	gstRatePct: 5,
	quantity: 10,
	accepted: 10,
	missing: 0,
	unitCostINR: 100,
	...o,
});
const entryOf = (o: Row = {}): Row => ({
	id: 'pe_1',
	number: 'PE/26-27/000007',
	status: 'posted',
	supplierId: 'sup_1',
	supplierName: 'Bose Textiles',
	taxType: 'intra_state',
	itcClaimable: true,
	lines: [entryLine(), entryLine({ lineId: 'l2', variantId: 'v2', sku: 'MTR-1', soldBy: 'metre', unitCostINR: 400 })],
	totals: { totalINR: 5_000 },
	paidINR: 0,
	creditedINR: 0,
	paymentStatus: 'unpaid',
	version: 3,
	...o,
});
const returnOf = (o: Row = {}): Row => ({
	id: 'pr_1',
	number: null,
	kind: 'return_goods',
	status: 'draft',
	origin: 'manual',
	purchaseEntryId: 'pe_1',
	purchaseEntryNumber: 'PE/26-27/000007',
	supplierId: 'sup_1',
	supplierName: 'Bose Textiles',
	taxType: 'intra_state',
	reason: 'damaged_on_arrival',
	noteToSupplier: null,
	photoAssetIds: [],
	lines: [
		{
			lineId: 'prl_1',
			entryLineId: 'l1',
			productId: 'p1',
			variantId: 'v1',
			sku: 'SAR-1',
			soldBy: 'piece',
			quantity: 2,
		},
	],
	taxableINR: 200,
	cgstINR: 5,
	sgstINR: 5,
	igstINR: 0,
	totalINR: 210,
	challanNumber: null,
	courier: null,
	docket: null,
	sentAt: null,
	sentBy: null,
	settlements: [],
	settledINR: 0,
	settledAt: null,
	settledBy: null,
	holdId: null,
	createdBy: 'adm_a',
	createdAt: at,
	updatedAt: at,
	updatedBy: null,
	version: 2,
	...o,
});

interface Options {
	entries?: Row[];
	returns?: Row[];
	layers?: Row[];
	/** Layers read again inside the send are gone (stock moved meanwhile). */
	layersGoneLater?: boolean;
	facts?: Record<string, Row>;
	holds?: Row[];
	claim?: 'new' | 'seen';
	moveFails?: unknown;
	saveFails?: unknown;
	settings?: Row;
	outbox?: 'none' | 'fails';
}

function setup(o: Options = {}) {
	const entries = new Map((o.entries ?? [entryOf()]).map((row) => [row['id'] as string, row]));
	const returns = new Map((o.returns ?? [returnOf()]).map((row) => [row['id'] as string, row]));
	const audit: { action: string; text: string }[] = [];
	const saves: Row[] = [];
	const entrySaves: Row[] = [];
	const holdSaves: Row[] = [];
	const moves: Row[] = [];
	const removed: string[] = [];
	const outbox: unknown[] = [];
	const listed: unknown[] = [];
	let layerReads = 0;
	const books = { purchaseReturnSent: vi.fn(async () => null), purchaseReturnSettled: vi.fn(async () => null) };
	const settings = {
		numberFormats: { debitNote: 'DN/{fy}/{seq6}', deliveryChallan: 'DC/{fy}/{seq6}' },
		booksClosedUpTo: null,
		...o.settings,
	};
	const service = new PurchaseReturnsService(
		{
			findById: async (id: string) => returns.get(id) ?? null,
			forEntry: async () => [...returns.values()],
			list: async (query: unknown) => (listed.push(query), { items: [], total: 0, counts: {} }),
			save: async (doc: Row, expected: number | null) => {
				if (o.saveFails) throw o.saveFails;
				saves.push(doc);
				returns.set(doc['id'] as string, doc);
				return (expected ?? 0) + 1;
			},
			remove: async (id: string) => void removed.push(id),
			claimSendKey: async () => o.claim ?? 'new',
		} as never,
		{
			findById: async (id: string) => entries.get(id) ?? null,
			save: async (entry: Row) => (entrySaves.push(entry), 4),
		} as never,
		{
			layersForEntry: async () => {
				if (o.layersGoneLater && layerReads++ > 0) return [];
				return o.layers ?? [{ id: 'lay_1', sourceLineId: 'l1', quantityRemaining: 10 }];
			},
			items: async () => new Map(Object.entries(o.facts ?? { v1: { onHand: 10, held: 0, reserved: 0 } })),
		} as never,
		{
			findById: async (id: string) => (o.holds ?? []).find((row) => row['id'] === id) ?? null,
			save: async (hold: Row) => void holdSaves.push(hold),
		} as never,
		{
			consumeLayer: async (...args: unknown[]) => void moves.push({ consumed: args }),
			move: async (move: Row) => {
				if (o.moveFails) throw o.moveFails;
				moves.push(move);
			},
		} as never,
		{ next: async (series: string) => (series === 'DN' ? 3 : 9) } as never,
		{
			settings: async () => settings,
			today: () => TODAY,
			guardStale: async <T>(work: () => Promise<T>) => {
				try {
					return await work();
				} catch (error) {
					if (error instanceof StaleVersionError) throw new ConflictException('stale');
					throw error;
				}
			},
			inTransaction: <T>(work: (context: object) => Promise<T>) => work({}),
			record: async (input: { action: string; text: string }) => void audit.push(input),
			nameOf: async () => 'Asha',
			activity: async (type: string, ids: string[]) => [{ type, ids }],
		} as never,
		books as never,
		o.outbox === 'none'
			? null
			: ({
					request: async (ids: unknown) => {
						if (o.outbox === 'fails') throw new Error('queue down');
						outbox.push(ids);
					},
				} as never),
	);
	return { service, books, audit, saves, entrySaves, holdSaves, moves, removed, outbox, listed, returns };
}

const issues = (error: unknown) =>
	(error as { response?: { issues?: { code: string; message: string }[] } }).response?.issues ?? [];
async function refusal(work: Promise<unknown>): Promise<string[]> {
	try {
		await work;
	} catch (error) {
		const coded = issues(error).map((issue) => issue.code);
		return coded.length ? coded : [(error as Error).message];
	}
	throw new Error('expected a refusal');
}
const write = (o: Row = {}) =>
	({
		purchaseEntryId: 'pe_1',
		kind: 'return_goods',
		reason: 'damaged_on_arrival',
		noteToSupplier: null,
		photoAssetIds: [],
		lines: [{ entryLineId: 'l1', quantity: 2 }],
		holdId: null,
		...o,
	}) as never;

describe('reading returns', () => {
	it('lists with today, opens one, and lists an entry’s', async () => {
		const { service, listed } = setup();
		await service.list({ page: 1 } as never);
		expect(listed).toEqual([{ page: 1, today: TODAY }]);
		expect(await service.get('pr_1')).toMatchObject({ id: 'pr_1' });
		expect(await refusal(service.get('pr_x'))).toEqual(['Purchase return not found']);
		expect(await service.forEntry('pe_1')).toHaveLength(1);
		expect(await service.activity('pr_1')).toEqual([{ type: 'purchase_return', ids: ['pr_1'] }]);
	});
});

describe('what can go back', () => {
	it('starts only from a posted entry, and from an open hold', async () => {
		expect(await refusal(setup({ entries: [] }).service.returnable('pe_1', 'return_goods', null, null))).toEqual([
			'Purchase entry not found',
		]);
		expect(
			await refusal(
				setup({ entries: [entryOf({ status: 'draft' })] }).service.returnable(
					'pe_1',
					'return_goods',
					null,
					null,
				),
			),
		).toEqual(['entry_not_posted']);
		expect(await refusal(setup().service.returnable('pe_1', 'return_goods', 'hold_x', null))).toEqual([
			'hold_closed',
		]);
		expect(
			await refusal(
				setup({ holds: [{ id: 'hold_1', status: 'returned' }] }).service.returnable(
					'pe_1',
					'return_goods',
					'hold_1',
					null,
				),
			),
		).toEqual(['hold_closed']);
	});

	it('counts what went back before, from stock or as claims, leaving out the return being changed', async () => {
		const { service } = setup({
			entries: [
				entryOf({
					lines: [
						entryLine({ missing: 3 }),
						entryLine({ lineId: 'l2', variantId: 'v2', accepted: null, unitCostINR: null }),
						entryLine({ lineId: 'l3', variantId: 'v3', soldBy: 'metre', unitCostINR: null }),
					],
				}),
			],
			returns: [
				returnOf({
					id: 'pr_a',
					status: 'sent',
					lines: [
						{ entryLineId: 'l1', quantity: 2 },
						{ entryLineId: 'l2', quantity: 1 },
					],
				}),
				returnOf({
					id: 'pr_b',
					status: 'sent',
					origin: 'goods_check',
					lines: [{ entryLineId: 'l1', quantity: 5 }],
				}),
				returnOf({ id: 'pr_c', kind: 'short_supply', lines: [{ entryLineId: 'l1', quantity: 1 }] }),
				returnOf({ id: 'pr_me', lines: [{ entryLineId: 'l1', quantity: 4 }] }),
			],
		});
		const goods = await service.returnable('pe_1', 'return_goods', null, 'pr_me');
		expect(
			goods.map((row) => [row.entryLineId, row.received, row.returnedBefore, row.onHand, row.freeToReturn]),
		).toEqual([
			['l1', 10, 2, 10, 8],
			['l2', 0, 1, 0, 0],
			['l3', 10, 0, 0, 0],
		]);
		expect(goods.map((row) => row.unitCostINR)).toEqual([100, 0, 0]);
		const claims = await service.returnable('pe_1', 'short_supply', null, null);
		expect(claims[0]).toMatchObject({ returnedBefore: 1, freeToReturn: 2 });
	});

	it('keeps to the held variant when the return takes held pieces', async () => {
		const { service } = setup({ holds: [{ id: 'hold_1', status: 'open', variantId: 'v1', quantity: 3 }] });
		const rows = await service.returnable('pe_1', 'return_goods', 'hold_1', null);
		expect(rows.map((row) => [row.entryLineId, row.freeToReturn])).toEqual([['l1', 3]]);
	});
});

describe('return drafts', () => {
	it('makes a return or a short-supply claim draft, priced from the entry, held pieces marked', async () => {
		const { service, audit } = setup({
			entries: [
				entryOf({
					lines: [
						entryLine({ missing: 2 }),
						entryLine({
							lineId: 'l2',
							variantId: 'v2',
							sku: 'MTR-1',
							soldBy: 'metre',
							unitCostINR: 400,
							accepted: 30,
						}),
					],
				}),
			],
			facts: { v1: { onHand: 10, held: 0, reserved: 0 }, v2: { onHand: 30, held: 0, reserved: 0 } },
			layers: [
				{ id: 'lay_1', sourceLineId: 'l1', quantityRemaining: 10 },
				{ id: 'lay_2', sourceLineId: 'l2', quantityRemaining: 30 },
			],
			holds: [{ id: 'hold_1', status: 'open', variantId: 'v1', quantity: 2 }],
			returns: [],
		});
		const made = (await service.create(
			write({
				lines: [
					{ entryLineId: 'l1', quantity: 2 },
					{ entryLineId: 'l2', quantity: 25 },
				],
			}),
			'adm_a',
		)) as unknown as Row & { lines: Row[] };
		expect(made).toMatchObject({ origin: 'manual', status: 'draft', version: 1, taxableINR: 1_200 });
		expect(made.lines[1]).toMatchObject({ unitCostINR: 40, taxableINR: 1_000 });
		expect(audit[0]?.text).toContain(
			'made a return draft for Bose Textiles from PE/26-27/000007: 2 × SAR-1, 2.5 m × MTR-1, ₹1,260',
		);
		const claim = (await service.create(
			write({ kind: 'short_supply', reason: 'other', lines: [{ entryLineId: 'l1', quantity: 2 }] }),
			null,
		)) as unknown as Row;
		expect(claim).toMatchObject({ reason: 'short_supplied' });
		expect(audit[1]?.text).toContain('made a short-supply claim draft');
		const held = (await service.create(write({ holdId: 'hold_1' }), null)) as unknown as Row;
		expect(held['origin']).toBe('held');
	});

	it('refuses held pieces on a claim, a line not on the entry or outside the hold, and more than can go back', async () => {
		const { service } = setup({ holds: [{ id: 'hold_1', status: 'open', variantId: 'v1', quantity: 2 }] });
		expect(await refusal(service.create(write({ kind: 'short_supply', holdId: 'hold_1' }), null))).toEqual([
			'hold_not_for_claim',
		]);
		expect(await refusal(service.create(write({ lines: [{ entryLineId: 'lx', quantity: 1 }] }), null))).toEqual([
			'line_not_on_entry',
		]);
		expect(
			await refusal(
				service.create(write({ holdId: 'hold_1', lines: [{ entryLineId: 'l2', quantity: 1 }] }), null),
			),
		).toEqual(['line_not_on_entry']);
		const capped = await service
			.create(write({ holdId: 'hold_1', lines: [{ entryLineId: 'l1', quantity: 3 }] }), null)
			.catch((e: unknown) => e);
		expect(issues(capped)[0]?.message).toBe('Only 2 of SAR-1 can go back.');
		const sold = await setup({ layers: [{ id: 'lay_1', sourceLineId: 'l1', quantityRemaining: 1 }] })
			.service.create(write(), null)
			.catch((e: unknown) => e);
		expect(issues(sold)[0]?.message).toBe(
			'Only 1 of SAR-1 can go back. Only 1 from this entry is still in stock; the rest has sold.',
		);
	});

	it('changes only a draft, on its own entry, keeping its line ids and version', async () => {
		expect(
			await refusal(setup({ returns: [returnOf({ status: 'sent' })] }).service.update('pr_1', write(), null)),
		).toEqual(['wrong_status']);
		expect(await refusal(setup().service.update('pr_1', write({ purchaseEntryId: 'pe_2' }), null))).toEqual([
			'entry_fixed',
		]);
		const { service } = setup({
			facts: { v1: { onHand: 10, held: 0, reserved: 0 }, v2: { onHand: 30, held: 0, reserved: 0 } },
			layers: [
				{ id: 'lay_1', sourceLineId: 'l1', quantityRemaining: 10 },
				{ id: 'lay_2', sourceLineId: 'l2', quantityRemaining: 30 },
			],
		});
		const changed = (await service.update(
			'pr_1',
			write({
				lines: [
					{ entryLineId: 'l1', quantity: 3 },
					{ entryLineId: 'l2', quantity: 1 },
				],
			}),
			'adm_b',
		)) as unknown as Row & { lines: Row[] };
		expect(changed.lines[0]?.['lineId']).toBe('prl_1');
		expect(changed.lines[1]?.['lineId']).toMatch(/^prl_/);
		expect(changed).toMatchObject({ version: 3, createdBy: 'adm_a', origin: 'manual' });
		expect(await setup().service.update('pr_1', write({ version: 7 }), null)).toMatchObject({ version: 8 });
		const stale = setup({
			saveFails: new StaleVersionError('purchase_return', 'pr_1', { version: 9, updatedAt: at, updatedBy: null }),
		});
		await expect(stale.service.update('pr_1', write(), null)).rejects.toBeInstanceOf(ConflictException);
	});

	it('deletes only a draft', async () => {
		expect(await refusal(setup({ returns: [returnOf({ status: 'sent' })] }).service.remove('pr_1', null))).toEqual([
			'wrong_status',
		]);
		const { service, removed, audit } = setup();
		await service.remove('pr_1', 'adm_a');
		expect(removed).toEqual(['pr_1']);
		expect(audit[0]?.text).toBe('Asha deleted a return draft for Bose Textiles (₹210).');
	});
});

describe('sending a debit note', () => {
	const send = (requestKey = 'send-key-0001') => ({ courier: 'DTDC', docket: 'D-1', requestKey }) as never;

	it('returns the sent note for the same press, and refuses a second send', async () => {
		const sent = returnOf({ status: 'sent', sendRequestKey: 'send-key-0001' });
		expect(await setup({ returns: [sent] }).service.send('pr_1', send(), null)).toMatchObject({ status: 'sent' });
		expect(await refusal(setup({ returns: [sent] }).service.send('pr_1', send('other-key'), null))).toEqual([
			'wrong_status',
		]);
		expect(await refusal(setup({ returns: [returnOf({ status: 'sent' })] }).service.send('pr_1', send(), null))).toEqual([
			'wrong_status',
		]);
	});

	it('refuses closed books and a send already under way', async () => {
		expect(await refusal(setup({ settings: { booksClosedUpTo: TODAY } }).service.send('pr_1', send(), null))).toEqual([
			'books_closed',
		]);
		expect(await refusal(setup({ claim: 'seen' }).service.send('pr_1', send(), null))).toEqual(['send_in_progress']);
	});

	it('sends goods: numbers, stock out of the entry’s layer, the hold closed, the bill credited and the books', async () => {
		const { service, moves, holdSaves, entrySaves, books, audit, outbox } = setup({
			returns: [returnOf({ holdId: 'hold_1' })],
			holds: [{ id: 'hold_1', status: 'open', variantId: 'v1', quantity: 2 }],
		});
		const sent = (await service.send('pr_1', send(), 'adm_b')) as unknown as Row;
		expect(sent).toMatchObject({
			status: 'sent',
			number: 'DN/26-27/000003',
			challanNumber: 'DC/26-27/000009',
			courier: 'DTDC',
			sentBy: 'adm_b',
		});
		expect(moves[1]).toMatchObject({ quantityDelta: -2, heldDelta: -2, referenceNumber: 'DN/26-27/000003' });
		expect(holdSaves[0]).toMatchObject({ status: 'returned', closedBy: 'adm_b' });
		expect(entrySaves[0]).toMatchObject({ creditedINR: 210 });
		expect(books.purchaseReturnSent).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'sent' }),
			true,
			{},
			'adm_b',
		);
		expect(audit[0]?.text).toContain('Stock −2 pieces. Delivery challan DC/26-27/000009.');
		expect(outbox).toEqual([['p1']]);
	});

	it('keeps the rest of a hold, and takes nothing from a hold on another variant', async () => {
		const partly = setup({
			returns: [returnOf({ holdId: 'hold_1' })],
			holds: [{ id: 'hold_1', status: 'open', variantId: 'v1', quantity: 5 }],
		});
		await partly.service.send('pr_1', send(), null);
		expect(partly.holdSaves[0]).toMatchObject({ quantity: 3 });
		const other = setup({
			returns: [returnOf({ holdId: 'hold_2' })],
			holds: [{ id: 'hold_2', status: 'open', variantId: 'v9', quantity: 5 }],
		});
		await other.service.send('pr_1', send(), null).catch(() => undefined);
		expect(other.moves.filter((m) => 'heldDelta' in m).map((m) => m['heldDelta'])).toEqual([]);
	});

	it('sends a short-supply claim or goods-check pieces without moving stock, and no challan for a claim', async () => {
		const claim = setup({
			returns: [returnOf({ kind: 'short_supply', reason: 'short_supplied' })],
			entries: [entryOf({ lines: [entryLine({ missing: 3 })] })],
			outbox: 'none',
		});
		const sent = (await claim.service.send('pr_1', send(), null)) as unknown as Row;
		expect(sent['challanNumber']).toBeNull();
		expect(claim.moves).toEqual([]);
		expect(claim.audit[0]?.text).toMatch(/No stock moved\.$/);
		const checked = setup({ returns: [returnOf({ origin: 'goods_check' })], entries: [] });
		expect(await refusal(checked.service.send('pr_1', send(), null))).toEqual(['Purchase entry not found']);
		const kept = setup({ returns: [returnOf({ origin: 'goods_check' })], outbox: 'fails' });
		await kept.service.send('pr_1', send(), null);
		expect(kept.moves).toEqual([]);
	});

	it('sends goods with no hold, crediting the bill from all its returns, even when the search queue fails', async () => {
		const { service, holdSaves, entrySaves, moves } = setup({
			returns: [returnOf(), returnOf({ id: 'pr_2', status: 'sent', totalINR: 100 })],
			outbox: 'fails',
		});
		await service.send('pr_1', send(), null);
		expect(holdSaves).toEqual([]);
		expect(moves[1]).toMatchObject({ heldDelta: -0 });
		expect(entrySaves[0]).toMatchObject({ creditedINR: 310 });
		const gone = setup({ layersGoneLater: true });
		expect(await refusal(gone.service.send('pr_1', send(), null))).toEqual(['stock_moved_meanwhile']);
	});

	it('turns stock gone meanwhile into words, and passes other failures on', async () => {
		expect(await refusal(setup({ layers: [] }).service.send('pr_1', send(), null))).toEqual(['return_capped']);
		const noLayer = setup({ returns: [returnOf({ origin: 'goods_check', kind: 'return_goods' })] });
		Object.assign(noLayer.service, {});
		const moved = setup({ moveFails: new StockMovementRefusedError('v1') });
		expect(await refusal(moved.service.send('pr_1', send(), null))).toEqual(['stock_moved_meanwhile']);
		const down = setup({ moveFails: new Error('db down') });
		expect(await refusal(down.service.send('pr_1', send(), null))).toEqual(['db down']);
	});
});

describe('settling a debit note', () => {
	const sent = (o: Row = {}) => returnOf({ status: 'sent', number: 'DN/26-27/000003', sentAt: at, ...o });
	const settle = (o: Row = {}) =>
		({
			how: 'refund',
			reference: 'NEFT 1',
			date: '2026-11-23',
			amountINR: 100,
			attachmentAssetId: null,
			...o,
		}) as never;

	it('refuses a draft, a settled note, too much, nothing, a future day, a day before sending or closed books', async () => {
		const words = async (doc: Row, body: never) =>
			issues(
				await setup({ returns: [doc] })
					.service.settle('pr_1', body, null)
					.catch((e: unknown) => e),
			)[0];
		expect((await words(returnOf(), settle()))?.message).toBe('Send the return first.');
		expect((await words(sent({ status: 'settled' }), settle()))?.message).toBe('This return is already settled.');
		expect((await words(sent(), settle({ amountINR: 300 })))?.code).toBe('settle_too_much');
		expect((await words(sent(), settle({ amountINR: 0 })))?.code).toBe('amount_positive');
		expect((await words(sent(), settle({ date: '2026-11-30' })))?.code).toBe('date_in_future');
		expect((await words(sent(), settle({ date: '2026-11-19' })))?.code).toBe('settled_before_sent');
		expect(
			await refusal(
				setup({ returns: [sent()], settings: { booksClosedUpTo: '2026-11-23' } }).service.settle(
					'pr_1',
					settle(),
					null,
				),
			),
		).toEqual(['books_closed']);
	});

	it('settles part with a refund into the books, then the rest by credit note', async () => {
		const { service, books, audit, entrySaves } = setup({ returns: [sent({ sentAt: null })] });
		const part = (await service.settle('pr_1', settle(), 'adm_b')) as unknown as Row;
		expect(part).toMatchObject({ status: 'sent', settledINR: 100, settledAt: null });
		expect(books.purchaseReturnSettled).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'pr_1' }),
			expect.objectContaining({ how: 'refund', amountINR: 100 }),
			{},
			'adm_b',
		);
		expect(audit[0]?.text).toBe('Asha settled ₹100 of DN/26-27/000003 with a refund NEFT 1. ₹110 stays open.');
		expect(entrySaves).toHaveLength(1);
		const rest = await service.settle(
			'pr_1',
			settle({ how: 'credit_note', reference: null, amountINR: 110 }),
			'adm_b',
		);
		expect(rest).toMatchObject({ status: 'settled', settledBy: 'adm_b' });
		expect(audit[1]?.text).toBe('Asha settled ₹110 of DN/26-27/000003 with their credit note.');
		const gone = setup({ returns: [sent()], entries: [] });
		expect(await gone.service.settle('pr_1', settle(), null)).toMatchObject({ settledINR: 100 });
		expect(gone.entrySaves).toEqual([]);
	});
});
