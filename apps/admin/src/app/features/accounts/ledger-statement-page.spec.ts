import { provideHttpClient } from '@angular/common/http';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { LocationsGateway } from '@core/locations/locations.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { PeriodPicker } from '@shared/ui/period-picker/period-picker';

import { periodRange } from './edoc-list';
import { drCr, rupees } from './ledger-helpers';
import { LedgerStatementPage } from './ledger-statement';

/** Accounts › Ledgers › one ledger (accounts brief Q2): opening, each entry with a running balance, closing. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const entry = (n: number, over: Record<string, unknown> = {}) => ({
	date: '2026-11-01',
	voucherId: `jv_${n}`,
	number: `JV/26-27/${String(n).padStart(6, '0')}`,
	narration: `Rent ${n}`,
	locationId: 'loc_b',
	debitPaise: 1_000_00,
	creditPaise: 0,
	balancePaise: n * 1_000_00,
	...over,
});
const statement = (rows: unknown[]) => ({
	ledger: { id: 'rent', name: 'Rent "shop"', groupId: 'g_exp' },
	from: '2025-11-26',
	to: '2026-11-25',
	openingPaise: -5_000_00,
	rows,
	debitPaise: 30_000_00,
	creditPaise: 5_000_00,
	closingPaise: 20_000_00,
});

function mount(rows: unknown[], id: string | null = 'rent') {
	TestBed.resetTestingModule();
	const calls = {
		statement: vi.fn(() => of(statement(rows))),
		chart: vi.fn(() => of({ groups: [{ id: 'g_exp', name: 'Indirect expenses' }], ledgers: [] })),
	};
	TestBed.configureTestingModule({
		imports: [
			LedgerStatementPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			provideRouter([]),
			{ provide: LedgerGateway, useValue: calls },
			{ provide: NotificationService, useValue: { showError: vi.fn(), showSuccess: vi.fn() } },
			provideHttpClient(),
			{
				provide: LocationsGateway,
				useValue: {
					list: vi.fn(() =>
						of([
							{ id: 'loc_b', name: 'Barasat', active: true },
							{ id: 'loc_h', name: 'Head office', active: true },
						]),
					),
				},
			},
			{ provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap(id ? { id } : {})) } },
		],
	});
	// The period picker is its own component; its choice reaches the page through setPeriod.
	TestBed.overrideComponent(LedgerStatementPage, {
		remove: { imports: [PeriodPicker] },
		add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
	});
	const fixture = TestBed.createComponent(LedgerStatementPage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, calls };
}
async function opened(rows: unknown[], id?: string | null) {
	const harness = mount(rows, id);
	await settle(harness.fixture);
	return harness;
}

const el = <T extends HTMLElement = HTMLElement>(fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as T | null;
const bodyRows = (fixture: { nativeElement: HTMLElement }) =>
	[...fixture.nativeElement.querySelectorAll('tbody tr')] as HTMLElement[];
const cells = (row: HTMLElement | undefined) =>
	[...(row?.querySelectorAll('td') ?? [])].map((td) => td.textContent?.replace(/\s+/g, ' ').trim() ?? '');
const lastAsked = (calls: { statement: ReturnType<typeof vi.fn> }) =>
	calls.statement.mock.lastCall as unknown as [string, string, string, string[]];
const enter = async (
	fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void },
	box: Element | null,
	value: string,
) => {
	(box as HTMLInputElement).value = value;
	box?.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
	await settle(fixture);
};

afterEach(() => vi.restoreAllMocks());

describe('a ledger’s statement (Q2)', () => {
	it('reads the last twelve months at every location, with the ledger’s group, the four totals and each entry', async () => {
		const { fixture, calls } = await opened([
			entry(1),
			entry(2, {
				narration: '',
				locationId: 'gone',
				debitPaise: 0,
				creditPaise: 5_000_00,
				balancePaise: -4_000_00,
			}),
		]);
		const [id, from, to, locations] = lastAsked(calls);
		expect([id, from, locations]).toEqual(['rent', periodRange({ period: 'last_12_months' }).from, []]);
		expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(el(fixture, 'h5.mb-0')?.textContent).toContain('Rent "shop"');
		expect(el(fixture, 'h5.mb-0 small')?.textContent?.trim()).toBe('Indirect expenses');
		expect(
			[...fixture.nativeElement.querySelectorAll('.small.d-flex b')].map((b) => b.textContent?.trim()),
		).toEqual([drCr(-5_000_00), rupees(30_000_00), rupees(5_000_00), drCr(20_000_00)]);
		expect(cells(bodyRows(fixture)[0])).toEqual([
			'1 Nov 2026',
			'JV/26-27/000001',
			'Rent 1 Barasat',
			rupees(1_000_00),
			'',
			drCr(1_000_00),
		]);
		expect(cells(bodyRows(fixture)[1])).toEqual([
			'1 Nov 2026',
			'JV/26-27/000002',
			'—',
			'',
			rupees(5_000_00),
			drCr(-4_000_00),
		]);
		expect(el(fixture, 'a[href="/accounts/vouchers/jv_1"]')).not.toBeNull();
	});

	it('reads one location, a new period from the first page, and the month so far when a period has no days', async () => {
		const { fixture, page, calls } = await opened([entry(1)]);
		expect([...(el<HTMLSelectElement>(fixture, '#ledger_location')?.options ?? [])].map((o) => o.value)).toEqual([
			'',
			'loc_b',
			'loc_h',
		]);
		await enter(fixture, el(fixture, '#ledger_location'), 'loc_h');
		expect(lastAsked(calls)[3]).toEqual(['loc_h']);
		page.page.set(2);
		page.setPeriod({ period: 'custom', from: '2026-04-01', to: '2026-06-30' });
		await settle(fixture);
		expect(lastAsked(calls).slice(1, 3)).toEqual(['2026-04-01', '2026-06-30']);
		expect(page.page()).toBe(1);
		page.setPeriod({ period: 'custom' } as never);
		await settle(fixture);
		expect(lastAsked(calls)[1]).toMatch(/^\d{4}-\d{2}-01$/);
	});

	it('searches the voucher numbers and narrations as typed, and pages twenty-five entries at a time', async () => {
		const { fixture, page } = await opened(Array.from({ length: 30 }, (_, i) => entry(i + 1)));
		expect(page.pages()).toBe(2);
		expect(bodyRows(fixture)).toHaveLength(25);
		(fixture.nativeElement.querySelectorAll('.page-link')[1] as HTMLElement).click();
		await settle(fixture);
		expect(bodyRows(fixture).map((row) => cells(row)[1])).toEqual(
			Array.from({ length: 5 }, (_, i) => `JV/26-27/${String(26 + i).padStart(6, '0')}`),
		);
		await enter(fixture, el(fixture, '#ledger_search'), '  RENT 3 ');
		expect(page.page()).toBe(1);
		expect(page.rows().map((r) => r.number)).toEqual(['JV/26-27/000003', 'JV/26-27/000030']);
		await enter(fixture, el(fixture, '#ledger_search'), 'nothing like it');
		expect(cells(bodyRows(fixture)[0])).toEqual(['accounts_no_entries']);
		expect(fixture.nativeElement.querySelector('.pagination')).toBeNull();
	});

	it('gives the Export menu every entry in view, named for the ledger and the period, with its filters', async () => {
		const { page, fixture } = await opened([
			entry(1, { narration: 'Rent "Nov"' }),
			entry(2, { locationId: 'gone' }),
		]);
		expect(el<HTMLElement>(fixture, '#ledger_export')).toBeTruthy();
		const source = page.exportSource();
		expect(source?.fileName).toBe('Rent "shop"-2025-11-26-2026-11-25');
		expect(source?.header).toHaveLength(7);
		expect(source?.rows).toEqual([
			['2026-11-01', 'JV/26-27/000001', 'Rent "Nov"', 'Barasat', 1000, 0, 1000],
			['2026-11-01', 'JV/26-27/000002', 'Rent 2', '', 1000, 0, 2000],
		]);
		expect(source?.filters).toHaveLength(1);
		page.locationId.set('loc_b');
		page.search.set(' Rent ');
		expect(page.exportSource()?.filters).toHaveLength(3);
		expect(source?.kinds).toEqual({ 4: 'money', 5: 'money', 6: 'money' });
	});

	it('reads nothing without a ledger, and saves nothing before its statement is read', () => {
		const { page, calls } = mount([], null);
		expect(page.id()).toBe('');
		expect(calls.statement).not.toHaveBeenCalled();
		expect(page.exportSource()).toBeNull();
		expect([page.groupName(), page.rows(), page.locationName('loc_b')]).toEqual(['', [], '']);
	});
});
