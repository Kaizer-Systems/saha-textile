import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { type CreditNote, type DebitNote, type OrderReturn, TaxInvoice } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { ReturnsService } from '../src/returns/returns.service';

/** Returns, credit notes and debit notes end to end, with in-memory stores (accounts brief B1–B11). */

const invoice = (patch: Record<string, unknown> = {}) =>
	TaxInvoice.parse({
		id: 'ti_1',
		number: 'TI/26-27/000145',
		date: '2026-11-18',
		gstRegistrationId: 'reg_wb',
		gstin: '19DBYPS6736R1ZZ',
		locationId: 'loc_bar',
		orderId: 'ord_1',
		orderNumber: 'ST-2611-482190',
		shipmentId: 'shp_1',
		seller: { name: 'K.R. Marketing', gstin: '19DBYPS6736R1ZZ', address: 'Barasat', stateCode: '19' },
		buyer: { name: 'Ananya Das', gstin: null, address: 'Kolkata', stateCode: '19' },
		placeOfSupply: '19',
		interState: false,
		lines: [
			{
				lineId: 'a',
				sku: 'BAN-3',
				title: 'Banarasi',
				hsn: '5007',
				quantity: 2,
				unitPriceINR: 4_680,
				ratePercent: 5,
				taxableINR: 8_914.29,
				cgstINR: 222.85,
				sgstINR: 222.86,
				totalINR: 9_360,
			},
			{
				lineId: 'b',
				sku: 'COT-1',
				title: 'Cotton',
				hsn: '5208',
				quantity: 1,
				unitPriceINR: 4_680,
				ratePercent: 5,
				taxableINR: 4_457.14,
				cgstINR: 111.43,
				sgstINR: 111.43,
				totalINR: 4_680,
			},
		],
		shippingINR: 0,
		taxableINR: 13_371.43,
		cgstINR: 334.28,
		sgstINR: 334.29,
		igstINR: 0,
		roundOffINR: 0,
		totalINR: 14_040,
		createdAt: '2026-11-18T10:00:00.000Z',
		...patch,
	});

const order = {
	id: 'ord_1',
	orderNumber: 'ST-2611-482190',
	lines: [
		{ lineId: 'a', productId: 'p_a', variationId: 'v_a', sku: 'BAN-3', unitCostINR: 3_120 },
		{ lineId: 'b', productId: 'p_b', variationId: null, sku: 'COT-1', unitCostINR: null },
		{ lineId: 'c', productId: 'p_c', variationId: null, sku: 'NOV-1', returnable: false },
	],
};

interface Options {
	noBase?: boolean;
	delivered?: string | null;
	invoices?: TaxInvoice[];
	noVariant?: boolean;
	locks?: unknown[];
	filings?: unknown[];
	windowDays?: number;
	noOrder?: boolean;
}

function setup(options: Options = {}) {
	const invoices = options.invoices ?? [invoice()];
	const returns: OrderReturn[] = [];
	const notes: CreditNote[] = [];
	const debits: DebitNote[] = [];
	const moves: { quantityDelta: number; heldDelta: number; reasonCode: string | null }[] = [];
	const consumed: string[] = [];
	const holds = new Map<string, { id: string; status: string }>();
	const posted: { date: string; source: { type: string } }[] = [];
	const audit: string[] = [];
	let n = 0;
	const service = new ReturnsService(
		{ findById: async (id: string) => (options.noOrder || id !== 'ord_1' ? null : order) } as never,
		{
			listByOrder: async () =>
				options.delivered === null
					? [{ deliveredOn: null }]
					: [{ deliveredOn: options.delivered ?? '2026-11-21' }, { deliveredOn: null }],
		} as never,
		{
			listForOrder: async () => invoices,
			get: async (id: string) => invoices.find((i) => i.id === id) ?? null,
			findByShipment: async (id: string) => invoices.find((i) => i.shipmentId === id) ?? null,
		} as never,
		{
			insert: async (r: OrderReturn) => void returns.push(r),
			get: async (id: string) => returns.find((r) => r.id === id) ?? null,
			listForOrder: async () => [...returns],
			save: async (r: OrderReturn, expected: string) => {
				const i = returns.findIndex((x) => x.id === r.id);
				if (returns[i]?.updatedAt !== expected) throw new Error('return_changed');
				returns[i] = r;
			},
		} as never,
		{
			insert: async (note: CreditNote) => void notes.push(note),
			get: async (id: string) => notes.find((x) => x.id === id) ?? null,
			listForOrder: async () => [...notes],
			listForInvoice: async (id: string) => notes.filter((x) => x.invoiceId === id),
			list: async () => ({ items: notes, total: notes.length }),
			save: async (note: CreditNote, version: number) => {
				const i = notes.findIndex((x) => x.id === note.id);
				if (notes[i]?.version !== version) throw new Error('credit_note_changed');
				const next = { ...note, version: version + 1 };
				notes[i] = next;
				return next;
			},
			deleteDraft: async (id: string) => {
				const i = notes.findIndex((x) => x.id === id && x.status === 'draft');
				if (i < 0) throw new Error('credit_note_not_draft');
				notes.splice(i, 1);
			},
		} as never,
		{
			insert: async (d: DebitNote) => void debits.push(d),
			get: async (id: string) => debits.find((d) => d.id === id) ?? null,
			listForOrder: async () => [...debits],
		} as never,
		{
			move: async (m: (typeof moves)[number]) => (moves.push(m), { ledgerId: 'l', onHandAfter: 0, heldAfter: 0 }),
			consumeLayer: async (id: string) => void consumed.push(id),
		} as never,
		{ createLayer: async (layer: { id: string }) => layer } as never,
		{
			save: async (hold: { id: string; status: string }) => void holds.set(hold.id, hold),
			findById: async (id: string) => holds.get(id) ?? null,
		} as never,
		{
			listForProduct: async () =>
				options.noVariant ? [] : [{ id: 'v_other' }, { id: 'v_base', isBaseVariant: true }],
		} as never,
		{ get: async () => (options.windowDays === undefined ? null : { windowDays: options.windowDays }) } as never,
		{ list: async () => options.locks ?? [] } as never,
		{ list: async () => options.filings ?? [] } as never,
		{ append: async (row: { action: string }) => void audit.push(row.action) } as never,
		{ withTransaction: async <T>(work: (context: never) => Promise<T>) => work({} as never) } as never,
		{
			issue: async (type: string) => `${type === 'creditNote' ? 'CN' : 'DN'}/26-27/00000${++n}`,
			childNumber: async (_kind: string, orderNumber: string, i: number) => `${orderNumber}/R${i}`,
		} as never,
		{
			post: async (request: (typeof posted)[number]) => (posted.push(request), { id: `jv_${posted.length}` }),
			isSuperAdmin: async (principal?: { userId: string }) => principal?.userId === 'adm_super',
		} as never,
	);
	return { service, returns, notes, debits, moves, consumed, holds, posted, audit, invoices };
}

const NOW = new Date('2026-11-25T05:00:00.000Z');
const startWrite = (lines: { lineId: string; quantity: number }[]) => ({
	lines,
	reason: 'damaged_on_arrival' as const,
	how: 'pickup' as const,
	refundTo: 'original_payment' as const,
	note: '',
});

/** A return asked, received and checked; then its credit note draft. */
async function checkedDraft(made: ReturnType<typeof setup>, outcome: 'restock' | 'damaged' | 'write_off' = 'restock') {
	const asked = await made.service.start('ord_1', startWrite([{ lineId: 'a', quantity: 1 }]), 'adm_1', NOW);
	await made.service.step(asked.id, { to: 'received' }, 'adm_1', NOW);
	await made.service.check(asked.id, { lines: [{ lineId: 'a', outcome, note: 'Zari pulled' }] }, 'adm_1', NOW);
	return { asked, draft: await made.service.fromReturn(asked.id, 'adm_1', NOW) };
}

describe('the order’s returns card and starting a return (B1, B2)', () => {
	it('shows what can come back, the window from delivery and the s.34 deadline', async () => {
		const view = await setup().service.view('ord_1', '2026-11-25');
		expect(view).toMatchObject({
			invoiceNumber: 'TI/26-27/000145',
			deliveredOn: '2026-11-21',
			windowEnds: '2026-11-28',
			windowOpen: true,
			deadline: '2027-11-30',
		});
		expect(view.returnable.map((r) => [r.lineId, r.bought, r.returnable])).toEqual([
			['a', 2, true],
			['b', 1, true],
		]);
		const none = await setup({ invoices: [], delivered: null, windowDays: 3 }).service.view('ord_1', '2026-11-25');
		expect(none).toMatchObject({ invoiceId: null, deadline: null, windowOpen: false, returnable: [] });
		await expect(setup({ noOrder: true }).service.view('ord_1')).rejects.toBeInstanceOf(NotFoundException);
	});

	it('starts a return within the window, numbering it R1, R2…', async () => {
		const made = setup();
		const first = await made.service.start(
			'ord_1',
			startWrite([
				{ lineId: 'a', quantity: 1 },
				{ lineId: 'b', quantity: 0 },
			]),
			'adm_1',
			NOW,
		);
		expect(first).toMatchObject({
			number: 'ST-2611-482190/R1',
			status: 'asked',
			lines: [{ lineId: 'a', quantity: 1 }],
		});
		const second = await made.service.start('ord_1', startWrite([{ lineId: 'a', quantity: 1 }]), 'adm_1', NOW);
		expect(second.number).toBe('ST-2611-482190/R2');
		expect(made.audit).toContain('returns.start');
	});

	it('refuses after the window, nothing picked, unknown or unreturnable lines, and too many pieces', async () => {
		const late = setup();
		await expect(
			late.service.start(
				'ord_1',
				startWrite([{ lineId: 'a', quantity: 1 }]),
				null,
				new Date('2026-12-01T05:00:00Z'),
			),
		).rejects.toThrow('return_window_closed');
		const made = setup({
			invoices: [invoice({ lines: [...invoice().lines, { ...invoice().lines[1]!, lineId: 'c', sku: 'NOV-1' }] })],
		});
		await expect(
			made.service.start('ord_1', startWrite([{ lineId: 'a', quantity: 0 }]), null, NOW),
		).rejects.toThrow('return_nothing_picked');
		await expect(
			made.service.start('ord_1', startWrite([{ lineId: 'zz', quantity: 1 }]), null, NOW),
		).rejects.toThrow('return_line_unknown');
		await expect(
			made.service.start('ord_1', startWrite([{ lineId: 'c', quantity: 1 }]), null, NOW),
		).rejects.toThrow('return_not_returnable:NOV-1');
		await expect(
			made.service.start('ord_1', startWrite([{ lineId: 'a', quantity: 3 }]), null, NOW),
		).rejects.toThrow('return_too_many:BAN-3');
		const split = setup({
			invoices: [
				invoice({ lines: [invoice().lines[0]!] }),
				invoice({ id: 'ti_2', shipmentId: 'shp_2', lines: [invoice().lines[1]!] }),
			],
		});
		await expect(
			split.service.start(
				'ord_1',
				startWrite([
					{ lineId: 'a', quantity: 1 },
					{ lineId: 'b', quantity: 1 },
				]),
				null,
				NOW,
			),
		).rejects.toThrow('return_line_unknown');
	});
});

describe('a return’s steps and check (B3)', () => {
	it('books a pickup then receives, or receives straight away, and checks each piece', async () => {
		const made = setup();
		const asked = await made.service.start('ord_1', startWrite([{ lineId: 'a', quantity: 1 }]), 'adm_1', NOW);
		const booked = await made.service.step(asked.id, { to: 'pickup_booked' }, 'adm_1', NOW);
		await expect(made.service.step(asked.id, { to: 'pickup_booked' }, 'adm_1', NOW)).rejects.toBeInstanceOf(
			ConflictException,
		);
		await expect(made.service.check(asked.id, { lines: [] }, 'adm_1', NOW)).rejects.toThrow('return_not_received');
		await made.service.step(booked.id, { to: 'received' }, 'adm_1', NOW);
		await expect(made.service.check(asked.id, { lines: [] }, 'adm_1', NOW)).rejects.toThrow(
			'return_check_incomplete',
		);
		const checked = await made.service.check(
			asked.id,
			{ lines: [{ lineId: 'a', outcome: 'damaged', note: '' }] },
			'adm_1',
			NOW,
		);
		expect(checked).toMatchObject({ status: 'checked', lines: [{ outcome: 'damaged' }] });
		expect(checked.timeline.map((t) => t.status)).toEqual(['asked', 'pickup_booked', 'received', 'checked']);
		const again = await made.service.check(
			asked.id,
			{ lines: [{ lineId: 'a', outcome: 'restock', note: '' }] },
			'adm_1',
			NOW,
		);
		expect(again.timeline).toHaveLength(4);
		await expect(made.service.getReturn('ret_x')).rejects.toBeInstanceOf(NotFoundException);
	});
});

describe('credit note drafts (B4, B10, B11)', () => {
	it('drafts from a checked return at the piece’s cost, once, with the delivery share', async () => {
		const made = setup();
		const { asked, draft } = await checkedDraft(made);
		expect(draft).toMatchObject({
			status: 'draft',
			kind: 'goods_returned',
			totalINR: 4_680,
			deadline: '2027-11-30',
		});
		expect(draft.lines.map((l) => [l.lineId, l.unitCostINR, l.delivery])).toEqual([
			['a', 3_120, false],
			['delivery', null, true],
		]);
		expect((await made.service.fromReturn(asked.id, 'adm_1', NOW)).id).toBe(draft.id);
		const unchecked = await made.service.start('ord_1', startWrite([{ lineId: 'b', quantity: 1 }]), 'adm_1', NOW);
		await expect(made.service.fromReturn(unchecked.id, null, NOW)).rejects.toThrow('return_not_checked');
	});

	it('drafts a price adjustment with the tax inside, refusing one that lowers nothing', async () => {
		const made = setup();
		const note = await made.service.priceAdjustment(
			'ord_1',
			{
				lines: [{ lineId: 'b', lowerByINR: 500 }],
				reason: 'Agreed after the sale',
				refundTo: 'customer_account',
			},
			'adm_1',
			NOW,
		);
		expect(note).toMatchObject({ kind: 'price_adjustment', totalINR: 500, cgstINR: 11.9 });
		expect(note.lines.some((l) => l.delivery)).toBe(false);
		await expect(
			made.service.priceAdjustment(
				'ord_1',
				{ lines: [{ lineId: 'b', lowerByINR: 0 }], reason: 'x', refundTo: 'original_payment' },
				null,
				NOW,
			),
		).rejects.toThrow('credit_note_problem:nothing_to_credit');
	});

	it('drafts the whole parcel brought back, once, and only for that order’s issued invoice', async () => {
		const made = setup();
		const note = await made.service.undelivered('ord_1', 'shp_1', 'adm_1', NOW);
		expect(note).toMatchObject({ kind: 'undelivered', shipmentId: 'shp_1', totalINR: 14_040 });
		expect(note.lines.filter((l) => !l.delivery).map((l) => [l.lineId, l.quantity, l.outcome])).toEqual([
			['a', 2, 'restock'],
			['b', 1, 'restock'],
		]);
		expect((await made.service.undelivered('ord_1', 'shp_1', 'adm_1', NOW)).id).toBe(note.id);
		await expect(made.service.undelivered('ord_2', 'shp_1', null, NOW)).rejects.toBeInstanceOf(NotFoundException);
		await expect(made.service.undelivered('ord_1', 'shp_x', null, NOW)).rejects.toBeInstanceOf(NotFoundException);
		const cancelledInvoice = setup({ invoices: [invoice({ status: 'cancelled' })] });
		await expect(cancelledInvoice.service.undelivered('ord_1', 'shp_1', null, NOW)).rejects.toBeInstanceOf(
			NotFoundException,
		);
	});

	it('saves fewer pieces or a new reason on a draft, refusing a stale version and an issued note', async () => {
		const made = setup();
		const note = await made.service.undelivered('ord_1', 'shp_1', 'adm_1', NOW);
		const saved = await made.service.saveDraft(
			note.id,
			{ version: 0, lines: [{ lineId: 'a', quantity: 1 }], reason: 'One came back' },
			'adm_1',
		);
		expect(saved).toMatchObject({ version: 1, reason: 'One came back', totalINR: 9_360 });
		await expect(made.service.saveDraft(note.id, { version: 0, lines: [] }, null)).rejects.toBeInstanceOf(
			ConflictException,
		);
		const priced = await made.service.priceAdjustment(
			'ord_1',
			{ lines: [{ lineId: 'a', lowerByINR: 100 }], reason: 'x', refundTo: 'original_payment' },
			null,
			NOW,
		);
		expect(
			(await made.service.saveDraft(priced.id, { version: 0, lines: [{ lineId: 'a', quantity: 1 }] }, null))
				.totalINR,
		).toBe(100);
		await made.service.issue(priced.id, 1, null, NOW);
		await expect(made.service.saveDraft(priced.id, { version: 2, lines: [] }, null)).rejects.toThrow(
			'credit_note_not_draft',
		);
		await expect(made.service.creditNote('cn_x')).rejects.toBeInstanceOf(NotFoundException);
		expect((await made.service.listCreditNotes({} as never)).total).toBe(2);
	});

	it('deletes a draft and frees its return for a new one', async () => {
		const made = setup();
		const { asked, draft } = await checkedDraft(made);
		await made.service.deleteDraft(draft.id, 'adm_1');
		expect(made.returns.find((r) => r.id === asked.id)?.creditNoteId).toBeNull();
		const price = await made.service.priceAdjustment(
			'ord_1',
			{ lines: [{ lineId: 'a', lowerByINR: 100 }], reason: 'x', refundTo: 'original_payment' },
			null,
			NOW,
		);
		await made.service.deleteDraft(price.id, null);
		await made.service.issue((await made.service.fromReturn(asked.id, null, NOW)).id, 0, null, NOW);
		await expect(made.service.deleteDraft(made.notes[0]!.id, null)).rejects.toBeInstanceOf(ConflictException);
	});
});

describe('issuing a credit note (B4 → B5)', () => {
	it('numbers it, puts the piece back at its cost, posts it and moves the return on, in one go', async () => {
		const made = setup();
		const { asked, draft } = await checkedDraft(made);
		const issued = await made.service.issue(draft.id, draft.version, 'adm_1', NOW);
		expect(issued).toMatchObject({
			number: 'CN/26-27/000001',
			status: 'issued',
			voucherId: 'jv_1',
			refund: { status: 'due' },
		});
		expect(issued.lines[0]).toMatchObject({ layerId: expect.stringMatching(/^lay_/), holdId: null });
		expect(made.moves).toEqual([
			expect.objectContaining({ quantityDelta: 1, heldDelta: 0, reasonCode: 'restock' }),
		]);
		expect(made.posted[0]?.source.type).toBe('creditNote');
		expect(made.returns.find((r) => r.id === asked.id)?.status).toBe('credit_note');
	});

	it('holds a damaged piece, adds nothing back for a written-off one, and keeps money on account when asked', async () => {
		const damaged = setup();
		const { draft } = await checkedDraft(damaged, 'damaged');
		const issued = await damaged.service.issue(draft.id, 0, null, NOW);
		expect(damaged.moves[0]).toMatchObject({ quantityDelta: 1, heldDelta: 1 });
		expect(damaged.holds.get(issued.lines[0]!.holdId!)).toMatchObject({ status: 'open' });
		const written = setup();
		const off = await checkedDraft(written, 'write_off');
		await written.service.issue(off.draft.id, 0, null, NOW);
		expect(written.moves).toEqual([]);
		const kept = setup();
		const price = await kept.service.priceAdjustment(
			'ord_1',
			{ lines: [{ lineId: 'a', lowerByINR: 100 }], reason: 'x', refundTo: 'customer_account' },
			null,
			NOW,
		);
		expect((await kept.service.issue(price.id, 0, null, NOW)).refund?.status).toBe('kept');
	});

	it('refuses an issued note, a stale version, a lost note, more than the invoice, and a piece with no stock record', async () => {
		const made = setup();
		const { draft } = await checkedDraft(made);
		await expect(made.service.issue('cn_x', 0, null, NOW)).rejects.toBeInstanceOf(NotFoundException);
		await expect(made.service.issue(draft.id, 5, null, NOW)).rejects.toThrow('credit_note_changed');
		await made.service.issue(draft.id, 0, null, NOW);
		await expect(made.service.issue(draft.id, 1, null, NOW)).rejects.toThrow('credit_note_not_draft');
		const discount = {
			lines: [{ lineId: 'a', lowerByINR: 9_000 }],
			reason: 'x',
			refundTo: 'original_payment' as const,
		};
		const first = await made.service.priceAdjustment('ord_1', discount, null, NOW);
		const second = await made.service.priceAdjustment('ord_1', discount, null, NOW);
		await made.service.issue(first.id, 0, null, NOW);
		await expect(made.service.issue(second.id, 0, null, NOW)).rejects.toThrow(
			'credit_note_problem:more_than_invoiced',
		);
		const lost = setup({ noVariant: true });
		const parcel = await lost.service.undelivered('ord_1', 'shp_1', null, NOW);
		await expect(lost.service.issue(parcel.id, 0, null, NOW)).rejects.toThrow('variant_missing:COT-1');
		const missing = setup({ invoices: [invoice({ lines: [{ ...invoice().lines[0]!, lineId: 'z' }] })] });
		const ghost = await missing.service.undelivered('ord_1', 'shp_1', null, NOW);
		await expect(missing.service.issue(ghost.id, 0, null, NOW)).rejects.toThrow('order_line_missing:BAN-3');
	});
});

describe('undoing an issued credit note (B8, B9)', () => {
	const superAdmin = { userId: 'adm_super' } as never;

	it('says why it may be cancelled, and refuses someone who isn’t a super admin', async () => {
		const made = setup({ filings: [{ gstRegistrationId: 'reg_wb', month: '2026-11', returnType: 'GSTR-3B' }] });
		const { draft } = await checkedDraft(made);
		await made.service.issue(draft.id, 0, null, NOW);
		expect(await made.service.cancelChecks(draft.id, superAdmin)).toMatchObject({
			monthFiled: true,
			allowed: false,
			month: '2026-11',
		});
		await expect(
			made.service.cancel(draft.id, { reason: 'Wrong invoice' }, { userId: 'adm_1' } as never, NOW),
		).rejects.toBeInstanceOf(ForbiddenException);
		await expect(made.service.cancel(draft.id, { reason: 'Wrong invoice' }, superAdmin, NOW)).rejects.toThrow(
			'credit_note_cancel_refused',
		);
		const closed = setup({ locks: [{ month: '2026-11', part: 'sales', state: 'locked' }] });
		const other = await checkedDraft(closed);
		expect((await closed.service.cancelChecks(other.draft.id, superAdmin)).booksClosed).toBe(true);
	});

	it('cancels everything it did: stock, layer, hold, the books, and the return back to Checked', async () => {
		const made = setup();
		const { asked, draft } = await checkedDraft(made, 'damaged');
		const issued = await made.service.issue(draft.id, 0, null, NOW);
		const cancelled = await made.service.cancel(
			issued.id,
			{ reason: 'Made against the wrong invoice' },
			superAdmin,
			NOW,
		);
		expect(cancelled).toMatchObject({
			status: 'cancelled',
			cancellation: { reason: 'Made against the wrong invoice' },
		});
		expect(made.moves.at(-1)).toMatchObject({ quantityDelta: -1, heldDelta: -1, reasonCode: 'undone' });
		expect(made.consumed).toEqual([issued.lines[0]!.layerId]);
		expect(made.holds.get(issued.lines[0]!.holdId!)?.status).toBe('released');
		expect(made.posted.at(-1)?.source.type).toBe('creditNoteCancel');
		expect(made.returns.find((r) => r.id === asked.id)).toMatchObject({ status: 'checked', creditNoteId: null });
		await expect(made.service.cancel(issued.id, { reason: 'Again please' }, superAdmin, NOW)).rejects.toThrow(
			'credit_note_not_cancellable',
		);
	});

	it('undoes a note with a debit note this month, pieces out again, once', async () => {
		const made = setup();
		const { draft } = await checkedDraft(made);
		const issued = await made.service.issue(draft.id, 0, null, NOW);
		const debit = await made.service.debitNote(
			issued.id,
			{ reason: 'October already filed' },
			'adm_1',
			new Date('2026-12-02T05:00:00Z'),
		);
		expect(debit).toMatchObject({
			number: 'DN/26-27/000002',
			date: '2026-12-02',
			creditNoteNumber: issued.number,
			totalINR: 4_680,
		});
		expect(made.moves.at(-1)).toMatchObject({ quantityDelta: -1, heldDelta: 0 });
		expect(made.notes.find((n) => n.id === issued.id)?.debitNoteId).toBe(debit.id);
		await expect(made.service.debitNote(issued.id, { reason: 'Twice over' }, null, NOW)).rejects.toThrow(
			'credit_note_not_undoable',
		);
		expect(await made.service.debitNoteById(debit.id)).toEqual(debit);
		await expect(made.service.debitNoteById('dn_x')).rejects.toBeInstanceOf(NotFoundException);
		const price = await made.service.priceAdjustment(
			'ord_1',
			{ lines: [{ lineId: 'b', lowerByINR: 50 }], reason: 'x', refundTo: 'original_payment' },
			null,
			NOW,
		);
		expect(
			(
				await made.service.debitNote(
					(await made.service.issue(price.id, 0, null, NOW)).id,
					{ reason: 'Undo the discount' },
					null,
					NOW,
				)
			).lines,
		).toHaveLength(1);
	});

	it('can’t take pieces out when the order line has gone', async () => {
		const made = setup();
		const { draft } = await checkedDraft(made);
		const issued = await made.service.issue(draft.id, 0, null, NOW);
		Object.assign(
			made.notes.find((n) => n.id === issued.id)!,
			{ lines: issued.lines.map((l) => ({ ...l, lineId: l.delivery ? l.lineId : 'gone' })) },
		);
		await expect(made.service.debitNote(issued.id, { reason: 'Undo the return' }, null, NOW)).rejects.toThrow(
			'order_line_missing',
		);
	});

	it('cancels a price adjustment with no return, and one whose return was removed, and an old note with no layer or hold', async () => {
		const made = setup();
		const price = await made.service.priceAdjustment(
			'ord_1',
			{ lines: [{ lineId: 'a', lowerByINR: 100 }], reason: 'x', refundTo: 'original_payment' },
			null,
			NOW,
		);
		await made.service.issue(price.id, 0, null, NOW);
		expect((await made.service.cancel(price.id, { reason: 'Not agreed after all' }, superAdmin, NOW)).status).toBe(
			'cancelled',
		);
		const { asked, draft } = await checkedDraft(made, 'damaged');
		const issued = await made.service.issue(draft.id, 0, null, NOW);
		made.returns.splice(
			made.returns.findIndex((r) => r.id === asked.id),
			1,
		);
		Object.assign(
			made.notes.find((n) => n.id === issued.id)!,
			{ lines: issued.lines.map((l) => ({ ...l, layerId: null, holdId: null })) },
		);
		const before = made.consumed.length;
		expect((await made.service.cancel(issued.id, { reason: 'Return withdrawn' }, superAdmin, NOW)).status).toBe(
			'cancelled',
		);
		expect(made.consumed).toHaveLength(before);
	});
});

describe('the parcel brought back and other edges', () => {
	it('puts back pieces with no option and no cost on the base variant (or the first) at nothing', async () => {
		for (const options of [{}, { noBase: true }]) {
			const made = setup(options);
			const parcel = await made.service.undelivered('ord_1', 'shp_1', null, NOW);
			const issued = await made.service.issue(parcel.id, 0, null, NOW);
			expect(issued.lines.filter((l) => !l.delivery).map((l) => l.outcome)).toEqual(['restock', 'restock']);
			expect(made.moves).toHaveLength(2);
		}
	});

	it('issues even when its return was removed, and refuses a return whose invoice is gone', async () => {
		const made = setup();
		const { asked, draft } = await checkedDraft(made);
		made.returns.splice(
			made.returns.findIndex((r) => r.id === asked.id),
			1,
		);
		expect((await made.service.issue(draft.id, 0, null, NOW)).status).toBe('issued');
		const gone = setup();
		const entry = await gone.service.start('ord_1', startWrite([{ lineId: 'b', quantity: 1 }]), null, NOW);
		await gone.service.step(entry.id, { to: 'received' }, null, NOW);
		await gone.service.check(entry.id, { lines: [{ lineId: 'b', outcome: 'restock', note: '' }] }, null, NOW);
		gone.invoices.splice(0, 1);
		await expect(gone.service.fromReturn(entry.id, null, NOW)).rejects.toThrow('invoice_not_found');
	});

	it('drafts a returned line the order no longer has at no cost', async () => {
		const made = setup({ invoices: [invoice({ lines: [{ ...invoice().lines[0]!, lineId: 'z' }] })] });
		const entry = await made.service.start('ord_1', startWrite([{ lineId: 'z', quantity: 1 }]), null, NOW);
		await made.service.step(entry.id, { to: 'received' }, null, NOW);
		await made.service.check(entry.id, { lines: [{ lineId: 'z', outcome: 'write_off', note: '' }] }, null, NOW);
		expect((await made.service.fromReturn(entry.id, null, NOW)).lines[0]?.unitCostINR).toBeNull();
	});
});
