import { describe, expect, it, vi } from 'vitest';

import { BooksReportsService } from '../src/reports/books-reports.service';

/** Outstanding with ageing (accounts brief U5) and the audit report of the books (U8). */

const now = new Date('2026-11-28T06:00:00.000Z');

const business = (id: string, tradeName: string, legalName: string) => ({ id, tradeName, legalName });
const order = (dueOn: string | null, dueINR: number, placedAt = '2026-11-01T10:00:00.000Z') => ({
	dueOn,
	dueINR,
	placedAt,
});
const OPEN: Record<string, unknown[]> = {
	// Due in two days, and one with no due day placed 39 days ago.
	biz_a: [order('2026-11-30', 1000), order(null, 500, '2026-10-20T10:00:00.000Z')],
	// 119 days late.
	biz_b: [order('2026-08-01', 2000)],
	biz_c: [],
};
const bill = (
	supplierId: string,
	supplierName: string,
	dueOn: string,
	totalINR: number,
	paidINR = 0,
	creditedINR = 0,
) => ({
	supplierId,
	supplierName,
	dueOn,
	totals: { totalINR },
	paidINR,
	creditedINR,
});
const PAYABLES = [
	// 18 days late, part paid and part credited.
	bill('sup_nadia', 'Nadia Weavers', '2026-11-10', 1180, 500, 80),
	// 74 days late.
	bill('sup_nadia', 'Nadia Weavers', '2026-09-15', 1000),
	// Paid in full: nothing owed, so no row.
	bill('sup_bose', 'Bose Weavers', '2026-11-01', 500, 500),
];

const entry = (id: string, over: Record<string, unknown>) => ({
	id,
	createdAt: '2026-11-20T10:00:00.000Z',
	actorUserId: 'adm_a',
	action: 'accounts.voucher.update',
	entityType: 'journalVoucher',
	entityId: `ent_${id}`,
	diffs: [],
	metadata: {},
	...over,
});
const ENTRIES = [
	entry('a1', {
		entityId: 'jv_1',
		diffs: [{ field: 'narration', before: 'Rent', after: 'Rent for November' }],
		metadata: { reason: 'Typo' },
	}),
	entry('a2', {
		createdAt: '2026-11-21T10:00:00.000Z',
		actorUserId: 'adm_super',
		action: 'accounts.period.unlock',
		entityId: null,
		diffs: [{ field: 'state', before: 'locked' }],
	}),
	entry('a3', {
		createdAt: '2026-11-22T10:00:00.000Z',
		actorUserId: null,
		action: 'stock.adjustment.cancel',
		metadata: { date: '2026-11-01', reason: 42 },
	}),
	// Not a change to the books.
	entry('a4', { action: 'catalog.product.update' }),
	entry('a5', {
		createdAt: '2026-11-23T10:00:00.000Z',
		actorUserId: 'adm_down',
		action: 'document.lock.take_over',
		diffs: [{ field: 'holder', after: 'adm_x' }],
	}),
	entry('a6', { createdAt: '2026-11-24T10:00:00.000Z', actorUserId: 'adm_u', action: 'cash.sheet.save' }),
	entry('a7', { createdAt: '2026-11-25T10:00:00.000Z', actorUserId: 'adm_gone', action: 'gst.return.filed' }),
	entry('a8', { createdAt: '2026-11-26T10:00:00.000Z', actorUserId: 'adm_a', action: 'bank.rule.save' }),
];
const ADMINS: Record<string, unknown> = {
	adm_a: { displayName: 'Rina Das', email: 'rina@saha-textile.test', username: 'rina' },
	adm_super: { displayName: '', email: 'owner@saha-textile.test', username: 'owner' },
	adm_u: { displayName: null, email: null, username: 'sudip' },
};

function build(
	options: { pages?: { items: unknown[]; total: number }[]; noSuperRole?: boolean; businessPages?: unknown[] } = {},
) {
	const businessPages = (options.businessPages ?? [
		{
			items: [
				business('biz_a', 'Boutique Nila', 'Nila Fashions LLP'),
				business('biz_b', '', 'Rang Mahal Pvt Ltd'),
			],
			total: 150,
		},
		{ items: [business('biz_c', 'Quiet Traders', 'Quiet Traders')], total: 150 },
	]) as { items: unknown[]; total: number }[];
	const businesses = {
		list: vi.fn(async (query: { page: number }) => businessPages[query.page - 1] ?? { items: [], total: 0 }),
	};
	const pages = options.pages ?? [
		{ items: ENTRIES.slice(0, 4), total: 205 },
		{ items: ENTRIES.slice(4), total: 205 },
	];
	const audit = { list: vi.fn(async (query: { page: number }) => pages[query.page - 1] ?? { items: [], total: 0 }) };
	const admins = {
		findById: vi.fn(async (id: string) => {
			if (id === 'adm_down') throw new Error('people lookup down');
			return ADMINS[id] ?? null;
		}),
	};
	const roles = {
		findByKey: vi.fn(async (key: string) => (options.noSuperRole ? null : { id: 'role_admin', key })),
	};
	const service = new BooksReportsService(
		businesses as never,
		{ listOpenOnAccount: async (id: string) => OPEN[id] ?? [] } as never,
		{ openPayables: async () => PAYABLES } as never,
		audit as never,
		roles as never,
		{
			listActiveForRole: async (roleId: string) => (roleId === 'role_admin' ? [{ userId: 'adm_super' }] : []),
		} as never,
		admins as never,
	);
	return { service, businesses, audit, admins, roles };
}

describe('outstanding with ageing (U5)', () => {
	it('ages what each business customer owes on its orders on account, largest first', async () => {
		const { service, businesses } = build();
		const ageing = await service.ageing('customers', now);
		expect(businesses.list).toHaveBeenCalledWith({ role: 'all', page: 1, pageSize: 100 });
		expect(businesses.list).toHaveBeenCalledTimes(2);
		expect(ageing).toEqual({
			side: 'customers',
			asAt: '2026-11-28',
			rows: [
				{
					partyId: 'biz_b',
					name: 'Rang Mahal Pvt Ltd',
					notDue: 0,
					days1to30: 0,
					days31to60: 0,
					days61to90: 0,
					over90: 200_000,
					total: 200_000,
				},
				{
					partyId: 'biz_a',
					name: 'Boutique Nila',
					notDue: 100_000,
					days1to30: 0,
					days31to60: 50_000,
					days61to90: 0,
					over90: 0,
					total: 150_000,
				},
			],
			totals: {
				notDue: 100_000,
				days1to30: 0,
				days31to60: 50_000,
				days61to90: 0,
				over90: 200_000,
				total: 350_000,
			},
		});
	});

	it('stops reading businesses at an empty page', async () => {
		const { service, businesses } = build({
			businessPages: [{ items: [business('biz_b', 'Rang Mahal', 'Rang Mahal Pvt Ltd')], total: 900 }],
		});
		expect((await service.ageing('customers', now)).rows.map((r) => r.partyId)).toEqual(['biz_b']);
		expect(businesses.list).toHaveBeenCalledTimes(2);
	});

	it('ages what each supplier is owed on its posted bills, less what was paid and credited, leaving out a bill paid off', async () => {
		const ageing = await build().service.ageing('suppliers', now);
		expect(ageing.rows).toEqual([
			{
				partyId: 'sup_nadia',
				name: 'Nadia Weavers',
				notDue: 0,
				days1to30: 60_000,
				days31to60: 0,
				days61to90: 100_000,
				over90: 0,
				total: 160_000,
			},
		]);
		expect(ageing.totals.total).toBe(160_000);
		expect((await build().service.ageing('suppliers')).asAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});

describe('the audit report of the books (U8)', () => {
	const query = (over: Record<string, unknown> = {}) =>
		({ from: '2026-11-01', to: '2026-11-30', chip: 'all', page: 1, pageSize: 50, ...over }) as never;

	it('lists the books’ changes of the period in India, newest first, with who made each and what changed', async () => {
		const { service, audit, admins, roles } = build();
		const report = await service.auditReport(query());
		expect(audit.list).toHaveBeenCalledWith({
			from: '2026-10-31T18:30:00.000Z',
			to: '2026-11-30T18:29:59.999Z',
			page: 1,
			pageSize: 200,
		});
		expect(audit.list).toHaveBeenCalledTimes(2);
		expect(roles.findByKey).toHaveBeenCalledWith('administrator');
		expect(report.total).toBe(7);
		expect(report.rows.map((r) => [r.id, r.who, r.entityId, r.detail, r.categories])).toEqual([
			['a8', 'Rina Das', 'ent_a8', '', ['edits']],
			['a7', 'adm_gone', 'ent_a7', '', []],
			['a6', 'sudip', 'ent_a6', '', ['edits']],
			['a5', 'adm_down', 'ent_a5', 'holder: — → adm_x', ['takeovers']],
			// No one signed in, a reason that isn't words, dated before the day it was made.
			['a3', '', 'ent_a3', '', ['cancelled', 'backdated']],
			['a2', 'owner@saha-textile.test', null, 'state: locked → —', ['unlocks', 'superAdmin']],
			['a1', 'Rina Das', 'jv_1', 'narration: Rent → Rent for November · Typo', ['edits']],
		]);
		// Each person is looked up once.
		expect(admins.findById.mock.calls.filter(([id]) => id === 'adm_a')).toHaveLength(1);
		expect(report.counts).toEqual({
			all: 7,
			edits: 3,
			backdated: 1,
			cancelled: 1,
			unlocks: 1,
			takeovers: 1,
			superAdmin: 1,
		});
	});

	it('searches who, the action, the record and what changed, whatever the case, and counts what matches', async () => {
		const { service } = build();
		const ids = async (q: string) => (await service.auditReport(query({ q }))).rows.map((r) => r.id);
		expect(await ids('RINA')).toEqual(['a8', 'a1']);
		expect(await ids('jv_1')).toEqual(['a1']);
		expect(await ids('rent for')).toEqual(['a1']);
		expect(await ids('unlock')).toEqual(['a2']);
		expect((await service.auditReport(query({ q: 'rina' }))).counts).toMatchObject({
			all: 2,
			edits: 2,
			superAdmin: 0,
		});
	});

	it('shows one chip a page at a time', async () => {
		const { service } = build();
		const edits = await service.auditReport(query({ chip: 'edits', page: 2, pageSize: 2 }));
		expect([edits.rows.map((r) => r.id), edits.total]).toEqual([['a1'], 3]);
	});

	it('names no super admin when the role is gone', async () => {
		const report = await build({ noSuperRole: true }).service.auditReport(query());
		expect(report.counts.superAdmin).toBe(0);
	});

	it('stops reading at an empty page, and at 10,000 entries', async () => {
		const short = build({ pages: [{ items: ENTRIES.slice(0, 2), total: 999 }] });
		expect((await short.service.auditReport(query())).total).toBe(2);
		expect(short.audit.list).toHaveBeenCalledTimes(2);
		const page = Array.from({ length: 200 }, (_, i) => entry(`x${i}`, { action: 'catalog.product.update' }));
		const endless = build({ pages: Array.from({ length: 60 }, () => ({ items: page, total: 99_999 })) });
		expect((await endless.service.auditReport(query())).total).toBe(0);
		expect(endless.audit.list).toHaveBeenCalledTimes(50);
	});
});
