import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ReportsGateway } from '@core/accounts/reports.gateway';
import { downloadCsv } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { accountsRange } from '@features/accounts/accounts-period';

import { AGEING_BUCKETS, AgeingPage } from './ageing-page';
import { AUDIT_CHIPS, AuditPage, whenText } from './audit-page';

vi.mock('@core/purchasing/purchasing-format', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing-format')>()),
	downloadCsv: vi.fn(),
}));

/** Outstanding with ageing (accounts brief U5) and the audit report of the books (U8). */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};

function mount<T>(component: Type<T>, gateway: Record<string, unknown>, route: Record<string, string> = {}) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			component,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			provideRouter([]),
			provideHttpClient(),
			provideHttpClientTesting(),
			{ provide: NotificationService, useValue: { showError: vi.fn(), showSuccess: vi.fn() } },
			{ provide: ReportsGateway, useValue: gateway },
			{ provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap(route)) } },
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
const type = (control: HTMLElement | null, value: string) => {
	(control as HTMLInputElement).value = value;
	(control as HTMLInputElement).dispatchEvent(new Event('input'));
};

const buckets = (notDue: number, d30: number, d60: number, d90: number, over: number) => ({
	notDue,
	days1to30: d30,
	days31to60: d60,
	days61to90: d90,
	over90: over,
	total: notDue + d30 + d60 + d90 + over,
});
const AGEING = {
	side: 'suppliers',
	asAt: '2026-11-24',
	rows: [
		{ partyId: 'p1', name: 'Nadia Weavers', ...buckets(100_000, 0, 50_000, 0, 0) },
		{ partyId: 'p2', name: 'Shantipur Looms', ...buckets(0, 25_000, 0, 0, 300_000) },
	],
	totals: buckets(100_000, 25_000, 50_000, 0, 300_000),
};

describe('outstanding with ageing (U5)', () => {
	it('reads the side asked for, each party in its buckets, a dash for nothing, and the totals in bold', async () => {
		const ageing = vi.fn(() => of(AGEING));
		const { fixture, page } = mount(AgeingPage, { ageing }, { side: 'suppliers' });
		await settle(fixture);
		expect([...AGEING_BUCKETS]).toEqual(['notDue', 'days1to30', 'days31to60', 'days61to90', 'over90', 'total']);
		expect(ageing).toHaveBeenCalledWith('suppliers');
		expect([page.money(0), page.money(150_000)]).toEqual(['—', '₹1,500.00']);
		const rows = all(fixture, 'tbody tr');
		expect(rows).toHaveLength(3);
		const cells = (row: HTMLElement | undefined) => [...(row?.querySelectorAll('td') ?? [])] as HTMLElement[];
		expect(cells(rows[0]).map((td) => td.textContent?.trim())).toEqual([
			'Nadia Weavers',
			'₹1,000.00',
			'—',
			'₹500.00',
			'—',
			'—',
			'₹1,500.00',
		]);
		expect(cells(rows[0])[6]?.classList.contains('fw-bold')).toBe(true);
		expect(cells(rows[0])[1]?.classList.contains('fw-bold')).toBe(false);
		expect(cells(rows[2])[0]?.textContent?.trim()).toBe('total');
		expect(cells(rows[2])[6]?.textContent?.trim()).toBe('₹4,750.00');
		expect(page.day('2026-11-24')).toBeTruthy();
	});

	it('narrows the parties to what is typed, and says when none is left', async () => {
		const { fixture, page } = mount(AgeingPage, { ageing: vi.fn(() => of(AGEING)) });
		await settle(fixture);
		type(el(fixture, '#ageing_find'), '  NADIA ');
		await settle(fixture);
		expect(page.rows().map((r) => r.name)).toEqual(['Nadia Weavers']);
		type(el(fixture, '#ageing_find'), 'Ranaghat');
		await settle(fixture);
		expect(page.rows()).toEqual([]);
		expect(el(fixture, 'tbody td[colspan="7"]')?.textContent).toContain('ageing_none');
	});

	it('opens the customers’ side when no side is named, and has no rows before the report is read', () => {
		const ageing = vi.fn(() => of(AGEING));
		const { page } = mount(AgeingPage, { ageing });
		expect(page.side()).toBe('customers');
		expect(page.rows()).toEqual([]);
	});

	it('saves every party and the total as a spreadsheet in rupees', async () => {
		const { fixture, page } = mount(AgeingPage, { ageing: vi.fn(() => of(AGEING)) }, { side: 'suppliers' });
		await settle(fixture);
		// EX1: the Export menu takes what the CSV would have saved.
		expect(el(fixture, '#ageing_export')).not.toBeNull();
		expect(page.exportSource(AGEING as never)()).toMatchObject({
			fileName: 'suppliers-ageing_2026-11-24.csv',
			area: 'accounts',
		});
		page.download(AGEING as never);
		expect(vi.mocked(downloadCsv).mock.lastCall).toEqual([
			'suppliers-ageing_2026-11-24.csv',
			[
				'ageing_party',
				'ageing_notDue',
				'ageing_days1to30',
				'ageing_days31to60',
				'ageing_days61to90',
				'ageing_over90',
				'ageing_total',
			],
			[
				['Nadia Weavers', 1_000, 0, 500, 0, 0, 1_500],
				['Shantipur Looms', 0, 250, 0, 0, 3_000, 3_250],
				['total', 1_000, 250, 500, 0, 3_000, 4_750],
			],
		]);
	});

	it('says when the report cannot be read', async () => {
		const { fixture } = mount(AgeingPage, { ageing: vi.fn(() => throwError(() => new Error('down'))) });
		await settle(fixture);
		expect(el(fixture, '.alert-warning')?.textContent).toContain('statement_problem');
		expect(el(fixture, '#ageing_export')).toBeNull();
	});
});

const row = (id: string, over: Record<string, unknown> = {}) => ({
	id,
	at: '2026-11-24T10:45:00.000Z',
	who: 'Asha',
	action: 'invoice.cancelled',
	entityType: 'invoice',
	entityId: 'INV/26-27/000041',
	detail: 'Customer returned the order',
	...over,
});
const AUDIT = {
	rows: [row('a1'), row('a2', { who: '', detail: '', entityType: null, entityId: null, action: 'period.unlocked' })],
	total: 120,
	counts: { all: 120, edits: 40, backdated: 3, cancelled: 12, unlocks: 1, takeovers: 0, superAdmin: 2 },
};

describe('the audit report (U8)', () => {
	it('words when a change was made in India’s time, and counts pages of fifty', () => {
		expect(whenText('2026-11-24T10:45:00.000Z')).toMatch(/24 Nov.*16:15/);
		expect([...AUDIT_CHIPS]).toEqual([
			'all',
			'edits',
			'backdated',
			'cancelled',
			'unlocks',
			'takeovers',
			'superAdmin',
		]);
		const { page } = mount(AuditPage, { audit: vi.fn(() => of(AUDIT)) });
		expect([page.pages(0), page.pages(50), page.pages(51), page.pages(120)]).toEqual([[1], [1], [1, 2], [1, 2, 3]]);
	});

	it('reads this month’s changes with the counts per kind, and dashes for no who or no detail', async () => {
		const audit = vi.fn(() => of(AUDIT));
		const { fixture } = mount(AuditPage, { audit });
		await settle(fixture);
		expect(audit).toHaveBeenCalledWith({ ...accountsRange({ period: 'this_month' }), chip: 'all', page: 1 });
		expect(el(fixture, '#audit_chip_cancelled')?.textContent).toContain('12');
		const rows = all(fixture, 'tbody tr');
		const cells = (r: HTMLElement | undefined) =>
			[...(r?.querySelectorAll('td') ?? [])].map((td) => td.textContent?.trim());
		expect(cells(rows[0])).toEqual([
			whenText('2026-11-24T10:45:00.000Z'),
			'Asha',
			'invoice INV/26-27/000041',
			'invoice.cancelled',
			'Customer returned the order',
		]);
		expect(cells(rows[1])).toEqual([whenText('2026-11-24T10:45:00.000Z'), '—', '', 'period.unlocked', '—']);
	});

	it('goes back to page one on a new kind, period or search, and searches only for words typed', async () => {
		const audit = vi.fn(() => of(AUDIT));
		const { fixture, page } = mount(AuditPage, { audit });
		await settle(fixture);
		const pager = () => all(fixture, '.justify-content-center button');
		expect(pager().map((b) => b.textContent?.trim())).toEqual(['1', '2', '3']);
		pager()[1]?.click();
		await settle(fixture);
		expect(page.page()).toBe(2);
		expect(audit).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
		(el(fixture, '#audit_chip_edits') as HTMLButtonElement).click();
		expect([page.chip(), page.page()]).toEqual(['edits', 1]);
		page.page.set(3);
		page.setPeriod({ period: 'custom', from: '2026-10-01', to: '2026-10-31' });
		expect([page.range(), page.page()]).toEqual([{ from: '2026-10-01', to: '2026-10-31' }, 1]);
		page.page.set(2);
		type(el(fixture, '#audit_find'), ' INV/41 ');
		expect(page.page()).toBe(1);
		await settle(fixture);
		expect(audit).toHaveBeenLastCalledWith({
			from: '2026-10-01',
			to: '2026-10-31',
			chip: 'edits',
			page: 1,
			q: 'INV/41',
		});
		type(el(fixture, '#audit_find'), '   ');
		await settle(fixture);
		expect(audit).toHaveBeenLastCalledWith({ from: '2026-10-01', to: '2026-10-31', chip: 'edits', page: 1 });
	});

	it('says when nothing matches, with no pages, and when the report cannot be read', async () => {
		const none = mount(AuditPage, { audit: vi.fn(() => of({ rows: [], total: 0, counts: {} })) });
		await settle(none.fixture);
		expect(none.fixture.nativeElement.textContent).toContain('audit_none');
		expect(all(none.fixture, '.justify-content-center button')).toHaveLength(0);
		expect(el(none.fixture, '#audit_chip_all')?.textContent).toContain('0');

		const failed = mount(AuditPage, { audit: vi.fn(() => throwError(() => new Error('down'))) });
		await settle(failed.fixture);
		expect(el(failed.fixture, '.alert-warning')?.textContent).toContain('statement_problem');
	});

	it('exports every matching change for the CA, with the search only when one is typed', async () => {
		const audit = vi.fn(() => of(AUDIT));
		const { fixture, page } = mount(AuditPage, { audit });
		await settle(fixture);
		const { from, to } = page.range();
		// EX1: the Export menu fetches the rows through the same code, then the CSV still writes them.
		expect(el(fixture, '#audit_export')).not.toBeNull();
		expect((await page.exportSource())?.fileName).toBe(`audit_${from}_${to}.csv`);
		await page.export();
		expect(audit).toHaveBeenLastCalledWith({ from, to, chip: 'all', page: 1, pageSize: 500 });
		expect(vi.mocked(downloadCsv).mock.lastCall).toEqual([
			`audit_${from}_${to}.csv`,
			['audit_when', 'audit_who', 'audit_document', 'audit_what', 'audit_detail'],
			[
				[
					'2026-11-24T10:45:00.000Z',
					'Asha',
					'invoice INV/26-27/000041',
					'invoice.cancelled',
					'Customer returned the order',
				],
				['2026-11-24T10:45:00.000Z', '', '', 'period.unlocked', ''],
			],
		]);
		page.pick('cancelled');
		page.q.set(' Nadia ');
		await page.export();
		expect(audit).toHaveBeenLastCalledWith({ from, to, chip: 'cancelled', page: 1, pageSize: 500, q: 'Nadia' });
	});
});
