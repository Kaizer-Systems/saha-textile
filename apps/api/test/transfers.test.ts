import { Reflector } from '@nestjs/core';
import type { StockTransfer } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { PERMISSIONS_KEY } from '../src/auth/session.guard';
import { TransfersController } from '../src/transfers/transfers.controller';
import { TransfersModule } from '../src/transfers/transfers.module';
import { TransfersService } from '../src/transfers/transfers.service';

/** Stock transfers between locations (accounts brief N1–N8). */

const NOW = new Date('2026-11-24T06:00:00.000Z');
const LOCATIONS = [
	{
		id: 'loc_bar',
		name: 'Barasat warehouse',
		address: '12 Jessore Rd',
		city: 'Barasat',
		pin: '700124',
		active: true,
		warehouse: true,
		shipsOnline: true,
		createdAt: '2026-01-01',
		gstRegistrationId: 'reg_wb',
	},
	{
		id: 'loc_sl',
		name: 'Salt Lake warehouse',
		active: true,
		warehouse: true,
		shipsOnline: false,
		createdAt: '2026-02-01',
		gstRegistrationId: 'reg_wb',
	},
	{
		id: 'loc_aga',
		name: 'Agartala store',
		active: true,
		warehouse: false,
		shipsOnline: false,
		createdAt: '2026-03-01',
		gstRegistrationId: 'reg_tr',
	},
	{
		id: 'loc_nogst',
		name: 'Pop-up',
		active: true,
		warehouse: false,
		shipsOnline: false,
		createdAt: '2026-03-01',
		gstRegistrationId: null,
	},
	{
		id: 'loc_old',
		name: 'Old',
		active: false,
		warehouse: true,
		shipsOnline: false,
		createdAt: '2025-01-01',
		gstRegistrationId: null,
	},
];
const FACTS: Record<string, Record<string, unknown>> = {
	v_kan: {
		variantId: 'v_kan',
		productId: 'p_kan',
		sku: 'KAN-PB',
		title: { en: 'Kanchipuram Saree' },
		optionsLabel: 'Peacock Blue',
		productType: 'variable',
		soldBy: 'piece',
		hsnCode: '5007',
	},
	v_mul: {
		variantId: 'v_mul',
		productId: 'p_mul',
		sku: 'MUL-WHT',
		title: { bn: 'মলমল' },
		optionsLabel: '',
		productType: 'simple',
		soldBy: 'metre',
		hsnCode: null,
	},
	v_odd: {
		variantId: 'v_odd',
		productId: 'p_odd',
		sku: 'ODD',
		title: {},
		optionsLabel: '',
		productType: 'simple',
		soldBy: 'piece',
		hsnCode: '9503',
	},
	v_set: {
		variantId: 'v_set',
		productId: 'p_set',
		sku: 'SET',
		title: { en: 'Set' },
		productType: 'bundle',
		soldBy: 'piece',
	},
};

function setup(
	options: {
		scope?: { all: boolean; ids: string[]; current?: string | null };
		threshold?: number;
		permissions?: string[];
	} = {},
) {
	const store = new Map<string, StockTransfer>();
	const moves: Record<string, unknown>[] = [];
	const consumed: [string, number][] = [];
	const created: Record<string, unknown>[] = [];
	const holds: Record<string, unknown>[] = [];
	const posted: {
		lines: { ledger: { role: string }; locationId: string; debitPaise?: number; creditPaise?: number }[];
	}[] = [];
	const issued: [string, string | undefined][] = [];
	const audit: string[] = [];
	const printed: [string, unknown][] = [];
	const free: Record<string, Record<string, number>> = {
		v_kan: { loc_bar: 5 },
		v_mul: { loc_bar: 200 },
		v_odd: { loc_bar: 1 },
	};
	const layers: Record<string, unknown[]> = {
		v_kan: [
			{
				id: 'L1',
				quantityRemaining: 1,
				unitCostINR: 4_000,
				receivedAt: '2026-09-01T00:00:00.000Z',
				locationId: null,
			},
			{
				id: 'L2',
				quantityRemaining: 5,
				unitCostINR: 4_200,
				receivedAt: '2026-10-01T00:00:00.000Z',
				locationId: 'loc_bar',
			},
			{
				id: 'L3',
				quantityRemaining: 5,
				unitCostINR: 9_999,
				receivedAt: '2026-08-01T00:00:00.000Z',
				locationId: 'loc_sl',
			},
		],
		v_mul: [
			{
				id: 'M1',
				quantityRemaining: 200,
				unitCostINR: 12,
				receivedAt: '2026-09-01T00:00:00.000Z',
				locationId: 'loc_bar',
			},
		],
		v_odd: [],
	};
	const scope = { current: null, ...(options.scope ?? { all: true, ids: [] }) };
	const service = new TransfersService(
		{
			insert: async (t: StockTransfer) => void store.set(t.id, t),
			get: async (id: string) => store.get(id) ?? null,
			save: async (t: StockTransfer, v: number) => {
				if (store.get(t.id)?.version !== v) throw new Error('transfer_changed');
				const next = { ...t, version: v + 1 };
				store.set(t.id, next);
				return next;
			},
			list: vi.fn(async () => ({ items: [...store.values()], total: store.size, counts: { all: store.size } })),
			inTransit: async (ids: string[]) => (ids.includes('v_kan') ? { v_kan: 2 } : {}),
		} as never,
		{
			move: vi.fn(async (input: Record<string, unknown>) => void moves.push(input)),
			locationStock: async (ids: string[]) =>
				ids.flatMap((variantId) =>
					Object.entries(free[variantId] ?? {}).map(([locationId, onHand]) => ({
						variantId,
						locationId,
						onHand: onHand + 1,
						held: 1,
						reserved: 0,
					})),
				),
			consumeLayer: async (id: string, q: number) => void consumed.push([id, q]),
		} as never,
		{
			listOpenLayers: async (variantId: string) => layers[variantId] ?? [],
			createLayer: async (layer: Record<string, unknown>) => (created.push(layer), layer),
		} as never,
		{
			items: async (ids: string[]) => new Map(ids.flatMap((id) => (FACTS[id] ? [[id, FACTS[id]]] : []))),
			list: vi.fn(async () => ({ items: [FACTS['v_kan'], FACTS['v_mul'], FACTS['v_odd']], total: 3 })),
		} as never,
		{ save: async (hold: Record<string, unknown>) => void holds.push(hold) } as never,
		{ list: async () => LOCATIONS } as never,
		{
			getRegistration: async (id: string) =>
				({
					reg_wb: { id: 'reg_wb', gstin: '19DBYPS6736R1ZZ' },
					reg_tr: { id: 'reg_tr', gstin: '16AAAAA0000A1Z5' },
				})[id] ?? null,
		} as never,
		{
			findById: async (id: string) => (id === 'ord_1' ? { id: 'ord_1', orderNumber: 'ST-2611-482206' } : null),
		} as never,
		{ append: async (entry: { action: string }) => void audit.push(entry.action) } as never,
		{ withTransaction: (work: (context: object) => Promise<unknown>) => work({}) } as never,
		{ get: async () => ({ eWayBillThresholdINR: options.threshold ?? 50_000 }) } as never,
		{
			seller: async () => ({ name: 'K.R. Marketing', lines: [] }),
			renderActive: vi.fn(
				async (doc: string, data: unknown) => (printed.push([doc, data]), new Uint8Array([37])),
			),
		} as never,
		{ scope: async () => scope } as never,
		{
			issue: async (type: string, _c: unknown, _at: unknown, scopeId?: string) => {
				issued.push([type, scopeId]);
				const prefix = { stockTransfer: 'TR', deliveryChallan: 'DC', taxInvoice: 'TI' }[type] as string;
				return `${prefix}/26-27/${String(issued.length).padStart(6, '0')}`;
			},
		} as never,
		{
			post: async (request: (typeof posted)[number]) => (posted.push(request), { id: `jv_${posted.length}` }),
		} as never,
	);
	const principal = { userId: 'adm_meera', permissions: options.permissions ?? ['transfer.manage'] } as never;
	return { service, store, moves, consumed, created, holds, posted, issued, audit, principal, layers, printed };
}

const ask = (patch: Record<string, unknown> = {}) =>
	({
		fromLocationId: 'loc_bar',
		toLocationId: 'loc_sl',
		lines: [{ variantId: 'v_kan', quantity: 2 }],
		neededBy: '2026-11-25',
		forOrderId: null,
		note: 'Customer in Siliguri',
		...patch,
	}) as never;
const pack = (t: StockTransfer, patch: Record<string, unknown> = {}) =>
	({
		lines: t.lines.map((l) => ({ lineId: l.lineId, packed: l.quantity })),
		sealNumber: 'S-55120',
		boxes: 2,
		photoAssetIds: ['ast_box'],
		vehicle: 'WB 02 AB 1234',
		ewayBillNumber: '',
		version: t.version,
		dispatch: true,
		...patch,
	}) as never;

/** Request and approve a transfer; returns it ready to pack. */
async function packing(s: ReturnType<typeof setup>, write = ask()) {
	const t = await s.service.request(write, s.principal, NOW);
	return s.service.decide(t.id, { approve: true, reason: '', version: 0 }, s.principal, NOW);
}

describe('asking for stock (N2)', () => {
	it('numbers the request with its items as they are now, for an order or for the location', async () => {
		const s = setup();
		const t = await s.service.request(
			ask({
				forOrderId: 'ord_1',
				lines: [
					{ variantId: 'v_kan', quantity: 2 },
					{ variantId: 'v_mul', quantity: 25 },
					{ variantId: 'v_odd', quantity: 1 },
				],
			}),
			s.principal,
			NOW,
		);
		expect(t).toMatchObject({
			number: 'TR/26-27/000001',
			status: 'requested',
			forOrderNumber: 'ST-2611-482206',
			requestedBy: 'adm_meera',
		});
		expect(t.lines.map((l) => [l.title, l.hsn, l.soldBy])).toEqual([
			['Kanchipuram Saree · Peacock Blue', '5007', 'piece'],
			['মলমল', null, 'metre'],
			['ODD', '9503', 'piece'],
		]);
		expect(s.audit).toEqual(['transfer.request']);
		expect((await s.service.request(ask(), undefined, NOW)).forOrderId).toBeNull();
	});

	it('refuses another location’s request, the same place twice, a closed location, a set, an unknown item or order', async () => {
		const s = setup({ scope: { all: false, ids: ['loc_bar'] } });
		await expect(s.service.request(ask(), s.principal, NOW)).rejects.toThrow('location_out_of_scope');
		const all = setup();
		await expect(all.service.request(ask({ toLocationId: 'loc_bar' }), all.principal, NOW)).rejects.toThrow(
			'transfer_same_location',
		);
		await expect(all.service.request(ask({ fromLocationId: 'loc_old' }), all.principal, NOW)).rejects.toThrow(
			'location_unknown',
		);
		await expect(all.service.request(ask({ toLocationId: 'loc_none' }), all.principal, NOW)).rejects.toThrow(
			'location_unknown',
		);
		await expect(
			all.service.request(ask({ lines: [{ variantId: 'v_set', quantity: 1 }] }), all.principal, NOW),
		).rejects.toThrow('transfer_item_unknown');
		await expect(
			all.service.request(ask({ lines: [{ variantId: 'v_none', quantity: 1 }] }), all.principal, NOW),
		).rejects.toThrow('transfer_item_unknown');
		await expect(all.service.request(ask({ forOrderId: 'ord_none' }), all.principal, NOW)).rejects.toThrow(
			'transfer_order_unknown',
		);
	});
});

describe('the sender’s decision', () => {
	it('keeps the pieces for an approved transfer, and rejects only with a reason', async () => {
		const s = setup();
		const approved = await packing(s);
		expect(approved.status).toBe('packing');
		expect(s.moves[0]).toMatchObject({
			variantId: 'v_kan',
			reservedDelta: 2,
			locationId: 'loc_bar',
			reasonCode: 'transfer_kept',
		});
		const other = await s.service.request(ask(), s.principal, NOW);
		await expect(
			s.service.decide(other.id, { approve: false, reason: 'no', version: 0 }, s.principal, NOW),
		).rejects.toThrow('transfer_reason_needed');
		const rejected = await s.service.decide(
			other.id,
			{ approve: false, reason: 'Needed here for Puja', version: 0 },
			s.principal,
			NOW,
		);
		expect([rejected.status, rejected.rejectReason]).toEqual(['rejected', 'Needed here for Puja']);
		await expect(
			s.service.decide(other.id, { approve: true, reason: '', version: 1 }, s.principal, NOW),
		).rejects.toThrow('transfer_not_waiting');
		await expect(
			s.service.decide('tr_none', { approve: true, reason: '', version: 0 }, s.principal, NOW),
		).rejects.toThrow('transfer_not_found');
	});

	it('refuses more than is free at the sender, a location with none of it, or a sender out of reach', async () => {
		const s = setup();
		const many = await s.service.request(ask({ lines: [{ variantId: 'v_kan', quantity: 6 }] }), s.principal, NOW);
		await expect(
			s.service.decide(many.id, { approve: true, reason: '', version: 0 }, s.principal, NOW),
		).rejects.toThrow('transfer_not_enough_stock:KAN-PB');
		const elsewhere = await s.service.request(
			ask({ fromLocationId: 'loc_aga', toLocationId: 'loc_bar' }),
			s.principal,
			NOW,
		);
		await expect(
			s.service.decide(elsewhere.id, { approve: true, reason: '', version: 0 }, s.principal, NOW),
		).rejects.toThrow('transfer_not_enough_stock');
		const scoped = setup({ scope: { all: false, ids: ['loc_sl'] } });
		const mine = await scoped.service.request(ask(), scoped.principal, NOW);
		await expect(
			scoped.service.decide(mine.id, { approve: true, reason: '', version: 0 }, scoped.principal, NOW),
		).rejects.toThrow('location_out_of_scope');
	});

	it('cancels before it leaves, letting go of what was kept; never after, nor out of reach', async () => {
		const s = setup();
		const asked = await s.service.request(ask(), s.principal, NOW);
		expect(
			(await s.service.cancel(asked.id, { reason: 'Found it here', version: 0 }, s.principal, NOW)).status,
		).toBe('cancelled');
		expect(s.moves).toHaveLength(0);
		const kept = await packing(s);
		await s.service.cancel(kept.id, { reason: 'Order cancelled', version: 1 }, s.principal, NOW);
		expect(s.moves.at(-1)).toMatchObject({ reservedDelta: -2, reasonCode: 'transfer_released' });
		await expect(s.service.cancel(kept.id, { reason: 'again', version: 2 }, s.principal, NOW)).rejects.toThrow(
			'transfer_already_left',
		);
		const far = setup({ scope: { all: false, ids: ['loc_aga'] } });
		far.store.set('t', { ...kept, version: 0 });
		await expect(far.service.cancel('t', { reason: 'nope', version: 0 }, far.principal, NOW)).rejects.toThrow(
			'location_out_of_scope',
		);
	});
});

describe('packing and dispatch (N5)', () => {
	it('saves the checklist as packed so far without moving anything', async () => {
		const s = setup();
		const t = await packing(s);
		const saved = await s.service.pack(
			t.id,
			pack(t, { dispatch: false, lines: [{ lineId: t.lines[0]!.lineId, packed: 9 }], ewayBillNumber: '' }),
			s.principal,
			NOW,
		);
		expect([saved.lines[0]!.packed, saved.ewayBillNumber, saved.status]).toEqual([2, null, 'packing']);
		const untouched = await s.service.pack(t.id, pack(saved, { dispatch: false, lines: [] }), s.principal, NOW);
		expect(untouched.lines[0]!.packed).toBe(2);
		expect(s.audit.slice(-2)).toEqual(['transfer.pack', 'transfer.pack']);
	});

	it('dispatches within one GSTIN: layers leave oldest first at the sender, a delivery challan, transit in the books', async () => {
		const s = setup();
		const t = await packing(s);
		const sent = await s.service.pack(t.id, pack(t), s.principal, NOW);
		expect(sent).toMatchObject({
			status: 'in_transit',
			challanNumber: 'DC/26-27/000002',
			crossGstin: false,
			valueINR: 8_200,
		});
		// The layer from before locations counts as the default location's (Barasat); Salt Lake's own is left alone.
		expect(s.consumed).toEqual([
			['L1', 1],
			['L2', 1],
		]);
		expect(sent.lines[0]!.drawn.map((d) => d.layerId)).toEqual(['L1', 'L2']);
		expect(s.moves.at(-1)).toMatchObject({
			quantityDelta: -2,
			reservedDelta: -2,
			reasonCode: 'transfer_out',
			locationId: 'loc_bar',
		});
		expect(s.posted[0]!.lines).toEqual([
			{ ledger: { role: 'stock_in_transit' }, locationId: 'loc_bar', debitPaise: 820_000 },
			{ ledger: { role: 'stock_in_hand' }, locationId: 'loc_bar', creditPaise: 820_000 },
		]);
		expect(s.issued.at(-1)).toEqual(['deliveryChallan', 'reg_wb']);
	});

	it('names what keeps Dispatch off, wants the e-way bill above the threshold, and refuses pieces with no cost', async () => {
		const s = setup({ threshold: 5_000 });
		const t = await packing(s);
		await expect(
			s.service.pack(
				t.id,
				pack(t, { sealNumber: '', lines: [{ lineId: t.lines[0]!.lineId, packed: 1 }] }),
				s.principal,
				NOW,
			),
		).rejects.toThrow('transfer_cannot_dispatch:not_all_packed,seal_missing,eway_bill_missing');
		expect(
			(await s.service.pack(t.id, pack(t, { ewayBillNumber: '341012345678' }), s.principal, NOW)).ewayBillNumber,
		).toBe('341012345678');
		const odd = setup();
		const o = await packing(odd, ask({ lines: [{ variantId: 'v_odd', quantity: 1 }] }));
		await expect(odd.service.pack(o.id, pack(o), odd.principal, NOW)).rejects.toThrow('cost_layers_missing:ODD');
		await expect(odd.service.pack(o.id, pack(o, { version: 0 }), odd.principal, NOW)).rejects.toThrow();
		const scoped = setup({ scope: { all: false, ids: ['loc_sl'] } });
		scoped.store.set('t', { ...o, version: 0 });
		await expect(scoped.service.pack('t', pack(o, { version: 0 }), scoped.principal, NOW)).rejects.toThrow(
			'location_out_of_scope',
		);
		await s.service.request(ask(), s.principal, NOW);
		const asked = [...s.store.values()].find((x) => x.status === 'requested') as StockTransfer;
		await expect(s.service.pack(asked.id, pack(asked), s.principal, NOW)).rejects.toThrow('transfer_not_packing');
	});

	it('to another GSTIN supplies at cost with IGST on a branch invoice from the sender’s series (N8)', async () => {
		const s = setup();
		const t = await packing(s, ask({ toLocationId: 'loc_aga' }));
		const sent = await s.service.pack(t.id, pack(t), s.principal, NOW);
		expect(sent.crossGstin).toBe(true);
		expect(sent.challanNumber).toBeNull();
		expect(sent.branchInvoice).toMatchObject({
			number: 'TI/26-27/000002',
			fromGstin: '19DBYPS6736R1ZZ',
			toGstin: '16AAAAA0000A1Z5',
			taxableINR: 8_200,
			igstINR: 410,
			totalINR: 8_610,
		});
		expect(s.issued.at(-1)).toEqual(['taxInvoice', 'reg_wb']);
		expect(s.posted[0]!.lines.map((l) => l.ledger.role)).toEqual([
			'branch_account',
			'branch_transfer_sales',
			'output_igst',
			'cost_of_goods_sold',
			'stock_in_hand',
		]);
		const noHsn = setup();
		const m = await packing(noHsn, ask({ toLocationId: 'loc_aga', lines: [{ variantId: 'v_mul', quantity: 10 }] }));
		await expect(noHsn.service.pack(m.id, pack(m), noHsn.principal, NOW)).rejects.toThrow(
			'transfer_hsn_missing:MUL-WHT',
		);
		// A location with no GST registration of its own is under the business's one GSTIN.
		const plain = setup();
		const p = await packing(plain, ask({ toLocationId: 'loc_nogst' }));
		expect((await plain.service.pack(p.id, pack(p), plain.principal, NOW)).crossGstin).toBe(false);
	});
});

describe('receiving (N6)', () => {
	async function inTransit(s: ReturnType<typeof setup>, write = ask()) {
		const t = await packing(s, write);
		return s.service.pack(t.id, pack(t), s.principal, NOW);
	}

	it('puts what arrived into the receiver’s stock at the cost it left at', async () => {
		const s = setup();
		const t = await inTransit(s);
		const got = await s.service.receive(
			t.id,
			{
				lines: [{ lineId: t.lines[0]!.lineId, arrived: 2, damaged: 0, note: '' }],
				short: 'carrier_claim',
				version: t.version,
			},
			s.principal,
			NOW,
		);
		expect([got.status, got.short]).toEqual(['received', null]);
		expect(
			s.created.map((l) => [l['unitCostINR'], l['quantityReceived'], l['locationId'], l['sourceType']]),
		).toEqual([
			[4_000, 1, 'loc_sl', 'transfer'],
			[4_200, 1, 'loc_sl', 'transfer'],
		]);
		expect(s.moves.at(-1)).toMatchObject({
			quantityDelta: 2,
			heldDelta: 0,
			reasonCode: 'transfer_in',
			locationId: 'loc_sl',
			note: null,
		});
		expect(s.posted.at(-1)!.lines).toEqual([
			{ ledger: { role: 'stock_in_hand' }, locationId: 'loc_sl', debitPaise: 820_000 },
			{ ledger: { role: 'stock_in_transit' }, locationId: 'loc_bar', creditPaise: 820_000 },
		]);
	});

	it('turns a short piece into a claim or loss and holds a damaged one', async () => {
		const s = setup();
		const t = await inTransit(
			s,
			ask({
				lines: [
					{ variantId: 'v_kan', quantity: 2 },
					{ variantId: 'v_mul', quantity: 10 },
				],
			}),
		);
		const [kan, mul] = t.lines;
		const got = await s.service.receive(
			t.id,
			{
				lines: [
					{ lineId: kan!.lineId, arrived: 1, damaged: 1, note: 'stained' },
					{ lineId: mul!.lineId, arrived: 0, damaged: 0, note: '' },
				],
				short: 'transit_loss',
				version: t.version,
			},
			s.principal,
			NOW,
		);
		expect([got.status, got.short, got.lines[0]!.holdId?.startsWith('hold_'), got.lines[1]!.holdId]).toEqual([
			'received_short',
			'transit_loss',
			true,
			null,
		]);
		expect(s.holds[0]).toMatchObject({
			quantity: 1,
			reason: 'damaged',
			note: `Arrived damaged on ${t.number}: stained`,
		});
		expect(s.posted.at(-1)!.lines).toEqual([
			{ ledger: { role: 'stock_in_hand' }, locationId: 'loc_sl', debitPaise: 400_000 },
			{ ledger: { role: 'transit_loss' }, locationId: 'loc_sl', debitPaise: 432_000 },
			{ ledger: { role: 'stock_in_transit' }, locationId: 'loc_bar', creditPaise: 832_000 },
		]);
		const noNote = setup();
		const n = await inTransit(noNote);
		await noNote.service.receive(
			n.id,
			{
				lines: [{ lineId: n.lines[0]!.lineId, arrived: 2, damaged: 2, note: '' }],
				short: 'carrier_claim',
				version: n.version,
			},
			noNote.principal,
			NOW,
		);
		expect(noNote.holds[0]).toMatchObject({ note: `Arrived damaged on ${n.number}` });
	});

	it('takes the receiver’s IGST credit across GSTINs, and refuses a count that is missing or impossible', async () => {
		const s = setup();
		const t = await inTransit(s, ask({ toLocationId: 'loc_aga' }));
		await s.service.receive(
			t.id,
			{
				lines: [{ lineId: t.lines[0]!.lineId, arrived: 2, damaged: 0, note: '' }],
				short: 'carrier_claim',
				version: t.version,
			},
			s.principal,
			NOW,
		);
		expect(s.posted.at(-1)!.lines.map((l) => [l.ledger.role, l.locationId])).toEqual([
			['stock_in_hand', 'loc_aga'],
			['input_igst', 'loc_aga'],
			['branch_account', 'loc_aga'],
		]);
		const bad = setup();
		const b = await inTransit(bad);
		const line = b.lines[0]!.lineId;
		await expect(
			bad.service.receive(b.id, { lines: [], short: 'carrier_claim', version: b.version }, bad.principal, NOW),
		).rejects.toThrow('transfer_count_missing:KAN-PB');
		await expect(
			bad.service.receive(
				b.id,
				{
					lines: [{ lineId: line, arrived: 3, damaged: 0, note: '' }],
					short: 'carrier_claim',
					version: b.version,
				},
				bad.principal,
				NOW,
			),
		).rejects.toThrow('transfer_count_wrong');
		await expect(
			bad.service.receive(
				b.id,
				{
					lines: [{ lineId: line, arrived: 1, damaged: 2, note: '' }],
					short: 'carrier_claim',
					version: b.version,
				},
				bad.principal,
				NOW,
			),
		).rejects.toThrow('transfer_count_wrong');
		const asked = await bad.service.request(ask(), bad.principal, NOW);
		await expect(
			bad.service.receive(asked.id, { lines: [], short: 'carrier_claim', version: 0 }, bad.principal, NOW),
		).rejects.toThrow('transfer_not_in_transit');
		const far = setup({ scope: { all: false, ids: ['loc_bar'] } });
		far.store.set('t', { ...b, version: 0 });
		await expect(
			far.service.receive('t', { lines: [], short: 'carrier_claim', version: 0 }, far.principal, NOW),
		).rejects.toThrow('location_out_of_scope');
	});
});

describe('the lists and the page (N1, N3, N4)', () => {
	it('lists transfers in reach with names and pieces, every location for the owner', async () => {
		const s = setup({ scope: { all: false, ids: ['loc_sl'] } });
		const t = await s.service.request(
			ask({
				lines: [
					{ variantId: 'v_kan', quantity: 2 },
					{ variantId: 'v_mul', quantity: 25 },
				],
			}),
			s.principal,
			NOW,
		);
		s.store.set('ghost', { ...t, id: 'ghost', fromLocationId: 'loc_gone' });
		const list = await s.service.list(
			{ from: '2026-11-01', to: '2026-11-30', chip: 'all', search: '', page: 1, pageSize: 25 },
			s.principal,
		);
		expect(list.items.map((r) => [r.fromName, r.toName, r.pieces])).toEqual([
			['Barasat warehouse', 'Salt Lake warehouse', 3],
			['loc_gone', 'Salt Lake warehouse', 3],
		]);
		const repoList = (s.service as unknown as { repo: { list: ReturnType<typeof vi.fn> } }).repo.list;
		expect(repoList.mock.lastCall?.[0]).toMatchObject({ locationIds: ['loc_sl'] });
		const owner = setup();
		await owner.service.list(
			{ from: '2026-11-01', to: '2026-11-30', chip: 'all', search: '', page: 1, pageSize: 25 },
			owner.principal,
		);
		expect(
			(owner.service as unknown as { repo: { list: ReturnType<typeof vi.fn> } }).repo.list.mock.lastCall?.[0],
		).toMatchObject({ locationIds: null });
	});

	it('shows a transfer with what this person may do now, and what it would cost to send', async () => {
		const s = setup({ threshold: 1_00_000 });
		const t = await s.service.request(ask(), s.principal, NOW);
		expect(await s.service.view(t.id, s.principal)).toMatchObject({
			may: { decide: true, pack: false, receive: false, cancel: true },
			ewayBillFromINR: 1_00_000,
			estimatedValueINR: 8_200,
		});
		await s.service.decide(t.id, { approve: true, reason: '', version: 0 }, s.principal, NOW);
		const moving = await s.service.pack(
			t.id,
			pack((await s.service.view(t.id, s.principal)) as never),
			s.principal,
			NOW,
		);
		expect((await s.service.view(moving.id, s.principal)).may).toEqual({
			decide: false,
			pack: false,
			receive: true,
			cancel: false,
		});
		expect((await s.service.view(moving.id, s.principal)).estimatedValueINR).toBe(8_200);
		const looker = setup({ permissions: [] });
		const l = await looker.service.request(ask(), looker.principal, NOW);
		expect((await looker.service.view(l.id, looker.principal)).may).toEqual({
			decide: false,
			pack: false,
			receive: false,
			cancel: false,
		});
		expect((await looker.service.view(l.id, undefined)).may.decide).toBe(false);
		const far = setup({ scope: { all: false, ids: ['loc_aga'] } });
		far.store.set('t', t);
		await expect(far.service.view('t', far.principal)).rejects.toThrow('location_out_of_scope');
	});

	it('reads each item’s stock at every location, the chip’s location first, with what is on the way (N1)', async () => {
		const here = setup({ scope: { all: true, ids: [], current: 'loc_sl' } });
		const view = await here.service.stockByLocation(
			{ search: 'kan', chip: 'all', page: 1, pageSize: 25 },
			here.principal,
			NOW,
		);
		expect(view.here).toBe('loc_sl');
		expect(view.locations.map((l) => l.id)).toEqual(['loc_sl', 'loc_bar', 'loc_aga', 'loc_nogst']);
		expect(view.items[0]).toMatchObject({
			title: 'Kanchipuram Saree · Peacock Blue',
			byLocation: { loc_bar: { onHand: 6, free: 5 }, loc_sl: { onHand: 0, free: 0 } },
			inTransit: 2,
			total: 8,
		});
		expect(view.items.map((i) => i.title)).toEqual(['Kanchipuram Saree · Peacock Blue', 'মলমল', 'ODD']);
		const nowhere = setup({ scope: { all: true, ids: [], current: 'loc_gone' } });
		expect(
			(
				await nowhere.service.stockByLocation(
					{ search: '', chip: 'low', page: 1, pageSize: 25 },
					nowhere.principal,
				)
			).here,
		).toBeNull();
	});
});

describe('the transfer’s print (N7, N8)', () => {
	it('is a delivery challan within one GSTIN, a branch tax invoice to another, and nothing before it leaves', async () => {
		const s = setup();
		const t = await packing(
			s,
			ask({
				lines: [
					{ variantId: 'v_kan', quantity: 2 },
					{ variantId: 'v_mul', quantity: 10 },
				],
			}),
		);
		await expect(s.service.print(t.id, s.principal)).rejects.toThrow('transfer_not_dispatched');
		const sent = await s.service.pack(t.id, pack(t, { ewayBillNumber: '341012345678' }), s.principal, NOW);
		expect(await s.service.print(sent.id, s.principal)).toEqual({
			bytes: new Uint8Array([37]),
			fileName: 'DC-26-27-000002.pdf',
		});
		const [doc, data] = s.printed[0] as [
			string,
			{
				values: Record<string, string>;
				rows: { cells: Record<string, string> }[];
				parties: { consignee: { lines: string[] } };
			},
		];
		expect(doc).toBe('deliveryChallan');
		expect(data.values).toMatchObject({ transport: 'WB 02 AB 1234, seal S-55120', ewayBill: '341012345678' });
		expect(data.rows.map((r) => r.cells['hsn'])).toEqual(['5007', '']);
		expect(data.parties.consignee.lines).toEqual(['Salt Lake warehouse']);
		const bare = setup();
		const b = await packing(bare);
		const plain = await bare.service.pack(b.id, pack(b, { vehicle: '', sealNumber: 'S-1' }), bare.principal, NOW);
		await bare.service.print(plain.id, bare.principal);
		expect((bare.printed[0]![1] as { values: Record<string, string> }).values).toMatchObject({
			transport: 'seal S-1',
		});
		expect((bare.printed[0]![1] as { values: Record<string, string> }).values['ewayBill']).toBeUndefined();

		const cross = setup();
		const c = await packing(cross, ask({ toLocationId: 'loc_aga' }));
		const gone = await cross.service.pack(c.id, pack(c), cross.principal, NOW);
		expect((await cross.service.print(gone.id, cross.principal)).fileName).toBe('TI-26-27-000002.pdf');
		expect(cross.printed[0]![0]).toBe('taxInvoice');
		const far = setup({ scope: { all: false, ids: ['loc_nogst'] } });
		far.store.set('t', gone);
		await expect(far.service.print('t', far.principal)).rejects.toThrow('location_out_of_scope');
	});
});

describe('transfer routes', () => {
	it('read behind transfer.index, ask behind transfer.create, act behind transfer.manage, wired into the API', async () => {
		const svc = Object.fromEntries(
			['stockByLocation', 'list', 'view', 'request', 'decide', 'pack', 'receive', 'cancel'].map((m) => [
				m,
				vi.fn(async () => m),
			]),
		) as Record<string, unknown>;
		svc['print'] = vi.fn(async () => ({ bytes: new Uint8Array([37]), fileName: 'DC-1.pdf' }));
		const c = new TransfersController(svc as never);
		const p = { userId: 'u' } as never;
		expect(await c.stock({} as never, p)).toBe('stockByLocation');
		expect(await c.list({} as never, p)).toBe('list');
		expect(await c.view('t', p)).toBe('view');
		expect(await c.request({} as never, p)).toBe('request');
		expect(await c.decide('t', {} as never, p)).toBe('decide');
		expect(await c.pack('t', {} as never, p)).toBe('pack');
		expect(await c.receive('t', {} as never, p)).toBe('receive');
		expect(await c.cancel('t', {} as never, p)).toBe('cancel');
		const headers: Record<string, string> = {};
		let sent: unknown = null;
		const reply = {
			header(name: string, value: string) {
				headers[name] = value;
				return this;
			},
			send: (body: unknown) => void (sent = body),
		};
		await c.print('t', reply as never, p);
		expect([headers['Content-Disposition'], sent instanceof Buffer]).toEqual(['inline; filename="DC-1.pdf"', true]);
		const perm = (m: keyof TransfersController) =>
			new Reflector().get(PERMISSIONS_KEY, TransfersController.prototype[m]);
		expect([perm('stock'), perm('list'), perm('view'), perm('print')]).toEqual(Array(4).fill(['transfer.index']));
		expect(perm('request')).toEqual(['transfer.create']);
		expect([perm('decide'), perm('pack'), perm('receive'), perm('cancel')]).toEqual(
			Array(4).fill(['transfer.manage']),
		);
		expect(Reflect.getMetadata('providers', TransfersModule)).toContain(TransfersService);
	});
});
