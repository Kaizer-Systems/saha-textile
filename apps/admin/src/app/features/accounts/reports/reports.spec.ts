import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { REPORT_KEYS, ReportsGateway } from '@core/accounts/reports.gateway';
import { runtimeConfig } from '@core/config/runtime-config';
import { LocationsGateway } from '@core/locations/locations.gateway';
import { downloadCsv } from '@core/purchasing/purchasing-format';
import { accountsRange } from '@features/accounts/accounts-period';

import { PlByLocationPage } from './pl-by-location-page';
import { REPORT_LIBRARY, ReportsLibraryPage } from './reports-library';
import { StatementPage, indent, statementCsv, statementFigure } from './statement-page';
import { TrialBalancePage, trialRows } from './trial-balance-page';

vi.mock('@core/purchasing/purchasing-format', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing-format')>()),
	downloadCsv: vi.fn(),
}));

/** Reports (accounts brief U1–U4): the library, the statements, the trial balance and profit and loss by location. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const istToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

function mount<T>(component: Type<T>, providers: unknown[], route: Record<string, string> = {}) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			component,
			TranslocoTestingModule.forRoot({
				langs: {
					en: {
						report_balance_sheet: 'Balance sheet',
						report_trial_balance: 'Trial balance',
						report_stock_value: 'Stock value',
					},
				},
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			provideRouter([]),
			{ provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap(route)) } },
			...(providers as never[]),
		],
	});
	const fixture = TestBed.createComponent(component);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance };
}

const el = (fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as HTMLElement | null;
const all = (fixture: { nativeElement: HTMLElement }, selector: string) =>
	[...fixture.nativeElement.querySelectorAll(selector)] as HTMLElement[];
const pick = (control: HTMLElement | null, value: string, event = 'change') => {
	(control as HTMLInputElement).value = value;
	(control as HTMLInputElement).dispatchEvent(new Event(event));
};

describe('the reports gateway', () => {
	it('names its query keys and calls each route', () => {
		const query = { asAt: '2026-11-24', locationId: 'l1' };
		const run = { spec: {} as never, from: '2026-11-01', to: '2026-11-30', preview: true };
		expect(REPORT_KEYS.all).toEqual(['reports']);
		expect(REPORT_KEYS.statement('profitLoss', query)).toEqual(['reports', 'statement', 'profitLoss', query]);
		expect(REPORT_KEYS.plByLocation({ from: 'a', to: 'b' })).toEqual([
			'reports',
			'pl-by-location',
			{ from: 'a', to: 'b' },
		]);
		expect([REPORT_KEYS.catalogue, REPORT_KEYS.saved]).toEqual([
			['reports', 'catalogue'],
			['reports', 'saved'],
		]);
		expect(REPORT_KEYS.one('r1')).toEqual(['reports', 'saved', 'r1']);
		expect(REPORT_KEYS.run(run)).toEqual(['reports', 'run', run]);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(ReportsGateway);
		const http = TestBed.inject(HttpTestingController);
		const api = `${runtimeConfig.apiUrl}/admin/accounts/reports/`;
		const calls: [() => unknown, string, string][] = [
			[
				() => gateway.statement('profitLoss', query),
				'GET',
				'statements/profitLoss?asAt=2026-11-24&locationId=l1',
			],
			[
				() => gateway.plByLocation({ from: '2026-04-01', to: '2027-03-31' }),
				'GET',
				'pl-by-location?from=2026-04-01&to=2027-03-31',
			],
			[() => gateway.catalogue(), 'GET', 'catalogue'],
			[() => gateway.run(run), 'POST', 'run'],
			[() => gateway.saved(), 'GET', 'saved'],
			[() => gateway.one('r/1'), 'GET', 'saved/r%2F1'],
			[() => gateway.create({} as never), 'POST', 'saved'],
			[() => gateway.update('r/1', {} as never), 'PUT', 'saved/r%2F1'],
			[() => gateway.remove('r/1'), 'DELETE', 'saved/r%2F1'],
		];
		for (const [call, method, path] of calls) {
			(call() as { subscribe: () => void }).subscribe();
			http.expectOne((req) => req.method === method && req.urlWithParams === api + path).flush({});
		}
		http.verify();
	});
});

const SAVED = [
	{ id: 's1', name: 'Monthly sales by city', folder: 'Sales' },
	{ id: 's2', name: 'GST balance check', folder: 'Saved by you' },
	{ id: 's3', name: 'Weekly sales', folder: 'Sales' },
];

describe('the ageing and audit routes', () => {
	it('names their keys and calls them', () => {
		const query = { from: '2026-11-01', to: '2026-11-30', chip: 'edits', page: 2, q: 'INV' } as const;
		expect(REPORT_KEYS.ageing('suppliers')).toEqual(['reports', 'ageing', 'suppliers']);
		expect(REPORT_KEYS.audit(query)).toEqual(['reports', 'audit', query]);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(ReportsGateway);
		const http = TestBed.inject(HttpTestingController);
		const api = `${runtimeConfig.apiUrl}/admin/accounts/reports/`;
		gateway.ageing('customers').subscribe();
		http.expectOne((req) => req.method === 'GET' && req.urlWithParams === `${api}ageing/customers`).flush({});
		gateway.audit(query).subscribe();
		http.expectOne(
			(req) =>
				req.method === 'GET' &&
				req.urlWithParams === `${api}audit?from=2026-11-01&to=2026-11-30&chip=edits&page=2&q=INV`,
		).flush({});
		http.verify();
	});
});

describe('the reports library (U1)', () => {
	it('shows every group in order with the saved reports by folder, each linking where it opens', async () => {
		const { fixture, page } = mount(ReportsLibraryPage, [
			{ provide: ReportsGateway, useValue: { saved: vi.fn(() => of(SAVED)) } },
		]);
		await settle(fixture);
		expect(REPORT_LIBRARY.map((g) => g.group)).toEqual([
			'financial',
			'books',
			'receivables',
			'gst',
			'stock',
			'sales',
			'cash',
		]);
		expect(page.groups()).toHaveLength(7);
		expect(page.folders()).toEqual([
			{
				folder: 'Sales',
				items: [
					{ id: 's1', name: 'Monthly sales by city' },
					{ id: 's3', name: 'Weekly sales' },
				],
			},
			{ folder: 'Saved by you', items: [{ id: 's2', name: 'GST balance check' }] },
		]);
		const href = (text: string) =>
			all(fixture, 'a')
				.find((a) => a.textContent?.trim() === text)
				?.getAttribute('href') ?? null;
		expect(href('Balance sheet')).toBe('/accounts/reports/statement/balanceSheet');
		expect(href('report_supplier_outstanding')).toBe('/stock/reports?tab=unpaid');
		expect(href('report_sales_builder')).toBe('/accounts/reports/new?data=invoices');
		expect(href('Weekly sales')).toBe('/accounts/reports/saved/s3');
		expect(href('report_customer_ageing')).toBe('/accounts/reports/ageing/customers');
		expect(href('report_supplier_ageing')).toBe('/accounts/reports/ageing/suppliers');
		expect(href('report_audit_report')).toBe('/accounts/reports/audit');
		expect(REPORT_LIBRARY.find((g) => g.group === 'receivables')?.items.map((i) => i.key)).toEqual([
			'customer_ageing',
			'supplier_ageing',
			'business_statements',
			'supplier_outstanding',
		]);
		expect(el(fixture, '#reports_new')?.getAttribute('href')).toBe('/accounts/reports/new');
	});

	it('narrows every group and folder to what was typed, dropping the empty ones', async () => {
		const { fixture, page } = mount(ReportsLibraryPage, [
			{ provide: ReportsGateway, useValue: { saved: vi.fn(() => of(SAVED)) } },
		]);
		await settle(fixture);
		pick(el(fixture, '#reports_find'), '  BALANCE ', 'input');
		await settle(fixture);
		expect(page.groups()).toEqual([
			{
				group: 'financial',
				items: [REPORT_LIBRARY[0]?.items[0], REPORT_LIBRARY[0]?.items[3]],
			},
		]);
		expect(page.folders()).toEqual([{ folder: 'Saved by you', items: [{ id: 's2', name: 'GST balance check' }] }]);
		expect(all(fixture, 'h6').map((h) => h.textContent?.trim())).toEqual([
			'report_group_financial',
			'Saved by you',
		]);
		page.find.set('stock value');
		expect(page.groups().map((g) => g.group)).toEqual(['stock']);
		page.find.set('nothing like this');
		expect([page.groups(), page.folders()]).toEqual([[], []]);
	});

	it('shows only the built-in reports while the saved ones are not read', () => {
		const { page } = mount(ReportsLibraryPage, [
			{ provide: ReportsGateway, useValue: { saved: vi.fn(() => of()) } },
		]);
		expect(page.folders()).toEqual([]);
	});
});

const statement = (over: Record<string, unknown> = {}) => ({
	asAt: '2027-03-31',
	lastAsAt: '2026-03-31',
	code: 'PL-PROPRIETOR',
	name: 'Profit and loss (proprietorship)',
	version: 2,
	problems: ['report_source_unknown:ledger:freight_inward'],
	rows: [
		{ key: 'income', label: 'Income', depth: 0, thisYearPaise: 12_000_000, lastYearPaise: 10_000_000 },
		{ key: 'sales', label: 'Sales', depth: 1, thisYearPaise: 12_000_000, lastYearPaise: null },
		{ key: 'returns', label: 'Sales returns', depth: 2, thisYearPaise: -150_000, lastYearPaise: -100_000 },
	],
	...over,
});
const LOCATIONS = [
	{ id: 'l1', name: 'Barasat', active: true },
	{ id: 'l2', name: 'Old shop', active: false },
];

describe('a statement’s figures', () => {
	it('shows a credit-side figure with its sign, and a dash for none', () => {
		expect(statementFigure(null)).toBe('—');
		expect(statementFigure(150_000)).toBe('₹1,500.00');
		expect(statementFigure(-150_000)).toBe('−₹1,500.00');
		expect(statementFigure(0)).toBe('₹0.00');
	});

	it('indents a row by its depth, as Chart of accounts does, up to four steps', () => {
		expect([0, 1, 2, 3, 4, 9].map(indent)).toEqual(['ps-2', 'ps-4', 'ps-5', 'ps-5 ms-3', 'ps-5 ms-5', 'ps-5 ms-5']);
		expect(indent(-1)).toBe('ps-2');
	});

	it('writes the statement as a spreadsheet, with last year’s column only when it has one', () => {
		expect(statementCsv(statement() as never)).toEqual({
			header: ['', '2027-03-31', '2026-03-31'],
			rows: [
				['Income', 120_000, 100_000],
				['  Sales', 120_000, null],
				['    Sales returns', -1_500, -1_000],
			],
		});
		expect(statementCsv(statement({ lastAsAt: null }) as never)).toEqual({
			header: ['', '2027-03-31'],
			rows: [
				['Income', 120_000],
				['  Sales', 120_000],
				['    Sales returns', -1_500],
			],
		});
	});
});

describe('the statement page (U2)', () => {
	function open(gateway: Record<string, unknown>, route: Record<string, string> = { kind: 'profitLoss' }) {
		return mount(
			StatementPage,
			[
				{ provide: ReportsGateway, useValue: gateway },
				{ provide: LocationsGateway, useValue: { list: vi.fn(() => of(LOCATIONS)) } },
			],
			route,
		);
	}

	it('shows the kind asked for as at today, compared with last year-end, with what the books lack', async () => {
		const read = vi.fn(() => of(statement()));
		const { fixture, page } = open({ statement: read });
		await settle(fixture);
		expect(read).toHaveBeenCalledWith('profitLoss', { asAt: istToday() });
		expect(el(fixture, 'h5.mb-1')?.textContent).toContain('statement_pl_to');
		expect(el(fixture, 'small.text-muted')?.textContent).toContain('Profit and loss (proprietorship)');
		expect(fixture.nativeElement.textContent).toContain('statement_compared');
		expect(el(fixture, '.alert-warning')?.textContent).toContain('statement_source_missing');
		expect(all(fixture, 'thead th')).toHaveLength(3);
		const rows = all(fixture, 'tbody tr');
		expect(rows[0]?.querySelector('b')?.textContent).toContain('Income');
		expect(rows[1]?.querySelector('b')).toBeNull();
		expect(rows[1]?.querySelector('td')?.classList.contains('ps-4')).toBe(true);
		expect(rows[1]?.textContent).toContain('—');
		expect(rows[2]?.textContent).toContain('−₹1,500.00');
		expect(page.day('2027-03-31')).toBeTruthy();
	});

	it('reads one location, or none at all for a day not filled in', async () => {
		const read = vi.fn(() => of(statement({ lastAsAt: null, problems: [] })));
		const { fixture, page } = open({ statement: read });
		await settle(fixture);
		expect(all(fixture, '#statement_location option').map((o) => o.textContent?.trim())).toEqual([
			'statement_every_location',
			'Barasat',
		]);
		pick(el(fixture, '#statement_location'), 'l1');
		await settle(fixture);
		expect(read).toHaveBeenLastCalledWith('profitLoss', { asAt: istToday(), locationId: 'l1' });
		expect(all(fixture, 'thead th')).toHaveLength(2);
		expect(fixture.nativeElement.textContent).not.toContain('statement_compared');
		const calls = read.mock.calls.length;
		pick(el(fixture, '#statement_as_at'), '', 'input');
		await settle(fixture);
		expect(page.asAt()).toBe('');
		expect(read).toHaveBeenCalledTimes(calls);
	});

	it('opens the balance sheet when no kind is named, prints it, and saves it as a spreadsheet', async () => {
		const read = vi.fn(() => of(statement({ asAt: '2026-11-24' })));
		const { fixture } = open({ statement: read }, {});
		await settle(fixture);
		expect(read).toHaveBeenCalledWith('balanceSheet', expect.anything());
		expect(el(fixture, 'h5.mb-1')?.textContent).toContain('statement_bs_as_at');
		const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
		(el(fixture, '#statement_pdf') as HTMLButtonElement).click();
		expect(print).toHaveBeenCalled();
		print.mockRestore();
		(el(fixture, '#statement_excel') as HTMLButtonElement).click();
		expect(vi.mocked(downloadCsv).mock.lastCall?.[0]).toBe('Balance sheet_2026-11-24.csv');

		const pl = open({ statement: vi.fn(() => of(statement())) });
		await settle(pl.fixture);
		(el(pl.fixture, '#statement_excel') as HTMLButtonElement).click();
		expect(vi.mocked(downloadCsv).mock.lastCall?.slice(0, 2)).toEqual([
			'report_profit_loss_2027-03-31.csv',
			['', '2027-03-31', '2026-03-31'],
		]);
	});

	it('says when the statement cannot be read', async () => {
		const { fixture } = open({ statement: vi.fn(() => throwError(() => new Error('down'))) });
		await settle(fixture);
		expect(el(fixture, '.alert-warning')?.textContent).toContain('statement_problem');
		expect(el(fixture, '#statement_pdf')).toBeNull();
	});
});

const at = '2026-01-01T00:00:00.000Z';
const group = (id: string, name: string, parentId: string | null, order = 0) => ({
	id,
	name,
	parentId,
	order,
	nature: 'asset',
	createdAt: at,
	updatedAt: at,
});
const ledger = (id: string, name: string, groupId: string) => ({
	id,
	name,
	groupId,
	nature: 'asset',
	createdAt: at,
	updatedAt: at,
});
const CHART = {
	groups: [
		group('assets', 'Assets', null, 0),
		group('current', 'Current assets', 'assets'),
		group('liabilities', 'Liabilities', null, 1),
		group('income', 'Income', null, 2),
		group('expenses', 'Expenses', null, 3),
		group('direct', 'Direct expenses', 'expenses'),
		group('suspense', 'Suspense', null, 4),
	],
	ledgers: [
		ledger('cash', 'Cash', 'current'),
		ledger('bank', 'Bank', 'current'),
		ledger('capital', 'Capital', 'liabilities'),
		ledger('sales', 'Sales', 'income'),
		ledger('wages', 'Wages', 'direct'),
		ledger('in', 'Suspense in', 'suspense'),
		ledger('out', 'Suspense out', 'suspense'),
	],
};
const BALANCES = { cash: 500_000, capital: -520_000, wages: 20_000, in: 7_000, out: -7_000 };

describe('the trial balance’s rows (U4)', () => {
	it('shows each top group with a balance at group level, debit when positive and credit when negative', () => {
		expect(trialRows(CHART as never, BALANCES, 'group')).toEqual([
			{ name: 'Assets', depth: 0, debitPaise: 500_000, creditPaise: 0 },
			{ name: 'Liabilities', depth: 0, debitPaise: 0, creditPaise: 520_000 },
			{ name: 'Expenses', depth: 0, debitPaise: 20_000, creditPaise: 0 },
		]);
	});

	it('shows every ledger with a balance under its groups at ledger level, leaving out groups with none', () => {
		expect(trialRows(CHART as never, BALANCES, 'ledger')).toEqual([
			{ name: 'Assets', depth: 0, debitPaise: 0, creditPaise: 0 },
			{ name: 'Current assets', depth: 1, debitPaise: 0, creditPaise: 0 },
			{ name: 'Cash', depth: 2, debitPaise: 500_000, creditPaise: 0 },
			{ name: 'Liabilities', depth: 0, debitPaise: 0, creditPaise: 0 },
			{ name: 'Capital', depth: 1, debitPaise: 0, creditPaise: 520_000 },
			{ name: 'Expenses', depth: 0, debitPaise: 0, creditPaise: 0 },
			{ name: 'Direct expenses', depth: 1, debitPaise: 0, creditPaise: 0 },
			{ name: 'Wages', depth: 2, debitPaise: 20_000, creditPaise: 0 },
			{ name: 'Suspense', depth: 0, debitPaise: 0, creditPaise: 0 },
			{ name: 'Suspense in', depth: 1, debitPaise: 7_000, creditPaise: 0 },
			{ name: 'Suspense out', depth: 1, debitPaise: 0, creditPaise: 7_000 },
		]);
	});
});

describe('the trial balance page (U4)', () => {
	function open(balances = vi.fn((on: string) => of(on ? BALANCES : {}))) {
		const harness = mount(TrialBalancePage, [
			{ provide: LedgerGateway, useValue: { chart: vi.fn(() => of(CHART)), balances } },
		]);
		return { ...harness, balances };
	}

	it('totals the group level as at today, switches to ledger level, and saves the rows as a spreadsheet', async () => {
		const { fixture, page, balances } = open();
		expect(page.rows()).toEqual([]);
		await settle(fixture);
		expect(balances).toHaveBeenCalledWith(istToday());
		expect(page.totals()).toEqual({ debit: 520_000, credit: 520_000 });
		expect([page.money(0), page.money(520_000)]).toEqual(['', '₹5,200.00']);
		const rows = all(fixture, 'tbody tr');
		expect(rows).toHaveLength(4);
		expect(rows[3]?.textContent).toContain('total');
		expect(rows[3]?.textContent).toContain('₹5,200.00');
		pick(el(fixture, '#tb_level'), 'ledger');
		await settle(fixture);
		expect(page.level()).toBe('ledger');
		expect(all(fixture, 'tbody tr')).toHaveLength(12);
		expect(all(fixture, 'tbody td')[0]?.classList.contains('ps-2')).toBe(true);
		(el(fixture, '#tb_excel') as HTMLButtonElement).click();
		const [name, header, csv] = vi.mocked(downloadCsv).mock.lastCall as [string, string[], unknown[][]];
		expect([name, header]).toEqual([`trial-balance_${istToday()}.csv`, ['', 'accounts_debit', 'accounts_credit']]);
		expect(csv.slice(0, 3)).toEqual([
			['Assets', null, null],
			['  Current assets', null, null],
			['    Cash', 5_000, null],
		]);
		expect(csv[4]).toEqual(['  Capital', null, 5_200]);
		expect(page.day(istToday())).toBeTruthy();
	});

	it('reads no balances for a day not filled in', async () => {
		const { fixture, page, balances } = open();
		await settle(fixture);
		const calls = balances.mock.calls.length;
		pick(el(fixture, '#tb_as_at'), '', 'input');
		await settle(fixture);
		expect(page.asAt()).toBe('');
		expect(balances).toHaveBeenCalledTimes(calls);
	});
});

const PL = {
	from: '2026-04-01',
	to: '2027-03-31',
	code: 'PL-PROPRIETOR',
	name: 'Profit and loss',
	locations: [
		{ id: 'l1', name: 'Barasat' },
		{ id: 'ho', name: 'Head office' },
	],
	rows: [
		{ key: 'income', label: 'Income', depth: 0, side: 'credit', byLocation: { l1: 900_000 }, totalPaise: 900_000 },
		{
			key: 'rent',
			label: 'Rent',
			depth: 1,
			side: 'debit',
			byLocation: { l1: -50_000, ho: -30_000 },
			totalPaise: -80_000,
		},
	],
};

describe('profit and loss by location (U3)', () => {
	it('reads this financial year, then the period picked, and saves each location and the total as a spreadsheet', async () => {
		const read = vi.fn(() => of(PL));
		const { fixture, page } = mount(PlByLocationPage, [
			{ provide: ReportsGateway, useValue: { plByLocation: read } },
		]);
		await settle(fixture);
		expect(read).toHaveBeenCalledWith(accountsRange({ period: 'this_fy' }));
		const rows = all(fixture, 'tbody tr');
		expect(rows[0]?.querySelector('b')?.textContent).toContain('Income');
		expect(rows[0]?.textContent).toContain('₹0.00');
		expect(rows[1]?.querySelector('b')).toBeNull();
		expect(rows[1]?.textContent).toContain('−₹800.00');
		expect(all(fixture, 'thead th').map((th) => th.textContent?.trim())).toEqual([
			'statement_particulars',
			'Barasat',
			'Head office',
			'total',
		]);
		page.setPeriod({ period: 'custom', from: '2026-10-01', to: '2026-10-31' });
		await settle(fixture);
		expect(read).toHaveBeenLastCalledWith({ from: '2026-10-01', to: '2026-10-31' });
		(el(fixture, '#plloc_excel') as HTMLButtonElement).click();
		expect(vi.mocked(downloadCsv).mock.lastCall).toEqual([
			'pl-by-location_2026-04-01_2027-03-31.csv',
			['', 'Barasat', 'Head office', 'total'],
			[
				['Income', 9_000, 0, 9_000],
				['  Rent', -500, -300, -800],
			],
		]);
	});

	it('says when the report cannot be read', async () => {
		const { fixture } = mount(PlByLocationPage, [
			{ provide: ReportsGateway, useValue: { plByLocation: vi.fn(() => throwError(() => new Error('down'))) } },
		]);
		await settle(fixture);
		expect(el(fixture, '.alert-warning')?.textContent).toContain('statement_problem');
		expect(el(fixture, '#plloc_excel')).toBeNull();
	});
});
