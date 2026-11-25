import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { PayrollGateway } from '@core/accounts/payroll.gateway';
import { LocationsGateway } from '@core/locations/locations.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { PayrollRunPage } from './payroll-run-page';

import type { PayrollRun } from '@saha-textile/contracts';

/** A month's run with each row's State (brief 25 ST1): its rules column, and Approve held while a State has none. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};

const row = (employeeId: string, over: Record<string, unknown> = {}) => ({
	employeeId,
	name: 'Asha Das',
	locationId: 'l1',
	paidDays: 30,
	grossPaise: 3_200_000,
	pfEmployeePaise: 192_000,
	esiEmployeePaise: 0,
	ptPaise: 20_000,
	tdsPaise: 0,
	advancePaise: 0,
	netPaise: 2_988_000,
	...over,
});
const run = (over: Record<string, unknown> = {}) => ({
	month: '2026-11',
	status: 'draft',
	rows: [row('e1', { stateCode: '19' }), row('e2', { name: 'Rafiq Ali', locationId: 'l9' })],
	version: 3,
	voucherId: null,
	payVoucherId: null,
	...over,
});

function mount(current: ReturnType<typeof run>) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			PayrollRunPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			provideRouter([]),
			{
				provide: PayrollGateway,
				useValue: {
					run: vi.fn(() => of(current)),
					attendance: vi.fn(() => of({ lockedAt: '2026-12-01T05:30:00.000Z' })),
					prepare: vi.fn(() => of(current)),
					step: vi.fn(() => of(current)),
				},
			},
			{ provide: LedgerGateway, useValue: { chart: vi.fn(() => of({ groups: [], ledgers: [] })) } },
			{
				provide: LocationsGateway,
				useValue: { list: vi.fn(() => of([{ id: 'l1', name: 'Barasat', active: true }])) },
			},
			{ provide: NotificationService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
			{
				provide: AuthStore,
				useValue: {
					permissions: signal(['accounts.index', 'accounts.edit', 'accounts.lock', 'accounts.post']),
				},
			},
		],
	});
	const fixture = TestBed.createComponent(PayrollRunPage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance };
}

async function opened(current: ReturnType<typeof run>) {
	const harness = mount(current);
	await settle(harness.fixture);
	return harness;
}

const el = <T extends HTMLElement = HTMLElement>(fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as T | null;
const bodyRows = (fixture: { nativeElement: HTMLElement }) =>
	[...fixture.nativeElement.querySelectorAll('tbody tr')] as HTMLElement[];
const cells = (row: Element | undefined) =>
	[...(row?.querySelectorAll('td') ?? [])].map((cell) => cell.textContent?.trim() ?? '');

describe('the payroll run’s States (ST1)', () => {
	it('names each row’s State, or a dash when the row has none, and lets a run with every State approve', async () => {
		const { fixture, page } = await opened(run());
		expect([...fixture.nativeElement.querySelectorAll('thead th')].map((th) => th.textContent?.trim())).toContain(
			'payroll_col_state',
		);
		const [asha, rafiq, total] = bodyRows(fixture);
		expect(cells(asha).slice(1, 3)).toEqual(['Barasat', 'West Bengal']);
		expect(cells(rafiq)[2]).toBe('—');
		expect(total?.querySelector('td')?.getAttribute('colspan')).toBe('4');
		expect(el(fixture, '#run_states_missing')).toBeNull();
		expect(el<HTMLButtonElement>(fixture, '#run_approve')?.disabled).toBe(false);
		expect(page.statesMissing(run() as unknown as PayrollRun)).toBe('');
	});

	it('warns of the States with no payroll rules, by name, and holds Approve until they have them', async () => {
		const missing = run({ statesMissing: ['29', '99'] });
		const { fixture, page } = await opened(missing);
		expect(el(fixture, '#run_states_missing')?.textContent).toContain('payroll_state_missing');
		expect(el(fixture, '#run_states_missing')?.classList.contains('alert-warning')).toBe(true);
		expect(page.statesMissing(missing as unknown as PayrollRun)).toBe('Karnataka, 99');
		expect(el<HTMLButtonElement>(fixture, '#run_approve')?.disabled).toBe(true);
	});

	it('has no warning for an empty list, and spans the new column when there are no rows', async () => {
		const { fixture } = await opened(run({ rows: [], statesMissing: [] }));
		expect(el(fixture, '#run_states_missing')).toBeNull();
		expect(el(fixture, 'tbody td[colspan]')?.getAttribute('colspan')).toBe('11');
		expect(el<HTMLButtonElement>(fixture, '#run_approve')?.disabled).toBe(true);
	});
});
