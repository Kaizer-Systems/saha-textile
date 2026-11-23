import { gstinCheckCharacter } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { SuppliersService } from '../src/purchasing/suppliers.service';

/** Suppliers (s01–s03), with self-invoices on the statement (accounts brief D). Fakes for every store. */

const gstin = (body: string) => `${body}${gstinCheckCharacter(body)}`;
const BOSE = gstin('19AAAPB1234C1Z');
const SAME_PAN = gstin('10AAAPB1234C1Z');
const supplier = (id: string, patch: Record<string, unknown> = {}) => ({
	id,
	legalName: `Supplier ${id}`,
	shortName: '',
	kind: 'regular',
	gstin: null,
	pan: null,
	stateCode: '19',
	stateName: 'West Bengal',
	address: { line: 'Road', city: 'Kolkata', pin: '700001' },
	contactName: null,
	phone: null,
	email: null,
	paymentTermsDays: 30,
	usesItemCodes: false,
	notes: null,
	active: true,
	taxType: 'intra_state',
	createdAt: '2026-04-01T00:00:00.000Z',
	updatedAt: '2026-04-01T00:00:00.000Z',
	...patch,
});
const entry = (id: string, patch: Record<string, unknown> = {}) => ({
	id,
	supplierId: 'sup_a',
	status: 'posted',
	billDate: '2026-11-01',
	dueOn: '2026-12-01',
	totals: { totalINR: 1_000 },
	paidINR: 0,
	paymentStatus: 'unpaid',
	number: `PE/${id}`,
	billNumber: `B-${id}`,
	...patch,
});
const write = (patch: Record<string, unknown> = {}) =>
	({
		legalName: 'Bose Properties',
		shortName: '',
		kind: 'regular',
		gstin: BOSE,
		pan: null,
		stateCode: '19',
		address: { line: 'Road', city: 'Barasat', pin: '700124' },
		contactName: null,
		phone: null,
		email: null,
		paymentTermsDays: 30,
		usesItemCodes: false,
		notes: null,
		active: true,
		...patch,
	}) as never;

function setup(options: { hasDocuments?: boolean } = {}) {
	const saved: unknown[] = [];
	const records: { action: string; text: string }[] = [];
	const repo = {
		list: vi.fn(async () => ({ items: [supplier('sup_a'), supplier('sup_b'), supplier('sup_c')], total: 3 })),
		countActive: async () => ({ all: 2, inactive: 0 }),
		findById: async (id: string) => (id === 'sup_none' ? null : supplier(id)),
		findByGstin: async (value: string) => (value === BOSE ? supplier('sup_bose', { gstin: BOSE }) : null),
		findByPan: async () => [
			supplier('sup_bose', { gstin: BOSE }),
			supplier('sup_bihar', { gstin: SAME_PAN }),
			supplier('sup_nogst', { gstin: null }),
			supplier('sup_self', { gstin: SAME_PAN }),
		],
		save: vi.fn(async (s: unknown) => void saved.push(s)),
		hasDocuments: async () => options.hasDocuments ?? false,
		softDelete: vi.fn(async () => undefined),
	};
	const entries = {
		openPayables: async () => [
			entry('e1'),
			entry('e2', { paidINR: 400 }),
			entry('e3', { supplierId: 'sup_b', paidINR: 1_000 }),
		],
		forSupplier: async (id: string) =>
			id === 'sup_a'
				? [
						entry('e1', { billDate: '2026-11-05', dueOn: '2026-12-05' }),
						entry('e2', { billDate: '2026-10-01', dueOn: '2026-10-31', paidINR: 400 }),
						entry('e4', { billDate: '2026-03-01', dueOn: '2026-04-01', paidINR: 1_000 }),
						entry('e6', { billDate: '2026-11-10', dueOn: '2026-12-10' }),
						entry('e5', { status: 'draft' }),
					]
				: [],
	};
	const returns = {
		forSupplier: async () => [
			{
				status: 'sent',
				sentAt: '2026-11-10T00:00:00.000Z',
				totalINR: 50,
				settlements: [],
				number: 'DN/1',
				id: 'r1',
			},
			{
				status: 'sent',
				sentAt: '2026-01-10T00:00:00.000Z',
				totalINR: 5,
				settlements: [],
				number: 'DN/0',
				id: 'r0',
			},
			{ status: 'draft', sentAt: null, totalINR: 9, settlements: [], number: null, id: 'r2' },
		],
	};
	const support = {
		today: () => '2026-11-24',
		homeState: async () => '19',
		nameOf: async (actor: string | null) => actor ?? 'System',
		record: vi.fn(async (r: { action: string; text: string }) => void records.push(r)),
		activity: vi.fn(async () => ['rows']),
	};
	const selfInvoices = {
		forSupplier: async () => [
			{
				status: 'issued',
				taxableINR: 60_000,
				paidINR: 10_000,
				number: 'SI/1',
				date: '2026-11-21',
				id: 'si_1',
				rule: { name: 'Rent' },
				cancelledAt: null,
			},
			{
				status: 'draft',
				taxableINR: 5,
				paidINR: 0,
				number: null,
				date: null,
				id: 'si_2',
				rule: { name: 'Rent' },
				cancelledAt: null,
			},
			{
				status: 'issued',
				taxableINR: 100,
				paidINR: 200,
				number: 'SI/2',
				date: '2026-11-22',
				id: 'si_3',
				rule: { name: 'Rent' },
				cancelledAt: null,
			},
		],
	};
	const vouchers = { forSupplier: async () => [] };
	const itemCodes = { remember: vi.fn(async () => undefined) };
	const service = new SuppliersService(
		repo as never,
		itemCodes as never,
		entries as never,
		{ forSupplier: async () => [] } as never,
		returns as never,
		support as never,
		selfInvoices as never,
		vouchers as never,
	);
	return { service, repo, saved, records, support, itemCodes };
}

describe('suppliers', () => {
	it('lists suppliers with what each is owed, how many bills and the last one', async () => {
		const { service } = setup();
		const page = await service.list({ filter: 'all', page: 1, pageSize: 25 } as never);
		expect(page.items.map((s) => [s.id, s.owedINR, s.purchaseCount, s.lastPurchaseOn])).toEqual([
			['sup_a', 1_600, 4, '2026-11-10'],
			['sup_b', 0, 0, null],
			['sup_c', 0, 0, null],
		]);
		expect(page.counts).toEqual({ all: 2, owed: 1, inactive: 0 });
	});

	it('sums the supplier page, with unpaid self-invoices owed and on the statement', async () => {
		const { service } = setup();
		const summary = await service.summary('sup_a');
		expect(summary).toMatchObject({
			owedINR: 2_600 + 50_000,
			owedBills: 3,
			nextDueOn: '2026-10-31',
			boughtThisYearINR: 3_000,
			entriesThisYear: 3,
			returnedThisYearINR: 50,
			debitNotesThisYear: 1,
			oldestUnpaidDays: 54,
		});
		expect(summary.statement.filter((r) => r.kind === 'self_invoice').map((r) => r.documentNumber)).toEqual([
			'SI/1',
			'SI/2',
		]);
		const none = await setup().service.summary('sup_b');
		expect([none.oldestUnpaidDays, none.nextDueOn]).toEqual([null, null]);
		await expect(service.get('sup_none')).rejects.toThrow();
	});

	it('checks a GSTIN: its shape, State, PAN, and other suppliers with the same GSTIN or PAN', async () => {
		const { service } = setup();
		expect(await service.checkGstin('19AAAPB1234C1Z0', null)).toMatchObject({
			problem: expect.any(String),
			stateCode: null,
		});
		expect((await service.checkGstin('NOT A GSTIN', null)).expectedLastCharacter).toBeNull();
		const taken = await service.checkGstin(` ${BOSE.toLowerCase()} `, null);
		expect(taken).toMatchObject({
			problem: null,
			stateCode: '19',
			pan: 'AAAPB1234C',
			taxType: 'intra_state',
			sameGstin: { id: 'sup_bose', name: 'Supplier sup_bose' },
		});
		expect(taken.samePan.map((s) => s.id)).toEqual(['sup_bihar', 'sup_self']);
		const mine = await service.checkGstin(BOSE, 'sup_bose');
		expect(mine.sameGstin).toBeNull();
		expect((await service.checkGstin(SAME_PAN, 'sup_self')).samePan.map((s) => s.id)).toEqual(['sup_bose']);
	});

	it('adds and changes suppliers, refusing a GSTIN another supplier has', async () => {
		const { service, saved, records } = setup();
		await expect(service.create(write(), 'u1')).rejects.toMatchObject({ response: { message: 'gstin_taken' } });
		const added = await service.create(write({ gstin: SAME_PAN, stateCode: '10' }), 'u1');
		expect(added).toMatchObject({ stateCode: '10', pan: 'AAAPB1234C', taxType: 'inter_state', stateName: 'Bihar' });
		const unregistered = await service.create(
			write({ kind: 'unregistered', gstin: null, pan: 'AAAPB1234C', stateCode: '99' }),
			null,
		);
		expect(unregistered).toMatchObject({ gstin: null, pan: 'AAAPB1234C', stateName: '99' });
		expect(records.map((r) => r.text)).toEqual([
			expect.stringContaining(`(GSTIN ${SAME_PAN}, Bihar)`),
			expect.stringContaining('(unregistered)'),
		]);
		const changed = await service.update('sup_bose', write({ paymentTermsDays: 45 }), 'u1');
		expect(changed.createdAt).toBe('2026-04-01T00:00:00.000Z');
		expect(records.at(-1)?.text).toContain('paymentTermsDays 30 → 45');
		await service.update(
			'sup_x',
			write({
				gstin: null,
				kind: 'unregistered',
				legalName: 'Supplier sup_x',
				stateCode: '19',
				paymentTermsDays: 30,
			}),
			'u1',
		);
		expect(records.at(-1)?.text).toContain('kind regular → unregistered');
		await service.update('sup_y', write({ gstin: null, kind: 'regular', legalName: 'Supplier sup_y' }), 'u1');
		expect(records.at(-1)?.text).toMatch(/changed supplier Supplier sup_y\.$/);
		expect(saved).toHaveLength(5);
		const unknownState = await service.create(write({ gstin: gstin('00AAAPB1234C1Z'), stateCode: '00' }), 'u1');
		expect(unknownState.stateName).toBe('00');
		expect(records.at(-1)?.text).toContain(', 00)');
	});

	it('deletes only a supplier with no documents, and shows its activity and remembers its item codes', async () => {
		const blocked = setup({ hasDocuments: true });
		await expect(blocked.service.remove('sup_a', 'u1')).rejects.toMatchObject({
			response: { message: 'supplier_has_documents' },
		});
		const { service, repo, support, itemCodes } = setup();
		await service.remove('sup_a', 'u1');
		expect(repo.softDelete).toHaveBeenCalledWith('sup_a', 'u1', expect.any(String));
		expect(await service.activity('sup_a')).toEqual(['rows']);
		expect(support.activity).toHaveBeenCalledWith('supplier', ['sup_a']);
		await service.rememberCode('sup_a', 'NW-12', 'var_1');
		expect(itemCodes.remember).toHaveBeenCalledWith('sup_a', 'NW-12', 'var_1');
	});
});
