import { StockMovementRefusedError } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { StockService } from '../src/purchasing/stock.service';

/**
 * Stock screens (i01–i06) with numbered adjustments (accounts brief D5, E1, E3): every path of the stock service, and a
 * write-off or addition numbered and posted to the books in its own transaction.
 */

const fact = (over: Record<string, unknown> = {}) => ({
	variantId: 'var_1',
	productId: 'prd_1',
	sku: 'PTC-CRM-M',
	title: { en: 'Cotton petticoat' },
	optionsLabel: 'cream · M',
	galleryAssetId: 'img_1',
	categoryName: 'Petticoats',
	soldBy: 'piece',
	onHand: 14,
	held: 0,
	reserved: 0,
	lowStockLevel: 3,
	madeToOrder: false,
	tracked: true,
	barcode: '890000',
	hsnCode: '5208',
	...over,
});
const layer = (id: string, receivedAt: string, quantityRemaining: number, over: Record<string, unknown> = {}) => ({
	id,
	variantId: 'var_1',
	receivedAt,
	sourceType: 'opening_stock',
	sourceNumber: 'OS/26-27/000001',
	quantityReceived: 14,
	quantityRemaining,
	unitCostINR: 310,
	...over,
});
const ledgerRow = (over: Record<string, unknown> = {}) => ({
	id: 'led_1',
	createdAt: '2026-11-17T06:00:00.000Z',
	source: 'opening_stock',
	reasonCode: null,
	referenceType: 'opening_stock',
	referenceId: 'os_1',
	referenceNumber: 'OS/26-27/000001',
	actorUserId: 'adm_1',
	approverUserId: null,
	quantityDelta: 14,
	heldDelta: 0,
	balanceAfter: 14,
	heldAfter: 0,
	note: '',
	...over,
});

interface Options {
	facts?: Record<string, unknown>[];
	layers?: unknown[];
	previous?: unknown;
	hold?: unknown;
	applyFails?: Error;
	books?: boolean;
	ledger?: unknown[];
	holdsOpen?: { items: unknown[]; total: number; counts: Record<string, number> };
	decisions?: unknown[];
	payables?: unknown[];
	lateOrders?: unknown[];
	search?: unknown[];
	emptyBreakdown?: boolean;
}

function setup(options: Options = {}) {
	const facts = options.facts ?? [fact()];
	const byId = new Map(facts.map((f) => [f.variantId as string, f]));
	const saved: unknown[] = [];
	const records: { action: string; text: string }[] = [];
	const writer = {
		facts: vi.fn(async (id: string) => byId.get(id) ?? facts[0]),
		valueOf: vi.fn(async (_f: unknown, quantity: number) => ({
			parts: [],
			valueINR: quantity * 310,
			breakdown: options.emptyBreakdown ? '' : `${quantity} × ₹310`,
		})),
		apply: vi.fn(async (change: { action: string; quantity: number }) => {
			if (options.applyFails) throw options.applyFails;
			const delta = change.action === 'remove' ? -change.quantity : change.action === 'add' ? change.quantity : 0;
			const held =
				change.action === 'hold' ? change.quantity : change.action === 'release' ? -change.quantity : 0;
			return {
				onHandBefore: 14,
				heldBefore: 0,
				onHandAfter: 14 + delta,
				heldAfter: held,
				valueINR: change.quantity * 310,
				breakdown: '',
				holdId: change.action === 'hold' ? 'hold_new' : null,
			};
		}),
		refreshShop: vi.fn(async () => undefined),
	};
	const adjustmentBooks = {
		number: vi.fn(async () => 'SA/26-27/0004'),
		posted: vi.fn(async () => ({
			number: 'SA/26-27/0004',
			outcome: 'writtenOff',
			itcReversedINR: 31,
			journalNumber: 'JV/26-27/000013',
		})),
		preview: vi.fn(async () => ({ number: 'SA/26-27/0004', itcINR: 31, journalNumber: 'JV/26-27/000013' })),
	};
	const service = new StockService(
		{
			openLayers: async () => options.layers ?? [layer('l1', '2026-04-01T00:00:00.000Z', 14)],
			list: async () => ({ items: facts, total: facts.length, counts: { all: facts.length } }),
			totals: async () => ({ pieces: 14, metresTenths: 0, low: 0, out: 0, held: 0 }),
			soldSince: async () => new Map([['var_1', 2]]),
			items: async (ids: string[]) => new Map(ids.flatMap((id) => (byId.has(id) ? [[id, byId.get(id)]] : []))),
			valuationAsOf: async () => [{ valueINR: 4_340 }, { valueINR: 0.1 }],
			ledger: async () => ({ items: options.ledger ?? [ledgerRow()], total: (options.ledger ?? [1]).length }),
			layersOf: async () => options.layers ?? [layer('l1', '2026-04-01T00:00:00.000Z', 14)],
			search: async () => options.search ?? facts,
		} as never,
		{
			findById: async () => options.hold ?? null,
			open: async () => options.holdsOpen ?? { items: [], total: 0, counts: { waiting_for_supplier: 2 } },
			openForVariant: async () => [{ id: 'hold_1' }],
		} as never,
		{
			findByRequestKey: async () => options.previous ?? null,
			save: async (request: unknown) => void saved.push(request),
			pendingCount: async () => 3,
			unseenDecisions: async () => options.decisions ?? [],
			markSeen: vi.fn(async () => undefined),
		} as never,
		{ openPayables: async () => options.payables ?? [] } as never,
		{ list: async () => ({ items: options.lateOrders ?? [] }) } as never,
		writer as never,
		{
			today: () => '2026-11-22',
			thumbnails: async () => new Map([['img_1', 'https://cdn/img_1.jpg']]),
			names: async () => new Map([['adm_1', 'Owner']]),
			nameOf: async () => 'Owner',
			settings: async () => ({ heldReminderDays: 21, unpaidAlertDays: 150 }),
			record: async (entry: { action: string; text: string }) => void records.push(entry),
			inTransaction: async (work: (context: unknown) => Promise<unknown>) => work({ tx: 1 }),
		} as never,
		options.books === false ? null : (adjustmentBooks as never),
	);
	return { service, writer, saved, records, adjustmentBooks };
}

const owner = {
	userId: 'adm_1',
	permissions: ['stock.cost', 'stock.approve', 'stock.index', 'purchase.index', 'purchase_order.index'],
} as never;
const staff = { userId: 'usr_2', permissions: [] } as never;
const write = (over: Record<string, unknown> = {}) =>
	({
		variantId: 'var_1',
		action: 'remove',
		quantity: 2,
		reasonCode: 'damage',
		holdReason: null,
		holdId: null,
		note: 'Two stained in the store-room leak.',
		photoAssetIds: [],
		requestKey: 'key-00000001',
		...over,
	}) as never;

describe('All stock and one item (i01–i03)', () => {
	it('lists items with value, age and tiles for those who see cost, and without value for others', async () => {
		const { service } = setup({
			facts: [
				fact(),
				fact({ variantId: 'var_2', galleryAssetId: null, title: {}, onHand: 0, madeToOrder: true }),
			],
			layers: [
				layer('l1', '2026-04-01T00:00:00.000Z', 10),
				layer('l2', '2026-06-01T00:00:00.000Z', 4),
				layer('l3', '2026-03-01T00:00:00.000Z', 0),
			],
		});
		const seen = await service.list({ page: 1, pageSize: 20 } as never, owner);
		expect(seen.tiles).toMatchObject({
			valueAtCostINR: 4_340.1,
			pieces: 14,
			outSoldLast30Days: 0,
			heldWaitingForSupplier: 2,
		});
		expect(seen.items[0]).toMatchObject({
			imageUrl: 'https://cdn/img_1.jpg',
			lastReceivedOn: '2026-06-01',
			freeToSell: 14,
		});
		expect(seen.items[1]).toMatchObject({ imageUrl: null, title: 'PTC-CRM-M', lastReceivedOn: null });
		const hidden = await setup({ facts: [fact({ onHand: 0 })], layers: [] }).service.list({} as never, staff);
		expect(hidden.tiles).toMatchObject({ valueAtCostINR: null, outSoldLast30Days: 1 });
		expect(hidden.items[0]?.valueAtCostINR).toBeNull();
		const waiting = setup({ holdsOpen: { items: [], total: 0, counts: {} } });
		expect((await waiting.service.list({} as never, staff)).tiles.heldWaitingForSupplier).toBe(0);
	});

	it('shows an item’s history linked to its documents and its cost layers, oldest first', async () => {
		const { service } = setup({
			layers: [layer('l2', '2026-06-01T00:00:00.000Z', 4), layer('l1', '2026-04-01T00:00:00.000Z', 10)],
			ledger: [
				ledgerRow(),
				ledgerRow({ id: 'led_2', referenceType: 'mystery', actorUserId: 'usr_x', approverUserId: 'adm_1' }),
				ledgerRow({ id: 'led_3', referenceType: null, actorUserId: null }),
			],
		});
		const detail = await service.detail('var_1', { page: 1, pageSize: 20 }, owner);
		expect(detail.history.map((h) => [h.documentType, h.actorName, h.approverName])).toEqual([
			['opening_stock', 'Owner', null],
			['mystery', 'Someone', 'Owner'],
			[null, null, null],
		]);
		expect(detail.layers?.map((l) => [l.id, l.sellsNext])).toEqual([
			['l1', true],
			['l2', false],
		]);
		expect(detail.costBreakdown).toBeTruthy();
		const metre = setup({
			facts: [fact({ soldBy: 'metre' })],
			layers: [layer('l1', '2026-04-01', 0, { unitCostINR: 31.25 })],
		});
		const byMetre = await metre.service.detail('var_1', { page: 1, pageSize: 20 }, owner);
		expect(byMetre.layers?.[0]?.unitCostINR).toBe(312.5);
		expect(byMetre.costBreakdown).toBeNull();
		const plain = await setup().service.detail('var_1', { page: 1, pageSize: 20 }, staff);
		expect([plain.layers, plain.costBreakdown]).toEqual([null, null]);
		await expect(setup().service.detail('var_x', { page: 1, pageSize: 20 }, owner)).rejects.toThrow(
			'Item not found',
		);
	});
});

describe('Adjust (i04) with numbered adjustments (D5)', () => {
	it('previews a write-off with E1’s numbers and tax, hiding the tax and value from those who can’t see cost', async () => {
		const { service } = setup();
		const preview = await service.preview(write(), owner);
		expect(preview).toMatchObject({
			onHandAfter: 12,
			valueAtCostINR: 620,
			needsApproval: false,
			posting: { number: 'SA/26-27/0004', itcINR: 31, journalNumber: 'JV/26-27/000013' },
		});
		const hidden = await service.preview(write(), staff);
		expect(hidden).toMatchObject({
			valueAtCostINR: null,
			costBreakdown: null,
			needsApproval: true,
			posting: { itcINR: null },
		});
		const kept = await service.preview(write({ outcome: 'keptDamaged' }), owner);
		expect(kept).toMatchObject({ onHandAfter: 14, heldAfter: 2, posting: null });
		expect(
			(await service.preview(write({ action: 'add', reasonCode: 'manual_recount_correction' }), owner)).posting,
		).toMatchObject({
			number: 'SA/26-27/0004',
		});
		expect((await setup({ books: false }).service.preview(write(), owner)).posting).toBeNull();
	});

	it('previews holds and releases, and refuses a hold on another item', async () => {
		const hold = { id: 'hold_1', variantId: 'var_1', quantity: 2, status: 'open' };
		const { service } = setup({ hold, facts: [fact({ held: 2 })] });
		expect(
			await service.preview(write({ action: 'release', holdId: 'hold_1', reasonCode: null }), owner),
		).toMatchObject({
			heldAfter: 0,
		});
		expect(await service.preview(write({ holdId: 'hold_1' }), owner)).toMatchObject({
			onHandAfter: 12,
			heldAfter: 0,
		});
		expect(
			await service.preview(write({ action: 'hold', holdReason: 'photoshoot', reasonCode: null }), owner),
		).toMatchObject({
			heldAfter: 4,
		});
		const other = setup({ hold: { ...hold, variantId: 'var_9' } });
		await expect(other.service.preview(write({ holdId: 'hold_1' }), owner)).rejects.toMatchObject({
			response: { issues: [{ code: 'hold_not_found' }] },
		});
		await expect(setup().service.preview(write({ holdId: 'gone' }), owner)).rejects.toMatchObject({
			response: { issues: [{ code: 'hold_not_found' }] },
		});
	});

	it('posts a write-off at once for an approver: SA number, journal voucher and input tax kept on it', async () => {
		const { service, saved, records, adjustmentBooks, writer } = setup();
		const result = await service.adjust(write(), owner);
		expect(result.outcome).toBe('applied');
		expect(adjustmentBooks.posted).toHaveBeenCalledWith(
			expect.objectContaining({ action: 'remove', outcome: 'writtenOff', hsnCode: '5208', valueINR: 620 }),
			'SA/26-27/0004',
			{ tx: 1 },
			'adm_1',
		);
		expect(saved[0]).toMatchObject({
			status: 'applied',
			selfApproved: true,
			number: 'SA/26-27/0004',
			journalNumber: 'JV/26-27/000013',
			itcReversedINR: 31,
			valueAtCostINR: 620,
		});
		expect(records[0]?.text).toContain('wrote off 2 × PTC-CRM-M (Damaged, ₹620 at cost)');
		expect(writer.refreshShop).toHaveBeenCalledWith(['prd_1']);
		const added = setup();
		await added.service.adjust(write({ action: 'add', reasonCode: 'other', note: 'Found in the back.' }), owner);
		expect(added.adjustmentBooks.posted).toHaveBeenCalledWith(
			expect.objectContaining({ action: 'add', outcome: null }),
			'SA/26-27/0004',
			{ tx: 1 },
			'adm_1',
		);
		expect(added.records[0]?.text).toContain('added');
		const unbooked = setup({ books: false });
		await unbooked.service.adjust(write(), owner);
		expect(unbooked.saved[0]).not.toHaveProperty('number');
	});

	it('keeps damaged pieces as a hold, never waiting, and moves and releases holds', async () => {
		const { service, writer, saved, adjustmentBooks, records } = setup();
		const kept = await service.adjust(write({ outcome: 'keptDamaged' }), staff);
		expect(kept.outcome).toBe('applied');
		expect(writer.apply).toHaveBeenCalledWith(expect.objectContaining({ action: 'hold', holdReason: 'damaged' }), {
			tx: 1,
		});
		expect(adjustmentBooks.posted).not.toHaveBeenCalled();
		expect(saved[0]).toMatchObject({ holdId: 'hold_new', action: null });
		expect(records[0]?.text).toContain('moved 2 × PTC-CRM-M to held (Damaged (returned))');
		const hold = { id: 'hold_1', variantId: 'var_1', quantity: 2, status: 'open' };
		const release = setup({ hold, facts: [fact({ held: 2 })] });
		await release.service.adjust(write({ action: 'release', holdId: 'hold_1', reasonCode: null, note: '' }), staff);
		expect(release.records[0]?.text).toContain('released 2 × PTC-CRM-M from held.');
		await release.service.adjust(
			write({
				action: 'release',
				holdId: 'hold_1',
				reasonCode: null,
				note: 'Back on sale',
				requestKey: 'key-00000002',
			}),
			staff,
		);
		expect(release.records[1]?.text).toContain('from held: "Back on sale"');
		const noReason = setup();
		await noReason.service.adjust(write({ action: 'hold', holdReason: null, reasonCode: null }), staff);
		expect(noReason.records[0]?.text).toContain('(Quality check)');
	});

	it('asks for approval when the person can’t approve, with photos and no value hidden from the log', async () => {
		const { service, saved, records, writer } = setup({ facts: [fact({ galleryAssetId: null, title: {} })] });
		const asked = await service.adjust(write({ photoAssetIds: ['ph_1', 'ph_2'] }), staff);
		expect(asked.outcome).toBe('requested');
		expect(saved[0]).toMatchObject({
			status: 'pending',
			outcome: 'writtenOff',
			imageUrl: null,
			title: 'PTC-CRM-M',
		});
		expect(records[0]?.text).toContain('2 photos.');
		expect(writer.apply).not.toHaveBeenCalled();
		const one = setup();
		await one.service.adjust(write({ photoAssetIds: ['ph_1'], reasonCode: null }), staff);
		expect(one.records[0]?.text).toContain('1 photo.');
	});

	it('returns the first result for a repeated key, and refuses what the rules or a race forbid', async () => {
		const pending = setup({ previous: { status: 'pending', variantId: null } });
		expect(await pending.service.adjust(write(), owner)).toMatchObject({ outcome: 'requested', onHandAfter: 14 });
		const done = setup({ previous: { status: 'applied', variantId: 'var_1' } });
		expect((await done.service.adjust(write(), owner)).outcome).toBe('applied');
		await expect(setup().service.adjust(write({ quantity: 99 }), owner)).rejects.toMatchObject({
			response: { issues: [{ code: 'adjustment_refused' }] },
		});
		await expect(
			setup({ applyFails: new StockMovementRefusedError('moved') as never }).service.adjust(write(), owner),
		).rejects.toMatchObject({ response: { issues: [{ code: 'stock_moved_meanwhile' }] } });
		await expect(setup({ applyFails: new Error('db down') }).service.adjust(write(), owner)).rejects.toThrow(
			'db down',
		);
	});
});

describe('held stock, the bell and seen decisions (i06)', () => {
	it('lists held pieces with who held them and whether they are overdue, searched or not', async () => {
		const items = [
			{
				id: 'h1',
				variantId: 'var_1',
				productId: 'prd_1',
				quantity: 2,
				reason: 'damaged',
				note: '',
				since: '2026-10-01',
				byId: 'adm_1',
				status: 'open',
			},
			{
				id: 'h2',
				variantId: 'var_x',
				productId: 'prd_x',
				quantity: 1,
				reason: 'photoshoot',
				note: '',
				since: '2026-11-20',
				byId: null,
				status: 'open',
			},
			{
				id: 'h3',
				variantId: 'var_1',
				productId: 'prd_1',
				quantity: 1,
				reason: 'photoshoot',
				note: '',
				since: '2026-11-20',
				byId: 'usr_x',
				status: 'open',
			},
		];
		const { service } = setup({
			holdsOpen: { items, total: 3, counts: {} },
			facts: [fact(), fact({ variantId: 'var_2', galleryAssetId: null })],
		});
		const held = await service.heldList({ q: 'petti', page: 1, pageSize: 20 } as never);
		expect(held.items.map((h) => [h.sku, h.byName, h.overdue, h.imageUrl])).toEqual([
			['PTC-CRM-M', 'Owner', true, 'https://cdn/img_1.jpg'],
			['var_x', null, false, null],
			['PTC-CRM-M', 'Someone', false, 'https://cdn/img_1.jpg'],
		]);
		expect(held.items[1]).toMatchObject({ title: '', optionsLabel: '', soldBy: 'piece' });
		expect(held.reminderDays).toBe(21);
		expect((await service.heldList({ page: 1, pageSize: 20 } as never)).total).toBe(3);
		const noTitle = setup({
			holdsOpen: { items: [items[0]], total: 1, counts: {} },
			facts: [fact({ title: {}, galleryAssetId: 'img_9' })],
		});
		expect((await noTitle.service.heldList({ page: 1, pageSize: 20 } as never)).items[0]).toMatchObject({
			title: '',
			imageUrl: null,
		});
		expect(await service.holdsOf('var_1')).toEqual([{ id: 'hold_1' }]);
	});

	it('rings the bell with what each person may see, and marks decisions seen', async () => {
		const { service } = setup({
			decisions: [{ id: 'adj_1', kind: 'adjustment', status: 'rejected', rejectReason: 'No photo' }],
			payables: [
				{
					id: 'pe_1',
					number: 'PE/1',
					supplierName: 'Bose',
					billDate: '2026-04-01',
					totals: { totalINR: 100 },
					paidINR: 0,
				},
				{
					id: 'pe_2',
					number: 'PE/2',
					supplierName: 'Bose',
					billDate: '2026-04-01',
					totals: { totalINR: 100 },
					paidINR: 100,
				},
				{
					id: 'pe_3',
					number: 'PE/3',
					supplierName: 'Bose',
					billDate: '2026-11-01',
					totals: { totalINR: 100 },
					paidINR: 0,
				},
			],
			lateOrders: [
				{ id: 'po_1', number: 'PO/1', supplierName: 'Bose', expectedBy: '2026-11-01', createdBy: 'adm_1' },
				{ id: 'po_2', number: 'PO/2', supplierName: 'Bose', expectedBy: '2026-11-01', createdBy: 'usr_9' },
			],
			holdsOpen: { items: [{ since: '2026-10-01' }, { since: '2026-11-20' }], total: 2, counts: {} },
		});
		const bell = await service.alerts(owner);
		expect(bell).toMatchObject({
			pendingApprovals: 3,
			decisions: [{ id: 'adj_1', rejectReason: 'No photo' }],
			lateOrders: [{ id: 'po_1' }],
			billsNearCreditLimit: [{ id: 'pe_1', days: 235 }],
			heldOverdue: 1,
		});
		expect(await service.alerts(undefined)).toEqual({
			pendingApprovals: 0,
			decisions: [],
			lateOrders: [],
			billsNearCreditLimit: [],
			heldOverdue: 0,
		});
		const marks = setup();
		await marks.service.markSeen(['adj_1'], owner);
		await marks.service.markSeen(['adj_1'], undefined);
	});
});

describe('the remaining words and pictures', () => {
	it('leaves out a picture with no thumbnail, an unnamed approver, an empty breakdown and a value an addition lacks', async () => {
		const unseen = setup({ facts: [fact({ galleryAssetId: 'img_9' })] });
		expect((await unseen.service.list({} as never, owner)).items[0]?.imageUrl).toBeNull();
		await unseen.service.adjust(write(), staff);
		expect(unseen.saved[0]).toMatchObject({ imageUrl: null });
		const approver = setup({ ledger: [ledgerRow({ approverUserId: 'usr_gone' })] });
		expect(
			(await approver.service.detail('var_1', { page: 1, pageSize: 20 }, owner)).history[0]?.approverName,
		).toBe('Someone');
		const bare = setup({ emptyBreakdown: true });
		expect((await bare.service.preview(write(), owner)).costBreakdown).toBeNull();
		const asked = setup();
		await asked.service.adjust(write({ action: 'add', reasonCode: 'other', note: 'Found two.' }), staff);
		expect(asked.records[0]?.text).toContain('asked to add 2 × PTC-CRM-M (Other)');
	});
});
