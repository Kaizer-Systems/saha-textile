import { Reflector } from '@nestjs/core';
import { BOOK_PARTS } from '@saha-textile/contracts';
import type { YearCloseRecord } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { PERMISSIONS_KEY } from '../src/auth/session.guard';
import { PersistenceModule } from '../src/infra/persistence.module';
import { YEAR_CLOSE_REPOSITORY } from '../src/infra/tokens';
import { LedgerModule } from '../src/ledger/ledger.module';
import { YearCloseController, YearCloseService } from '../src/ledger/year-close';

/** Closing a financial year (accounts brief T3): the ten checks, the closing entries, and the year locked. */

const YEAR = '2026-27';
const at = '2027-04-20T06:00:00.000Z';
const now = new Date(at);
const refusal = (code: string) => ({ response: { message: code } });
const ca = { userId: 'adm_ca', permissions: ['accounts.lock'] } as never;

const CHART = {
	groups: [
		{ id: 'g_inc', parentId: null, nature: 'income', systemKey: 'sales_accounts', name: 'Sales' },
		{ id: 'g_exp', parentId: null, nature: 'expense', systemKey: 'indirect_expenses', name: 'Expenses' },
		{ id: 'g_res', parentId: null, nature: 'equity', systemKey: 'reserves_and_surplus', name: 'Reserves' },
		{ id: 'g_susp', parentId: null, nature: 'asset', systemKey: 'suspense_account', name: 'Suspense' },
		{ id: 'g_susp_inner', parentId: 'g_susp', nature: 'asset', systemKey: null, name: 'Unknown receipts' },
		// A group under one the chart no longer has.
		{ id: 'g_stray', parentId: 'g_missing', nature: 'asset', systemKey: null, name: 'Stray' },
		{ id: 'g_ca', parentId: null, nature: 'asset', systemKey: 'current_assets', name: 'Current assets' },
	],
	ledgers: [
		{ id: 'led_sales', groupId: 'g_inc', roles: [] },
		{ id: 'led_rent', groupId: 'g_exp', roles: [] },
		{ id: 'led_pl', groupId: 'g_res', roles: ['profit_and_loss'] },
		{ id: 'led_susp', groupId: 'g_susp', roles: [] },
		{ id: 'led_susp_inner', groupId: 'g_susp_inner', roles: [] },
		{ id: 'led_gateway', groupId: 'g_ca', roles: ['gateway_clearing'] },
		{ id: 'led_stray', groupId: 'g_stray', roles: [] },
		{ id: 'led_lost', groupId: 'g_gone', roles: [] },
		{ id: 'led_cash', groupId: 'g_ca', roles: [] },
	],
};
/** Sales of ₹1,000 and rent of ₹400 at the bar; nothing moved at the shop. */
const BALANCES: Record<string, Record<string, number>> = {
	'2027-03-31|loc_bar': { led_sales: -100_000, led_rent: 40_000 },
	'2027-03-31|': { led_susp: -500, led_susp_inner: 300, led_gateway: 200, led_stray: 7_000, led_cash: 9_999 },
};
/** The closing lines those balances need: ₹600 of profit to the Profit and loss account. */
const WANTED = [
	{ ledgerId: 'led_sales', locationId: 'loc_bar', debitPaise: 100_000, creditPaise: 0 },
	{ ledgerId: 'led_rent', locationId: 'loc_bar', debitPaise: 0, creditPaise: 40_000 },
	{ ledgerId: 'led_pl', locationId: 'loc_bar', debitPaise: 0, creditPaise: 60_000 },
];

const record = (over: Partial<YearCloseRecord> = {}): YearCloseRecord => ({
	year: YEAR,
	accrualsConfirmedBy: 'adm_acc',
	accrualsConfirmedAt: '2027-04-10T06:00:00.000Z',
	suspenseNote: 'Carried: unidentified deposit',
	closingVoucherId: null,
	profitPaise: null,
	closedBy: null,
	closedAt: null,
	updatedAt: '2027-04-10T06:00:00.000Z',
	...over,
});
const terms = (from: string, over: Record<string, unknown> = {}) => ({
	from,
	kind: 'regular',
	scheme: 'monthly',
	...over,
});

interface Options {
	saved?: YearCloseRecord | null;
	chart?: typeof CHART;
	balances?: Record<string, Record<string, number>>;
	banks?: unknown[];
	summary?: Record<string, { lastDate: string | null }>;
	bankLines?: Record<string, { status: string }[]>;
	counts?: unknown[];
	assets?: unknown[];
	runs?: unknown[];
	registrations?: unknown[];
	filings?: unknown[];
	cashOpen?: number;
	moving?: number;
	vouchers?: Record<string, unknown>;
}

/** Every check done: banks reconciled, a year-end count posted, March's payroll posted, accruals and suspense settled. */
function build(options: Options = {}) {
	let saved = options.saved === undefined ? record() : options.saved;
	const vouchers = new Map(Object.entries(options.vouchers ?? {}));
	const store = {
		get: vi.fn(async (_year: string) => saved),
		save: vi.fn(async (next: YearCloseRecord) => void (saved = next)),
	};
	const books = {
		balancesAt: vi.fn(
			async (day: string, ids: readonly string[]) =>
				(options.balances ?? BALANCES)[`${day}|${ids.join(',')}`] ?? {},
		),
		getVoucher: vi.fn(async (id: string) => vouchers.get(id) ?? null),
	};
	const statements = {
		summary: async () =>
			options.summary ?? { bank_1: { lastDate: '2027-03-31' }, bank_2: { lastDate: '2027-04-05' } },
		inPeriod: vi.fn(async (id: string) => (options.bankLines ?? {})[id] ?? [{ status: 'accepted' }]),
	};
	let posted = 0;
	const ledger = {
		chart: async () => options.chart ?? CHART,
		post: vi.fn(
			async (
				request: {
					lines: { ledger: { id: string }; locationId: string; debitPaise?: number; creditPaise?: number }[];
				},
				_context: unknown,
				_by: string | null,
			) => {
				const id = `jv_close_${++posted}`;
				vouchers.set(id, {
					id,
					reversedById: null,
					lines: request.lines.map((l) => ({
						ledgerId: l.ledger.id,
						locationId: l.locationId,
						debitPaise: l.debitPaise ?? 0,
						creditPaise: l.creditPaise ?? 0,
					})),
				});
				return { id };
			},
		),
		reverse: vi.fn(async (id: string) => {
			vouchers.set(id, { ...(vouchers.get(id) as object), reversedById: 'jv_undo' });
			return { id: 'jv_undo' };
		}),
		lockPeriods: vi.fn(async () => []),
	};
	const transactions = {
		withTransaction: vi.fn(async <T>(work: (context: unknown) => Promise<T>) => work({ session: 'tx' })),
	};
	const service = new YearCloseService(
		store as never,
		books as never,
		{ list: async () => [{ id: 'loc_bar' }, { id: 'loc_shop' }] } as never,
		{
			unfinishedIn: async (month: string) => (month === '2026-06' ? Array(options.cashOpen ?? 0).fill({}) : []),
		} as never,
		{ list: async () => options.banks ?? [{ id: 'bank_1' }, { id: 'bank_2' }] } as never,
		statements as never,
		{
			list: async () => ({
				items: options.counts ?? [{ startedAt: '2027-03-30T10:00:00.000Z', status: 'posted' }],
			}),
		} as never,
		{
			inTransitFrom: async (month: string) => (month === '2027-03' ? Array(options.moving ?? 0).fill({}) : []),
		} as never,
		{ list: async () => options.assets ?? [] } as never,
		{ list: async () => options.runs ?? [{ month: '2027-03', status: 'posted' }] } as never,
		{ listRegistrations: async () => options.registrations ?? [] } as never,
		{ list: async () => options.filings ?? [] } as never,
		ledger as never,
		transactions as never,
	);
	return { service, store, books, statements, ledger, transactions, vouchers, saved: () => saved };
}
const stateOf = async (service: YearCloseService, key: string) =>
	(await service.view(YEAR)).checks.find((c) => c.key === key);

describe('the year’s checks (T3)', () => {
	it('starts from a blank record, so accruals wait and suspense left over is a warning', async () => {
		const view = await build({ saved: null }).service.view(YEAR);
		expect(view).toMatchObject({
			year: YEAR,
			from: '2026-04-01',
			to: '2027-03-31',
			closingVoucherId: null,
			profitPaise: null,
			suspenseNote: null,
			accrualsConfirmedAt: null,
			closedAt: null,
			closedBy: null,
			canPostClosing: false,
			canClose: false,
		});
		// Suspense: everything under Suspense (its inner group too) and the clearing ledgers, whatever the sign.
		expect(view.checks.find((c) => c.key === 'suspense')).toMatchObject({ state: 'warning', amountPaise: 1_000 });
		expect(view.checks.find((c) => c.key === 'accruals')).toMatchObject({ state: 'attention', count: 1 });
	});

	it('lets the closing entries go once everything else is done, and the close only once they are posted', async () => {
		const view = await build().service.view(YEAR);
		expect(view.checks.map((c) => [c.key, c.state])).toEqual([
			['cash', 'ok'],
			['banks', 'ok'],
			['stock_count', 'ok'],
			['transfers', 'ok'],
			['depreciation', 'ok'],
			['payroll', 'ok'],
			['gst', 'not_in_use'],
			['suspense', 'ok'],
			['accruals', 'ok'],
			['closing', 'attention'],
		]);
		expect([view.done, view.canPostClosing, view.canClose]).toEqual([9, true, false]);
	});

	it('refuses books without a Profit and loss account', async () => {
		await expect(
			build({ chart: { ...CHART, ledgers: CHART.ledgers.filter((l) => l.id !== 'led_pl') } }).service.view(YEAR),
		).rejects.toMatchObject(refusal('books_not_set_up'));
	});

	it('counts a bank reconciled only when its statements reach the year’s end and every line is accepted', async () => {
		const { service, statements } = build({
			banks: [{ id: 'bank_1' }, { id: 'bank_short' }, { id: 'bank_none' }, { id: 'bank_open' }],
			summary: {
				bank_1: { lastDate: '2027-03-31' },
				bank_short: { lastDate: '2027-03-15' },
				bank_open: { lastDate: '2027-04-02' },
			},
			bankLines: { bank_open: [{ status: 'accepted' }, { status: 'suggested' }] },
		});
		expect(await stateOf(service, 'banks')).toMatchObject({ state: 'attention', count: 1, of: 4 });
		expect(statements.inPeriod.mock.calls.map(([id]) => id)).toEqual(['bank_1', 'bank_open']);
		expect(await stateOf(build({ banks: [] }).service, 'banks')).toMatchObject({ state: 'not_in_use' });
	});

	it('counts the year-end stock counts started from 1 March to 15 April', async () => {
		const count = (startedAt: string, status: string) => ({ startedAt: `${startedAt}T10:00:00.000Z`, status });
		const { service } = build({
			counts: [
				count('2027-02-28', 'counting'),
				count('2027-03-01', 'posted'),
				count('2027-03-20', 'counting'),
				count('2027-04-01', 'review'),
				count('2027-04-15', 'awaiting_approval'),
				count('2027-04-10', 'cancelled'),
				count('2027-04-16', 'counting'),
			],
		});
		expect(await stateOf(service, 'stock_count')).toMatchObject({ state: 'attention', count: 3, of: 1 });
	});

	it('counts cash sheets, transfers, assets still to depreciate and March’s payroll', async () => {
		const asset = (over: Record<string, unknown> = {}) => ({
			putToUseOn: '2026-05-01',
			disposedOn: null,
			depreciatedThrough: '2027-02',
			accumulatedPaise: 100_000,
			costINR: 120_000,
			residualINR: 0,
			...over,
		});
		const { service } = build({
			cashOpen: 2,
			moving: 1,
			assets: [
				asset(),
				asset({ depreciatedThrough: null, disposedOn: '2027-03-10' }),
				asset({ depreciatedThrough: '2027-03' }),
				asset({ putToUseOn: '2027-04-02' }),
				asset({ disposedOn: '2027-02-20' }),
				asset({ accumulatedPaise: 12_000_000 }),
			],
			runs: [{ month: '2027-02', status: 'posted' }],
		});
		const view = await service.view(YEAR);
		const of = (key: string) => view.checks.find((c) => c.key === key);
		expect([of('cash')?.count, of('transfers')?.count, of('depreciation')?.count, of('payroll')?.count]).toEqual([
			2, 1, 2, 1,
		]);
		expect(await stateOf(build({ runs: [] }).service, 'payroll')).toMatchObject({ state: 'not_in_use' });
		expect(await stateOf(build({ runs: [{ month: '2027-03', status: 'paid' }] }).service, 'payroll')).toMatchObject(
			{
				state: 'ok',
			},
		);
		expect(
			await stateOf(build({ runs: [{ month: '2027-03', status: 'draft' }] }).service, 'payroll'),
		).toMatchObject({
			state: 'attention',
		});
	});

	it('needs both GST returns each month, quarter ends only under QRMP, for active regular and casual GSTINs', async () => {
		const { service } = build({
			registrations: [
				{ id: 'reg_wb', terms: [terms('2017-07-01')] },
				{ id: 'reg_qrmp', terms: [terms('2017-07-01', { scheme: 'qrmp' })] },
				{ id: 'reg_fair', terms: [terms('2017-07-01', { kind: 'casual' })] },
				{ id: 'reg_comp', terms: [terms('2017-07-01', { kind: 'composition' })] },
				{ id: 'reg_isd', terms: [terms('2017-07-01', { kind: 'isd' })] },
				{ id: 'reg_shut', active: false, terms: [terms('2017-07-01')] },
				// Registered in January: three months of the year.
				{ id: 'reg_new', terms: [terms('2027-01-01')] },
			],
			filings: [
				{ gstRegistrationId: 'reg_wb', returnType: 'GSTR-1', month: '2026-04' },
				{ gstRegistrationId: 'reg_wb', returnType: 'GSTR-3B', month: '2026-04' },
				{ gstRegistrationId: 'reg_comp', returnType: 'GSTR-1', month: '2026-04' },
			],
		});
		// 24 + 8 + 24 + 6 returns needed; 2 of them filed.
		expect(await stateOf(service, 'gst')).toMatchObject({ state: 'attention', count: 2, of: 62 });
	});

	it('reads the closing entries posted, out of date when reversed, gone or different', async () => {
		const voucher = (lines: unknown[], reversedById: string | null = null) => ({ id: 'jv_c', reversedById, lines });
		const closing = async (vouchers: Record<string, unknown>) =>
			stateOf(build({ saved: record({ closingVoucherId: 'jv_c' }), vouchers }).service, 'closing');
		expect(await closing({ jv_c: voucher(WANTED) })).toMatchObject({ state: 'ok', count: 0 });
		expect(await closing({ jv_c: voucher(WANTED, 'jv_undo') })).toMatchObject({ state: 'attention', count: 1 });
		expect(await closing({})).toMatchObject({ state: 'attention', count: 1 });
		expect(await closing({ jv_c: voucher(WANTED.slice(1)) })).toMatchObject({ state: 'attention', count: 1 });
		const posted = await build({
			saved: record({ closingVoucherId: 'jv_c' }),
			vouchers: { jv_c: voucher(WANTED) },
		}).service.view(YEAR);
		expect([posted.canPostClosing, posted.canClose, posted.done]).toEqual([false, true, 10]);
		const closed = await build({
			saved: record({ closingVoucherId: 'jv_c', closedAt: at, closedBy: 'adm_ca' }),
			vouchers: { jv_c: voucher(WANTED) },
		}).service.view(YEAR);
		expect([closed.canPostClosing, closed.canClose]).toEqual([false, false]);
	});
});

describe('confirming accruals and suspense (T3)', () => {
	it('confirms accruals with who and when, and keeps, sets or clears the suspense note', async () => {
		const { service, saved } = build({ saved: null });
		await service.confirm(YEAR, { accruals: true, suspenseNote: null }, ca, now);
		expect(saved()).toMatchObject({
			accrualsConfirmedBy: 'adm_ca',
			accrualsConfirmedAt: at,
			suspenseNote: null,
			updatedAt: at,
		});
		await service.confirm(YEAR, { accruals: false, suspenseNote: 'Carried to next year' }, ca, now);
		expect(saved()).toMatchObject({ accrualsConfirmedBy: 'adm_ca', suspenseNote: 'Carried to next year' });
		await service.confirm(YEAR, { accruals: false, suspenseNote: null }, ca);
		expect(saved()?.suspenseNote).toBe('Carried to next year');
		await service.confirm(YEAR, { accruals: false, suspenseNote: '' }, ca);
		expect(saved()?.suspenseNote).toBeNull();
		const nobody = build({ saved: null });
		await nobody.service.confirm(YEAR, { accruals: true, suspenseNote: null }, undefined, now);
		expect(nobody.saved()?.accrualsConfirmedBy).toBeNull();
	});

	it('refuses once the year is closed', async () => {
		await expect(
			build({ saved: record({ closedAt: at }) }).service.confirm(
				YEAR,
				{ accruals: true, suspenseNote: null },
				ca,
			),
		).rejects.toMatchObject(refusal('year_closed'));
	});
});

describe('posting the closing entries (T3)', () => {
	it('posts every income and expense ledger to nothing, the profit to Profit and loss, on the year’s last day', async () => {
		const { service, ledger, transactions, saved } = build();
		const view = await service.postClosing(YEAR, ca, now);
		expect(transactions.withTransaction).toHaveBeenCalledTimes(1);
		const [request, context, by] = ledger.post.mock.calls[0] as unknown as [
			Record<string, unknown>,
			unknown,
			unknown,
		];
		expect(request).toMatchObject({
			kind: 'journal',
			date: '2027-03-31',
			narration: 'Closing entries for 2026-27',
			source: { type: 'yearClose', id: YEAR, number: null },
			lines: [
				{ ledger: { id: 'led_sales' }, locationId: 'loc_bar', debitPaise: 100_000 },
				{ ledger: { id: 'led_rent' }, locationId: 'loc_bar', creditPaise: 40_000 },
				{ ledger: { id: 'led_pl' }, locationId: 'loc_bar', creditPaise: 60_000 },
			],
		});
		expect(String(request['idempotencyKey'])).toMatch(/^yearClose:2026-27:/);
		expect([context, by]).toEqual([{ session: 'tx' }, 'adm_ca']);
		expect(saved()).toMatchObject({ closingVoucherId: 'jv_close_1', profitPaise: 60_000, updatedAt: at });
		expect(view.checks.find((c) => c.key === 'closing')?.state).toBe('ok');
		expect(ledger.reverse).not.toHaveBeenCalled();
	});

	it('reverses closing entries gone out of date before posting them again, skipping ones already reversed or gone', async () => {
		const stale = { id: 'jv_old', reversedById: null, lines: WANTED.slice(1) };
		const { service, ledger } = build({
			saved: record({ closingVoucherId: 'jv_old' }),
			vouchers: { jv_old: stale },
		});
		await service.postClosing(YEAR, undefined);
		expect(ledger.reverse).toHaveBeenCalledWith(
			'jv_old',
			{
				date: '2027-03-31',
				reason: 'The year changed after its closing entries; posted again',
				idempotencyKey: 'yearCloseUndo:jv_old',
			},
			undefined,
		);
		expect(ledger.post.mock.calls[0]?.[2]).toBeNull();
		const undone = build({
			saved: record({ closingVoucherId: 'jv_old' }),
			vouchers: { jv_old: { ...stale, reversedById: 'jv_undo' } },
		});
		await undone.service.postClosing(YEAR, ca);
		expect(undone.ledger.reverse).not.toHaveBeenCalled();
		const gone = build({ saved: record({ closingVoucherId: 'jv_gone' }) });
		await gone.service.postClosing(YEAR, ca);
		expect(gone.ledger.reverse).not.toHaveBeenCalled();
		expect(gone.ledger.post).toHaveBeenCalledTimes(1);
	});

	it('refuses while checks are open, once posted, and when the year has nothing to close', async () => {
		await expect(build({ cashOpen: 1 }).service.postClosing(YEAR, ca)).rejects.toMatchObject(
			refusal('year_close_checks_open'),
		);
		const posted = build({
			saved: record({ closingVoucherId: 'jv_c' }),
			vouchers: { jv_c: { id: 'jv_c', reversedById: null, lines: WANTED } },
		});
		await expect(posted.service.postClosing(YEAR, ca)).rejects.toMatchObject(refusal('year_close_checks_open'));
		await expect(build({ balances: {} }).service.postClosing(YEAR, ca)).rejects.toMatchObject(
			refusal('year_close_nothing'),
		);
	});
});

describe('closing and locking the year (T3)', () => {
	const ready = () =>
		build({
			saved: record({ closingVoucherId: 'jv_c' }),
			vouchers: { jv_c: { id: 'jv_c', reversedById: null, lines: WANTED } },
		});

	it('locks every month and every part of the books for everyone, and records who closed it', async () => {
		const { service, ledger, saved } = ready();
		const view = await service.close(YEAR, ca, now);
		expect(ledger.lockPeriods).toHaveBeenCalledWith(
			{
				months: [
					'2026-04',
					'2026-05',
					'2026-06',
					'2026-07',
					'2026-08',
					'2026-09',
					'2026-10',
					'2026-11',
					'2026-12',
					'2027-01',
					'2027-02',
					'2027-03',
				],
				parts: [...BOOK_PARTS],
				state: 'locked',
				reason: 'Year 2026-27 closed',
			},
			ca,
		);
		expect(saved()).toMatchObject({ closedBy: 'adm_ca', closedAt: at, updatedAt: at });
		expect(view).toMatchObject({ closedAt: at, closedBy: 'adm_ca', canClose: false });
		const nobody = ready();
		await nobody.service.close(YEAR, undefined);
		expect(nobody.saved()?.closedBy).toBeNull();
	});

	it('refuses a year closed already and one whose closing entries aren’t posted', async () => {
		const closed = build({
			saved: record({ closingVoucherId: 'jv_c', closedAt: at }),
			vouchers: { jv_c: { id: 'jv_c', reversedById: null, lines: WANTED } },
		});
		await expect(closed.service.close(YEAR, ca)).rejects.toMatchObject(refusal('year_closed'));
		await expect(build().service.close(YEAR, ca)).rejects.toMatchObject(refusal('year_close_checks_open'));
	});
});

describe('the year-close routes and wiring', () => {
	it('hand each call to the service; reading needs accounts.index, preparing accounts.post, closing accounts.lock', () => {
		const years = new Proxy(
			{},
			{
				get:
					(_t, name: string) =>
					(...args: unknown[]) => [name, ...args],
			},
		);
		const c = new YearCloseController(years as never);
		const confirm = { accruals: true, suspenseNote: null };
		expect([
			c.view(YEAR),
			c.confirm(YEAR, confirm, ca),
			c.confirm(YEAR, confirm),
			c.postClosing(YEAR, ca),
			c.postClosing(YEAR),
			c.close(YEAR, ca),
			c.close(YEAR),
		]).toEqual([
			['view', YEAR],
			['confirm', YEAR, confirm, ca],
			['confirm', YEAR, confirm, undefined],
			['postClosing', YEAR, ca],
			['postClosing', YEAR, undefined],
			['close', YEAR, ca],
			['close', YEAR, undefined],
		]);
		const perm = (m: keyof YearCloseController) =>
			new Reflector().get(PERMISSIONS_KEY, YearCloseController.prototype[m]);
		expect([perm('view'), perm('confirm'), perm('postClosing'), perm('close')]).toEqual([
			['accounts.index'],
			['accounts.post'],
			['accounts.post'],
			['accounts.lock'],
		]);
		expect(Reflect.getMetadata('controllers', LedgerModule)).toContain(YearCloseController);
		expect(Reflect.getMetadata('providers', LedgerModule)).toContain(YearCloseService);
		expect(Reflect.getMetadata('exports', PersistenceModule)).toContain(YEAR_CLOSE_REPOSITORY);
	});
});
