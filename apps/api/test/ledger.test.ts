import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type {
	AccountGroup,
	ChartOfAccounts,
	DocumentLock,
	JournalVoucher,
	Ledger,
	PeriodLock,
} from '@saha-textile/contracts';
import type { StatementLine } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import { LedgerService } from '../src/ledger/ledger.service';

class MemoryBooks {
	groups: AccountGroup[] = [];
	ledgers: Ledger[] = [];
	vouchers: JournalVoucher[] = [];
	async chart(): Promise<ChartOfAccounts> {
		return { groups: this.groups, ledgers: this.ledgers };
	}
	async seedChart(chart: ChartOfAccounts) {
		if (this.groups.length) return false;
		this.groups = chart.groups;
		this.ledgers = chart.ledgers;
		return true;
	}
	async saveGroup(group: AccountGroup) {
		this.groups.push(group);
	}
	async saveLedger(ledger: Ledger) {
		this.ledgers = [...this.ledgers.filter((l) => l.id !== ledger.id), ledger];
	}
	async findVoucherByKey(key: string) {
		return this.vouchers.find((v) => v.idempotencyKey === key) ?? null;
	}
	async insertVoucher(voucher: JournalVoucher) {
		this.vouchers.push(voucher);
	}
	async markReversed(id: string, by: string) {
		const v = this.vouchers.find((x) => x.id === id);
		if (!v || v.reversedById) throw new Error('already_reversed');
		v.reversedById = by;
	}
	async getVoucher(id: string) {
		return this.vouchers.find((v) => v.id === id) ?? null;
	}
	async listVouchers() {
		return { items: this.vouchers, total: this.vouchers.length };
	}
	private rows(ledgerId: string): StatementLine[] {
		return this.vouchers.flatMap((v) =>
			v.lines
				.filter((l) => l.ledgerId === ledgerId)
				.map((l) => ({
					voucherId: v.id,
					number: v.number,
					kind: v.kind,
					date: v.date,
					narration: v.narration,
					locationId: l.locationId,
					debitPaise: l.debitPaise,
					creditPaise: l.creditPaise,
				})),
		);
	}
	async balanceBefore(ledgerId: string, day: string) {
		return this.rows(ledgerId)
			.filter((r) => r.date < day)
			.reduce((sum, r) => sum + r.debitPaise - r.creditPaise, 0);
	}
	async statementLines(ledgerId: string, from: string, to: string) {
		return this.rows(ledgerId).filter((r) => r.date >= from && r.date <= to);
	}
	async dueReversals(day: string) {
		return this.vouchers.filter((v) => v.reverseOn && v.reverseOn <= day && !v.reversedById);
	}
	async balancesAt(day: string) {
		const out: Record<string, number> = {};
		for (const v of this.vouchers.filter((x) => x.date <= day))
			for (const l of v.lines) out[l.ledgerId] = (out[l.ledgerId] ?? 0) + l.debitPaise - l.creditPaise;
		return out;
	}
	async ledgerInUse() {
		return false;
	}
}

const setup = (options: { locks?: PeriodLock[]; kind?: 'proprietorship' | 'private_limited' } = {}) => {
	const books = new MemoryBooks();
	let locks: PeriodLock[] = options.locks ?? [];
	const documentLocks = new Map<string, DocumentLock>();
	let counter = 0;
	const audit: { action: string; retentionTier?: string }[] = [];
	const service = new LedgerService(
		books as never,
		{
			list: async () => locks,
			save: async (next: PeriodLock[]) =>
				void (locks = [
					...locks.filter((l) => !next.some((n) => n.month === l.month && n.part === l.part)),
					...next,
				]),
		} as never,
		{
			get: async (t: string, id: string) => documentLocks.get(`${t}:${id}`) ?? null,
			acquire: async (lock: DocumentLock, staleBefore: string) => {
				const key = `${lock.documentType}:${lock.documentId}`;
				const held = documentLocks.get(key);
				if (held && held.holderId !== lock.holderId && held.lastActiveAt >= staleBefore) return held;
				documentLocks.set(key, lock);
				return lock;
			},
			takeOver: async (lock: DocumentLock) => (
				documentLocks.set(`${lock.documentType}:${lock.documentId}`, lock),
				lock
			),
			touch: async () => true,
			release: async () => undefined,
		} as never,
		{ getProfile: async () => ({ kind: options.kind ?? 'proprietorship' }) } as never,
		{
			list: async () => [
				{ id: 'loc_bar', active: true, gstRegistrationId: 'reg_wb' },
				{ id: 'loc_aga', active: true, gstRegistrationId: 'reg_tr' },
			],
		} as never,
		{ withTransaction: (work: (c: object) => Promise<unknown>) => work({}) } as never,
		{ append: async (entry: { action: string; retentionTier?: string }) => void audit.push(entry) } as never,
		{ findByKey: async () => ({ id: 'role_admin' }) } as never,
		{ findActive: async (userId: string) => (userId === 'adm_owner' ? { userId } : null) } as never,
		{ findById: async (id: string) => ({ id, displayName: id === 'adm_owner' ? 'Owner' : 'Manager' }) } as never,
		{ issue: async () => `JV/26-27/${String(++counter).padStart(6, '0')}` } as never,
		{
			scope: async (principal: { userId: string }) =>
				principal.userId === 'adm_owner'
					? { all: true, ids: ['loc_bar', 'loc_aga'], current: null }
					: { all: false, ids: ['loc_bar'], current: 'loc_bar' },
		} as never,
	);
	return { service, books, audit, getLocks: () => locks };
};

const owner = {
	userId: 'adm_owner',
	sessionId: 's',
	audience: 'admin',
	role: 'admin',
	permissions: ['accounts.post', 'accounts.lock'],
} as never;
const manager = {
	userId: 'adm_manager',
	sessionId: 's',
	audience: 'admin',
	role: 'admin',
	permissions: ['accounts.post'],
} as never;
const rentPaid = (patch: Record<string, unknown> = {}) => ({
	kind: 'payment' as const,
	date: '2026-11-05',
	narration: 'November rent',
	lines: [
		{ ledgerId: 'led_rent', locationId: 'loc_bar', debitPaise: 1_500_000, creditPaise: 0, narration: '' },
		{ ledgerId: 'led_cash', locationId: 'loc_bar', debitPaise: 0, creditPaise: 1_500_000, narration: '' },
	],
	reverseOn: null,
	attachmentIds: [],
	idempotencyKey: 'rent-nov-0001',
	...patch,
});

describe('general ledger (accounts brief Q, T, D10)', () => {
	it('seeds the chart for the kind of business on first read', async () => {
		const { service } = setup({ kind: 'private_limited' });
		const chart = await service.chart();
		expect(chart.ledgers.find((l) => l.systemKey === 'share_capital')?.groupId).toBe('grp_capital_account');
		expect(chart.groups.find((g) => g.id === 'grp_cash_in_hand')?.parentId).toBe('grp_current_assets');
	});

	it('posts a payment typed by hand, stamps the GSTIN, and returns the same voucher for a repeated key', async () => {
		const { service, books, audit } = setup();
		const voucher = await service.postByHand(rentPaid(), owner);
		expect(voucher).toMatchObject({ number: 'JV/26-27/000001', totalPaise: 1_500_000, createdBy: 'adm_owner' });
		expect(voucher.lines.every((l) => l.gstRegistrationId === 'reg_wb')).toBe(true);
		expect((await service.postByHand(rentPaid(), owner)).id).toBe(voucher.id);
		expect(books.vouchers).toHaveLength(1);
		expect(audit.map((a) => a.action)).toContain('accounts.voucher.post');
		// The books' edit log is kept 8 years (owner, 2026-11-23).
		expect(audit.every((a) => a.retentionTier === 'books')).toBe(true);
		const statement = await service.statement(
			'led_cash',
			{ from: '2026-11-01', to: '2026-11-30', locationIds: [] },
			owner,
		);
		expect(statement).toMatchObject({ openingPaise: 0, creditPaise: 1_500_000, closingPaise: -1_500_000 });
		expect(await service.balances('2026-11-30', owner)).toEqual({ led_rent: 1_500_000, led_cash: -1_500_000 });
	});

	it('refuses control ledgers by hand, other people’s locations, and locked months', async () => {
		const { service } = setup({
			locks: [{ month: '2026-10', part: 'cash', state: 'locked', reason: 'Filed', by: null, at: null }],
		});
		const intoGst = rentPaid({
			kind: 'journal',
			idempotencyKey: 'gst-by-hand-1',
			lines: [
				{ ledgerId: 'led_output_cgst', locationId: 'loc_bar', debitPaise: 100, creditPaise: 0, narration: '' },
				{ ledgerId: 'led_cash', locationId: 'loc_bar', debitPaise: 0, creditPaise: 100, narration: '' },
			],
		});
		await expect(service.postByHand(intoGst, owner)).rejects.toThrow('voucher_problem:ledger_not_by_hand');
		const atAgartala = rentPaid({
			idempotencyKey: 'aga-rent-01',
			lines: rentPaid().lines.map((l) => ({ ...l, locationId: 'loc_aga' })),
		});
		await expect(service.postByHand(atAgartala, manager)).rejects.toBeInstanceOf(ForbiddenException);
		await expect(
			service.postByHand(rentPaid({ date: '2026-10-31', idempotencyKey: 'oct-rent-01' }), owner),
		).rejects.toThrow('voucher_problem:period_locked');
	});

	it('lets only the accounts manager post into a month closed for staff', async () => {
		const { service } = setup({
			locks: [
				{ month: '2026-10', part: 'cash', state: 'closed_for_staff', reason: 'October', by: null, at: null },
			],
		});
		await expect(
			service.postByHand(rentPaid({ date: '2026-10-30', idempotencyKey: 'oct-mgr-01' }), manager),
		).rejects.toThrow('voucher_problem:period_closed_for_staff');
		expect(
			(await service.postByHand(rentPaid({ date: '2026-10-30', idempotencyKey: 'oct-own-01' }), owner)).date,
		).toBe('2026-10-30');
	});

	it('reverses only for a super admin, once, by swapping sides', async () => {
		const { service, books } = setup();
		const voucher = await service.postByHand(rentPaid(), owner);
		const undo = { date: '2026-11-06', reason: 'Paid twice', idempotencyKey: 'undo-rent-01' };
		await expect(service.reverse(voucher.id, undo, manager)).rejects.toBeInstanceOf(ForbiddenException);
		const reversal = await service.reverse(voucher.id, undo, owner);
		expect(reversal.reversalOfId).toBe(voucher.id);
		expect(reversal.lines[0]).toMatchObject({ debitPaise: 0, creditPaise: 1_500_000 });
		expect(books.vouchers.find((v) => v.id === voucher.id)?.reversedById).toBe(reversal.id);
		await expect(
			service.reverse(voucher.id, { ...undo, idempotencyKey: 'undo-rent-02' }, owner),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it('undoes vouchers on their reversal date', async () => {
		const { service, books } = setup();
		await service.postByHand(
			rentPaid({ kind: 'journal', reverseOn: '2026-12-01', idempotencyKey: 'accrual-01' }),
			owner,
		);
		expect(await service.runDueReversals('2026-11-30')).toBe(0);
		expect(await service.runDueReversals('2026-12-01')).toBe(1);
		expect(books.vouchers).toHaveLength(2);
	});

	it('locks months part by part; reopening needs a super admin', async () => {
		const { service, getLocks } = setup();
		await service.lockPeriods(
			{ months: ['2026-10'], parts: ['sales', 'cash'], state: 'locked', reason: 'October filed' },
			manager,
		);
		expect(getLocks()).toHaveLength(2);
		await expect(
			service.lockPeriods(
				{ months: ['2026-10'], parts: ['sales'], state: 'open', reason: 'Wrong month' },
				manager,
			),
		).rejects.toBeInstanceOf(ForbiddenException);
		const grid = await service.periodGrid('2026-11-23');
		expect(grid.months[0]).toBe('2025-04');
		expect(grid.months).toHaveLength(24);
	});

	it('holds a document for one person and names them to others', async () => {
		const { service } = setup();
		expect((await service.lockDocument('voucher', 'jv_1', owner)).holderName).toBe('Owner');
		expect((await service.lockDocument('voucher', 'jv_1', manager)).holderName).toBe('Owner');
		await expect(service.takeOverDocument('voucher', 'jv_1', manager)).rejects.toBeInstanceOf(ForbiddenException);
	});
});
