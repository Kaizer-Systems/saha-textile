import { Reflector } from '@nestjs/core';
import type { BankAccount } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { PERMISSIONS_KEY } from '../src/auth/session.guard';
import { BanksController } from '../src/banks/banks.controller';
import { BanksModule } from '../src/banks/banks.module';
import { BanksService, chipOf } from '../src/banks/banks.service';

/** Bank accounts (accounts brief BA1–BA3). */

const NOW = new Date('2026-11-24T06:00:00.000Z');
const write = (patch: Record<string, unknown> = {}) =>
	({
		kind: 'current',
		ifsc: 'HDFC0001234',
		bankName: 'HDFC Bank',
		branch: 'Barasat',
		holder: 'K.R. Marketing',
		number: '50200012344821',
		shortName: 'HDFC Bank · Barasat',
		limitINR: null,
		ratePercent: null,
		maturesOn: null,
		locationId: 'loc_bar',
		openingINR: 3_12_000,
		openingOn: '2026-11-01',
		chequeFrom: '000401',
		chequeTo: '000450',
		upiIds: ['shop@hdfcbank'],
		active: true,
		...patch,
	}) as never;

function setup(options: { groups?: string[]; locations?: unknown[]; landing?: Record<string, unknown> | null } = {}) {
	const store = new Map<string, BankAccount>();
	const posted: {
		kind: string;
		date: string;
		lines: { ledger: unknown; locationId: string; debitPaise?: number; creditPaise?: number }[];
	}[] = [];
	const ledgers: unknown[][] = [];
	const service = new BanksService(
		{
			list: async () => [...store.values()],
			get: async (id: string) => store.get(id) ?? null,
			insert: async (a: BankAccount) => void store.set(a.id, a),
			save: async (a: BankAccount, v: number) => {
				const next = { ...a, version: v + 1 };
				store.set(a.id, next);
				return next;
			},
		} as never,
		{ balanceBefore: async (ledgerId: string) => (ledgerId === 'led_1' ? 31_200_000 : -3_00_00_000) } as never,
		{
			get: async () =>
				options.landing === undefined
					? { receivedByGateway: 'led_1', paidByBank: 'led_1', receivedByUpi: null }
					: options.landing,
		} as never,
		{ withTransaction: (work: (context: object) => Promise<unknown>) => work({}) } as never,
		{
			list: async () =>
				options.locations ?? [
					{ id: 'loc_bar', active: true, warehouse: true, shipsOnline: true, createdAt: '2026-01-01' },
				],
		} as never,
		{
			chart: async () => ({
				groups: (options.groups ?? ['bank_accounts', 'bank_od']).map((key) => ({
					id: `g_${key}`,
					systemKey: key,
				})),
				ledgers: [],
			}),
			addLedger: vi.fn(
				async (w: { name: string; groupId: string }) => (
					ledgers.push(['add', w.name, w.groupId]),
					{ id: `led_${ledgers.length}` }
				),
			),
			saveLedger: vi.fn(
				async (id: string, w: { name: string; groupId: string; active: boolean }) =>
					void ledgers.push(['save', id, w.name, w.groupId, w.active]),
			),
			post: vi.fn(
				async (request: (typeof posted)[number]) => (posted.push(request), { id: `jv_${posted.length}` }),
			),
		} as never,
		{
			summary: async () =>
				Object.fromEntries(
					[...store.keys()].slice(0, 1).map((id) => [id, { lastDate: '2026-11-28', toMatch: 6 }]),
				),
		} as never,
	);
	return { service, store, posted, ledgers };
}

const manager = { userId: 'adm_owner', permissions: ['accounts.index', 'accounts.edit'] } as never;
const clerk = { userId: 'adm_clerk', permissions: ['accounts.index'] } as never;

describe('adding a bank account (BA2)', () => {
	it('makes its ledger under Bank accounts and posts the opening balance on its day, at its location', async () => {
		const s = setup();
		const account = await s.service.add(write(), manager, NOW);
		expect(account).toMatchObject({
			ledgerId: 'led_1',
			openingVoucherId: 'jv_1',
			updatedBy: 'adm_owner',
			version: 0,
		});
		expect(s.ledgers).toEqual([['add', 'HDFC Bank · Barasat', 'g_bank_accounts']]);
		expect(s.posted[0]).toMatchObject({ kind: 'opening', date: '2026-11-01' });
		expect(s.posted[0]!.lines).toEqual([
			{ ledger: { id: 'led_1' }, locationId: 'loc_bar', debitPaise: 31_200_000 },
			{ ledger: { role: 'opening_balance_difference' }, locationId: 'loc_bar', creditPaise: 31_200_000 },
		]);
	});

	it('puts a cash credit under the overdraft group with its borrowed balance, at the default location', async () => {
		const s = setup();
		await s.service.add(
			write({ kind: 'cash_credit', locationId: null, openingINR: -30_00_000, limitINR: 40_00_000 }),
			undefined,
			NOW,
		);
		expect(s.ledgers[0]).toEqual(['add', 'HDFC Bank · Barasat', 'g_bank_od']);
		expect(s.posted[0]!.lines[1]).toEqual({
			ledger: { id: 'led_1' },
			locationId: 'loc_bar',
			creditPaise: 30_00_00_000,
		});
		const empty = setup();
		expect(
			(await empty.service.add(write({ openingINR: 0, openingOn: null, locationId: null }), manager, NOW))
				.openingVoucherId,
		).toBeNull();
		expect(empty.posted).toHaveLength(0);
	});

	it('refuses an opening with no date or nowhere to post it, and a chart without the group', async () => {
		await expect(setup().service.add(write({ openingOn: null }), manager, NOW)).rejects.toThrow(
			'bank_opening_needs_date',
		);
		await expect(setup({ locations: [] }).service.add(write({ locationId: null }), manager, NOW)).rejects.toThrow(
			'books_need_a_location',
		);
		await expect(
			setup({ groups: ['bank_accounts'] }).service.add(write({ kind: 'overdraft' }), manager, NOW),
		).rejects.toThrow('role_not_mapped:bank_od');
	});
});

describe('the bank accounts list and an account (BA1, BA3)', () => {
	it('lists with the balance in the books, what lands there, chip counts, and the number whole only to a manager', async () => {
		const s = setup();
		await s.service.add(write(), manager, NOW);
		await s.service.add(
			write({
				kind: 'fixed_deposit',
				number: '99887766',
				shortName: 'HDFC FD',
				openingINR: 0,
				openingOn: null,
				ratePercent: 7.1,
			}),
			manager,
			NOW,
		);
		await s.service.add(
			write({ kind: 'overdraft', number: '11223344', shortName: 'ICICI OD', openingINR: 0, openingOn: null }),
			manager,
			NOW,
		);
		const seen = await s.service.list(manager);
		expect(seen.counts).toEqual({ all: 3, current: 1, credit: 1, deposits: 1 });
		expect(seen.manage).toBe(true);
		expect(seen.items[0]).toMatchObject({
			numberShown: '50200012344821',
			balancePaise: 31_200_000,
			lands: ['receivedByGateway', 'paidByBank'],
		});
		const masked = await s.service.list(clerk);
		expect([masked.manage, masked.items[0]!.number, masked.items[0]!.numberShown]).toEqual([
			false,
			'•••• 4821',
			'•••• 4821',
		]);
		expect((await s.service.list(undefined)).items[1]!.balancePaise).toBe(-3_00_00_000);
		const id = [...s.store.keys()][0] as string;
		expect((await s.service.get(id, clerk)).numberShown).toBe('•••• 4821');
		await expect(s.service.get('bank_none', clerk)).rejects.toThrow('bank_account_not_found');
		const noLanding = setup({ landing: null });
		await noLanding.service.add(write(), manager, NOW);
		expect((await noLanding.service.list(manager)).items[0]!.lands).toEqual([]);
		expect(
			['current', 'savings', 'cash_credit', 'overdraft', 'fixed_deposit'].map((k) => chipOf(k as never)),
		).toEqual(['current', 'current', 'credit', 'credit', 'deposits']);
	});

	it('names the bank from an IFSC', () => {
		expect(setup().service.ifsc(' sbin0001234 ')).toEqual({ ifsc: 'SBIN0001234', bankName: 'State Bank of India' });
	});
});

describe('changing a bank account (BA2)', () => {
	it('saves its details and its ledger’s name and group, but never its posted opening', async () => {
		const s = setup();
		const account = await s.service.add(write(), manager, NOW);
		const saved = await s.service.edit(
			account.id,
			{ ...(write() as object), shortName: 'HDFC main', kind: 'savings', version: 0 } as never,
			manager,
			NOW,
		);
		expect([saved.shortName, saved.version, saved.updatedBy]).toEqual(['HDFC main', 1, 'adm_owner']);
		expect(s.ledgers.at(-1)).toEqual(['save', 'led_1', 'HDFC main', 'g_bank_accounts', true]);
		await expect(
			s.service.edit(account.id, { ...(write() as object), openingINR: 1, version: 1 } as never, manager, NOW),
		).rejects.toThrow('bank_opening_is_posted');
		await expect(
			s.service.edit(
				account.id,
				{ ...(write() as object), openingOn: '2026-10-01', version: 1 } as never,
				manager,
				NOW,
			),
		).rejects.toThrow('bank_opening_is_posted');
		await expect(
			s.service.edit('bank_none', { ...(write() as object), version: 0 } as never, undefined),
		).rejects.toThrow('bank_account_not_found');
		expect(
			(await s.service.edit(account.id, { ...(write() as object), version: 1 } as never, undefined)).updatedBy,
		).toBeNull();
	});
});

describe('bank routes', () => {
	it('read behind accounts.index, change behind accounts.edit, wired into the API', async () => {
		const svc = {
			list: vi.fn(async () => 'list'),
			ifsc: vi.fn(() => 'ifsc'),
			get: vi.fn(async () => 'get'),
			add: vi.fn(async () => 'add'),
			edit: vi.fn(async () => 'edit'),
		};
		const c = new BanksController(svc as never, {} as never, {} as never);
		const p = manager;
		expect([
			await c.list(p),
			c.ifsc({ code: 'HDFC' }),
			await c.get('b', p),
			await c.add({} as never, p),
			await c.edit('b', {} as never, p),
		]).toEqual(['list', 'ifsc', 'get', 'add', 'edit']);
		const perm = (m: keyof BanksController) => new Reflector().get(PERMISSIONS_KEY, BanksController.prototype[m]);
		expect([perm('list'), perm('ifsc'), perm('get')]).toEqual(Array(3).fill(['accounts.index']));
		expect([perm('add'), perm('edit')]).toEqual(Array(2).fill(['accounts.edit']));
		expect(Reflect.getMetadata('providers', BanksModule)).toContain(BanksService);
	});
});
