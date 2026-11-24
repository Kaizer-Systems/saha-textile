import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type {
	AccountGroup,
	ChartOfAccounts,
	DocumentLock,
	JournalVoucher,
	Ledger,
	PeriodLock,
	VoucherDraft,
} from '@saha-textile/contracts';
import { StaleRevisionError, type StatementLine } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import { LedgerModule } from '../src/ledger/ledger.module';
import { LedgerService } from '../src/ledger/ledger.service';

import { templatesFor } from './accounts-templates-memory';

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
	drafts = new Map<string, VoucherDraft>();
	async listDrafts() {
		return [...this.drafts.values()];
	}
	async getDraft(id: string) {
		return this.drafts.get(id) ?? null;
	}
	async saveDraft(draft: VoucherDraft) {
		this.drafts.set(draft.id, draft);
	}
	async deleteDraft(id: string) {
		this.drafts.delete(id);
	}
}

const newGst = () => {
	const filings: unknown[] = [];
	return {
		filings,
		list: async () => filings,
		insert: async (f: { gstRegistrationId: string; returnType: string; month: string }) => {
			if (
				filings.some(
					(x) =>
						JSON.stringify([
							(x as typeof f).gstRegistrationId,
							(x as typeof f).returnType,
							(x as typeof f).month,
						]) === JSON.stringify([f.gstRegistrationId, f.returnType, f.month]),
				)
			)
				throw new Error('duplicate_gst_filing');
			filings.push(f);
		},
	};
};
const setup = (
	options: {
		locks?: PeriodLock[];
		kind?: 'proprietorship' | 'private_limited';
		noProfile?: boolean;
		admins?: { findById: (id: string) => Promise<unknown> };
		counts?: Record<string, number>;
		cash?: { unfinishedIn: (month: string) => Promise<unknown[]> };
	} = {},
) => {
	const books = new MemoryBooks();
	const gst = newGst();
	let locks: PeriodLock[] = options.locks ?? [];
	const documentLocks = new Map<string, DocumentLock>();
	let counter = 0;
	const audit: { action: string; retentionTier?: string }[] = [];
	const company = {
		getProfile: async () => (options.noProfile ? null : { kind: options.kind ?? 'proprietorship' }),
		getRegistration: async (id: string) => (id === 'reg_wb' ? { id, gstin: '19DBYPS6736R1ZZ' } : null),
	};
	const templates = templatesFor(company);
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
		company as never,
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
		(options.admins ?? {
			findById: async (id: string) => ({ id, displayName: id === 'adm_owner' ? 'Owner' : 'Manager' }),
		}) as never,
		{ findManyByIds: async () => [{ id: 'ast_1', originalStorageKey: 'media/bill.pdf' }] } as never,
		{ getUrl: (key: string) => `https://cdn.example/${key}` } as never,
		{ list: async () => ({ items: [], total: 0, counts: options.counts ?? { counting: 1, review: 0 } }) } as never,
		{ pendingCount: async () => 2 } as never,
		gst as never,
		{ issue: async () => `JV/26-27/${String(++counter).padStart(6, '0')}` } as never,
		{
			scope: async (principal?: { userId: string }) =>
				principal?.userId === 'adm_owner'
					? { all: true, ids: ['loc_bar', 'loc_aga'], current: null }
					: { all: false, ids: ['loc_bar'], current: 'loc_bar' },
		} as never,
		templates.service,
		(options.cash ?? null) as never,
	);
	return { service, books, audit, gst, templates, getLocks: () => locks };
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
	attachments: [],
	draftId: null,
	idempotencyKey: 'rent-nov-0001',
	...patch,
});

describe('general ledger (accounts brief Q, T, D10)', () => {
	it('seeds the chart from the kind’s templates on first read, and sets the books up only when asked (T2, T3)', async () => {
		const { service, templates } = setup({ kind: 'private_limited' });
		const chart = await service.chart();
		expect(chart.ledgers.find((l) => l.systemKey === 'share_capital')).toMatchObject({
			groupId: 'grp_capital_account',
			roles: ['share_capital'],
		});
		expect(chart.groups.find((g) => g.id === 'grp_cash_in_hand')).toMatchObject({
			parentId: 'grp_current_assets',
			roles: ['cash_in_hand'],
		});
		// A read never sets the books up: the kind stays the company's to choose (AT1).
		expect(templates.installs.rows).toEqual([]);
		expect(await templates.service.booksSetUp()).toBe(false);
		const library = await service.setUpBooks('adm_owner');
		expect(templates.installs.rows.map(({ code, version }) => [code, version])).toEqual([
			['CH-COMMON', 3],
			['RS-LIMITS', 2],
			['RS-RCM', 1],
			['RS-TDS', 1],
			['CH-PVT', 3],
			['RP-SCH3-BS', 1],
			['RP-SCH3-PL', 1],
		]);
		expect(library.find((row) => row.code === 'RS-RCM')).toMatchObject({ installedVersion: 1, locked: false });
		expect(await templates.service.booksSetUp()).toBe(true);
		expect((await service.chart()).ledgers.some((l) => l.systemKey === 'directors_remuneration')).toBe(true);
		// Books already set up: setting them up again is refused (the kind changes only through Convert).
		await expect(service.setUpBooks('adm_owner')).rejects.toThrow('books_already_set_up');
		// Read as a proprietorship, then set up as a company: what the company's chart has is added, nothing removed.
		const options: { kind: 'proprietorship' | 'private_limited' } = { kind: 'proprietorship' };
		const late = setup(options);
		expect((await late.service.chart()).ledgers.some((l) => l.systemKey === 'share_capital')).toBe(false);
		options.kind = 'private_limited';
		await late.service.setUpBooks('adm_owner');
		const books = await late.service.chart();
		expect(books.ledgers.find((l) => l.systemKey === 'share_capital')).toMatchObject({
			groupId: 'grp_capital_account',
		});
		expect(books.ledgers.some((l) => l.systemKey === 'drawings')).toBe(true);
		// The ledger module brings the templates library with it.
		expect(new LedgerModule()).toBeInstanceOf(LedgerModule);
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

	it('saves a half-filled draft, then posts it with its attachment and removes the draft', async () => {
		const { service, books } = setup();
		const draft = await service.saveDraft(
			null,
			{
				kind: 'payment',
				date: '2026-11-05',
				narration: 'November rent',
				lines: [{ ledgerId: 'led_rent', locationId: '', debitPaise: 1_500_000, creditPaise: 0, narration: '' }],
				reverseOn: null,
				attachments: [{ assetId: 'ast_1', name: 'rent-receipt.pdf' }],
				expectedUpdatedAt: null,
			},
			owner,
		);
		expect(draft).toMatchObject({ createdByName: 'Owner' });
		const posted = await service.postByHand(
			rentPaid({ draftId: draft.id, attachments: draft.attachments, idempotencyKey: 'from-draft-01' }),
			owner,
		);
		expect(books.drafts.size).toBe(0);
		const detail = await service.voucher(posted.id);
		expect(detail.attachmentLinks).toEqual([
			{ assetId: 'ast_1', name: 'rent-receipt.pdf', url: 'https://cdn.example/media/bill.pdf' },
		]);
	});

	it('lists the checks before locking a month, with features not built yet marked', async () => {
		const { service } = setup();
		await service.saveDraft(
			null,
			{
				kind: 'journal',
				date: '2026-11-30',
				narration: '',
				lines: [],
				reverseOn: null,
				attachments: [],
				expectedUpdatedAt: null,
			},
			owner,
		);
		const checks = await service.periodChecks('2026-11');
		expect(Object.fromEntries(checks.map((c) => [c.key, [c.state, c.count]]))).toEqual({
			cash_sheets: ['not_in_use', 0],
			transfers: ['not_in_use', 0],
			depreciation: ['not_in_use', 0],
			payroll: ['not_in_use', 0],
			drafts: ['attention', 1],
			reversals: ['ok', 0],
			stock_counts: ['attention', 1],
			stock_approvals: ['attention', 2],
		});
	});

	it('counts the month’s cash sheets still open or waiting for a manager, and tells listeners of every voucher', async () => {
		const { service } = setup({
			cash: { unfinishedIn: async (month: string) => (month === '2026-11' ? [{}, {}] : []) },
		});
		const check = async (month: string) => (await service.periodChecks(month)).find((c) => c.key === 'cash_sheets');
		expect(await check('2026-11')).toEqual({ key: 'cash_sheets', state: 'attention', count: 2 });
		expect(await check('2026-10')).toEqual({ key: 'cash_sheets', state: 'ok', count: 0 });
		const heard: unknown[][] = [];
		service.onPosted(async (voucher, context) => void heard.push([voucher.idempotencyKey, context]));
		await service.postByHand(rentPaid({ idempotencyKey: 'rent-heard-0001' }), owner);
		expect(heard).toEqual([['rent-heard-0001', {}]]);
	});

	it('marks GSTR-3B filed with its ARN, once, and then refuses cash and purchase entries of that month for that GSTIN', async () => {
		const { service } = setup();
		const filed = await service.markFiled(
			{
				gstRegistrationId: 'reg_wb',
				returnType: 'GSTR-3B',
				month: '2026-10',
				arn: 'aa1911261234567',
				filedOn: '2026-11-20',
				acknowledgement: null,
			},
			owner,
		);
		expect(filed).toMatchObject({ gstin: '19DBYPS6736R1ZZ', arn: 'AA1911261234567' });
		await expect(
			service.markFiled(
				{
					gstRegistrationId: 'reg_wb',
					returnType: 'GSTR-3B',
					month: '2026-10',
					arn: 'AA1911261234567',
					filedOn: '2026-11-20',
					acknowledgement: null,
				},
				owner,
			),
		).rejects.toThrow('gst_already_filed');
		// A cash payment is not sales or purchases: still allowed; the grid shows the filing.
		expect(
			(await service.postByHand(rentPaid({ date: '2026-10-15', idempotencyKey: 'oct-cash-01' }), owner)).date,
		).toBe('2026-10-15');
		expect((await service.periodGrid('2026-11-23')).filings).toHaveLength(1);
	});

	it('adds groups and ledgers, renames and switches off a ledger, and refuses what can’t be', async () => {
		const { service, books, audit } = setup();
		const chart = await service.chart();
		const parent = chart.groups.find((g) => g.systemKey === 'indirect_expenses')!;
		await expect(service.addGroup({ name: 'Shop costs', parentId: 'grp_x' }, 'adm_owner')).rejects.toThrow(
			'group_parent_unknown',
		);
		const group = await service.addGroup({ name: 'Shop costs', parentId: parent.id }, 'adm_owner');
		expect(group).toMatchObject({ parentId: parent.id, nature: parent.nature });
		await expect(
			service.addLedger({ name: 'Power', groupId: 'grp_x', active: true } as never, null),
		).rejects.toThrow('group_unknown');
		const ledger = await service.addLedger({ name: 'Electricity', groupId: group.id, active: true } as never, null);
		const write = { name: 'Power', groupId: group.id, active: false } as never;
		expect(await service.saveLedger(ledger.id, write, 'adm_owner')).toMatchObject({ name: 'Power', active: false });
		await expect(service.saveLedger('led_x', write, null)).rejects.toBeInstanceOf(NotFoundException);
		await expect(
			service.saveLedger(ledger.id, { name: 'P', groupId: 'grp_x', active: true } as never, null),
		).rejects.toThrow('group_unknown');
		await expect(service.saveLedger('led_sales', write, null)).rejects.toThrow('system_ledger_group');
		books.saveLedger = async () => {
			throw new StaleRevisionError('ledger', ledger.id);
		};
		await expect(service.saveLedger(ledger.id, write, null)).rejects.toBeInstanceOf(ConflictException);
		books.saveLedger = async () => {
			throw new Error('disk_full');
		};
		await expect(service.saveLedger(ledger.id, write, null)).rejects.toThrow('disk_full');
		expect(audit.map((a) => a.action)).toEqual(
			expect.arrayContaining(['accounts.group.create', 'accounts.ledger.create', 'accounts.ledger.update']),
		);
	});

	it('posts a document to the ledgers playing its roles, or by id, and refuses an unmapped role or unknown ledger', async () => {
		const { service } = setup();
		const posted = await service.post(
			{
				date: '2026-11-20',
				narration: 'Refund voucher RF/26-27/000001',
				lines: [
					{
						ledger: { role: 'customer_advances' },
						locationId: 'loc_bar',
						debitPaise: 2_600,
						narration: 'Advance',
					},
					{ ledger: { id: 'led_gateway_clearing' }, locationId: 'loc_bar', creditPaise: 2_600 },
				],
				source: { type: 'refundVoucher', id: 'rf_1' },
				idempotencyKey: 'refundVoucher:rf_1',
			},
			{} as never,
		);
		expect(posted.kind).toBe('document');
		expect(await service.voucherByKey('refundVoucher:rf_1', {} as never)).toEqual(posted);
		expect(await service.voucherByKey('refundVoucher:rf_none')).toBeNull();
		expect(posted.lines.map((l) => [l.ledgerId, l.gstRegistrationId, l.narration])).toEqual([
			['led_customer_advances', 'reg_wb', 'Advance'],
			['led_gateway_clearing', 'reg_wb', ''],
		]);
		const lines = (ledger: object, locationId = 'loc_bar') => [
			{ ledger, locationId, debitPaise: 100 },
			{ ledger: { role: 'gateway_clearing' }, locationId, creditPaise: 100 },
		];
		const request = (l: object[]) => ({
			kind: 'journal' as const,
			date: '2026-11-20',
			narration: 'x',
			lines: l as never,
			source: { type: 'test', id: 'x' },
			idempotencyKey: `k:${Math.random()}`,
		});
		await expect(service.post(request(lines({ role: 'nothing' })), {} as never)).rejects.toThrow(
			'voucher_problem:role_not_mapped:nothing',
		);
		await expect(service.post(request(lines({ id: 'led_x' })), {} as never)).rejects.toThrow(
			'voucher_problem:ledger_unknown',
		);
		await expect(
			service.post(request(lines({ role: 'customer_advances' }, 'loc_gone')), {} as never),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it('lists and opens vouchers with their attachment links, and reads balances and statements within the person’s locations', async () => {
		const { service, books } = setup();
		const posted = await service.post(
			{
				date: '2026-11-20',
				narration: 'Rent',
				lines: [
					{ ledger: { id: 'led_rent' }, locationId: 'loc_bar', debitPaise: 500 },
					{ ledger: { id: 'led_cash' }, locationId: 'loc_bar', creditPaise: 500 },
				],
				source: { type: 'test', id: 'rent' },
				idempotencyKey: 'rent:test-0001',
			},
			{} as never,
		);
		const range = { from: '2026-11-01', to: '2026-11-30', kinds: [], search: '', page: 2, pageSize: 10 };
		expect(await service.vouchers(range)).toMatchObject({ total: 1, page: 2, pageSize: 10 });
		books.vouchers.push({
			...posted,
			id: 'jv_files',
			attachments: [
				{ assetId: 'ast_1', name: 'bill.pdf' },
				{ assetId: 'ast_gone', name: 'lost.pdf' },
			],
		});
		expect((await service.voucher('jv_files')).attachmentLinks.map((a) => a.url)).toEqual([
			'https://cdn.example/media/bill.pdf',
			null,
		]);
		await expect(service.voucher('jv_x')).rejects.toBeInstanceOf(NotFoundException);
		expect((await service.voucher(posted.id)).attachmentLinks).toEqual([]);
		expect(await service.balances('2026-11-30', owner)).toMatchObject({ led_rent: 1000 });
		expect(await service.balances('2026-11-30', manager)).toMatchObject({ led_cash: -1000 });
		const query = { from: '2026-11-01', to: '2026-11-30', locationIds: [] as string[] };
		await expect(service.statement('led_x', query, owner)).rejects.toBeInstanceOf(NotFoundException);
		await expect(
			service.statement('led_rent', { ...query, locationIds: ['loc_aga'] }, manager),
		).rejects.toBeInstanceOf(ForbiddenException);
		expect((await service.statement('led_rent', query, manager)).openingPaise).toBe(0);
		expect((await service.statement('led_rent', { ...query, locationIds: ['loc_bar'] }, owner)).from).toBe(
			'2026-11-01',
		);
	});

	it('handles nobody signed in, missing records, refused writes, take-overs and filings', async () => {
		const { service, books } = setup({ noProfile: true, counts: {} });
		expect(await service.isSuperAdmin(undefined)).toBe(false);
		expect((await service.chart()).groups.some((g) => g.systemKey === 'capital_account')).toBe(true);
		await expect(
			service.reverse(
				'jv_x',
				{ date: '2026-11-30', reason: 'x', idempotencyKey: 'rev-x-0001' } as never,
				undefined,
			),
		).rejects.toBeInstanceOf(ForbiddenException);
		await expect(
			service.reverse('jv_x', { date: '2026-11-30', reason: 'x', idempotencyKey: 'rev-x-0001' } as never, owner),
		).rejects.toBeInstanceOf(NotFoundException);
		const rent = await service.postByHand(rentPaid({ idempotencyKey: 'rent-anon-0001' }), undefined);
		await expect(
			service.reverse(rent.id, { date: '2026-11-01', reason: 'x', idempotencyKey: 'rev-x-0002' } as never, owner),
		).rejects.toThrow('reverse_on_before_date');
		books.vouchers.push({ ...rent, id: 'jv_due', idempotencyKey: 'due-key-0001', reverseOn: null });
		books.dueReversals = async () => books.vouchers.filter((v) => v.id === 'jv_due');
		expect(await service.runDueReversals('2026-11-30')).toBe(1);
		expect(await service.periodChecks('2026-11')).toEqual(
			expect.arrayContaining([expect.objectContaining({ key: 'stock_counts' })]),
		);
		expect(await service.drafts()).toEqual([]);
		await expect(service.draft('vd_x')).rejects.toBeInstanceOf(NotFoundException);
		const write = {
			kind: 'journal' as const,
			date: '2026-11-05',
			narration: 'x',
			lines: [],
			reverseOn: null,
			attachments: [],
			expectedUpdatedAt: null,
		};
		await expect(service.saveDraft('vd_x', write, owner)).rejects.toBeInstanceOf(NotFoundException);
		const draft = await service.saveDraft(null, write, undefined);
		expect(draft).toMatchObject({ createdBy: null, createdByName: '', updatedBy: null });
		await service.saveDraft(draft.id, { ...write, expectedUpdatedAt: draft.updatedAt }, owner);
		await service.saveDraft(draft.id, write, owner);
		books.saveDraft = async () => {
			throw new StaleRevisionError('voucherDraft', draft.id);
		};
		await expect(service.saveDraft(draft.id, write, owner)).rejects.toBeInstanceOf(ConflictException);
		books.saveDraft = async () => {
			throw new Error('disk_full');
		};
		await expect(service.saveDraft(draft.id, write, owner)).rejects.toThrow('disk_full');
		await service.deleteDraft(draft.id, undefined);
		await service.lockPeriods(
			{ months: ['2026-09'], parts: ['sales'], state: 'closed_for_staff', reason: 'September done' },
			undefined,
		);
		await service.lockPeriods(
			{ months: ['2026-09'], parts: ['sales'], state: 'locked', reason: 'September filed' },
			owner,
		);
		const filing = {
			gstRegistrationId: 'reg_wb',
			returnType: 'GSTR-1' as const,
			month: '2026-09',
			arn: 'aa1911261234568',
			filedOn: '2026-10-11',
			acknowledgement: null,
		};
		await expect(service.markFiled({ ...filing, gstRegistrationId: 'reg_x' } as never, owner)).rejects.toThrow(
			'gst_registration_unknown',
		);
		await service.markFiled(filing as never, undefined);
		await expect(service.markFiled(filing as never, owner)).rejects.toBeInstanceOf(ConflictException);
		const failing = setup();
		failing.gst.insert = async () => {
			throw new Error('disk_full');
		};
		await expect(failing.service.markFiled(filing as never, owner)).rejects.toThrow('disk_full');
		await expect(service.lockDocument('voucher', 'jv_9', undefined)).rejects.toBeInstanceOf(ForbiddenException);
		expect(await service.touchDocument('voucher', 'jv_9', undefined)).toEqual({ held: false });
		expect(await service.touchDocument('voucher', 'jv_9', owner)).toEqual({ held: true });
		await service.releaseDocument('voucher', 'jv_9', undefined);
		await service.releaseDocument('voucher', 'jv_9', owner);
		await expect(service.takeOverDocument('voucher', 'jv_9', undefined)).rejects.toBeInstanceOf(ForbiddenException);
		expect((await service.takeOverDocument('voucher', 'jv_9', owner)).holderId).toBe('adm_owner');
	});

	it('names people by display name, else e-mail, else username, else their id, even when the lookup fails', async () => {
		const names = [
			{ findById: async () => ({ displayName: '', email: 'e@x.test', username: 'u' }) },
			{ findById: async () => ({ displayName: '', email: '', username: 'gopa' }) },
			{ findById: async () => ({ displayName: '', email: '', username: '' }) },
			{
				findById: async () => {
					throw new Error('down');
				},
			},
		];
		const seen: string[] = [];
		for (const admins of names)
			seen.push((await setup({ admins }).service.lockDocument('voucher', 'jv_1', owner)).holderName);
		expect(seen).toEqual(['e@x.test', 'gopa', 'adm_owner', 'adm_owner']);
		const broken = setup();
		const seed = broken.books.seedChart.bind(broken.books);
		let first = true;
		broken.books.seedChart = async (chart) => {
			if (first) {
				first = false;
				throw new Error('db_down');
			}
			return seed(chart);
		};
		await expect(broken.service.chart()).rejects.toThrow('db_down');
		expect((await broken.service.chart()).ledgers.length).toBeGreaterThan(10);
	});
});
