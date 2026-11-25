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

/** An edited payslip on the run (brief 26 PE1): marked edited with its checks, and edited from a draft run. */

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

function mount(
	current: ReturnType<typeof run>,
	permissions = ['accounts.index', 'accounts.edit', 'accounts.lock', 'accounts.post'],
) {
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
				useValue: { permissions: signal(permissions) },
			},
		],
	});
	const fixture = TestBed.createComponent(PayrollRunPage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance };
}

async function opened(current: ReturnType<typeof run>, permissions?: string[]) {
	const harness = mount(current, permissions);
	await settle(harness.fixture);
	return harness;
}

const el = <T extends HTMLElement = HTMLElement>(fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as T | null;
const bodyRows = (fixture: { nativeElement: HTMLElement }) =>
	[...fixture.nativeElement.querySelectorAll('tbody tr')] as HTMLElement[];

describe('an edited payslip on the run (PE1)', () => {
	const edited = () =>
		run({
			rows: [
				row('e1', {
					stateCode: '19',
					edits: { heads: { basic: 1_100_000 }, added: [], deductions: {}, reasons: {} },
					checks: [
						{ code: 'pf_below_law', blocking: true, line: 'pf' },
						{ code: 'reason_needed', blocking: false, line: 'basic' },
					],
				}),
				row('e2', { name: 'Rafiq Ali', stateCode: '19' }),
			],
		});
	const lastCells = (tr: Element | undefined) => [...(tr?.querySelectorAll('td') ?? [])].slice(-2) as HTMLElement[];

	it('marks an edited payslip and each of its checks, blocking or warning, and links each draft row to Edit', async () => {
		const { fixture } = await opened(edited());
		const [marks, link] = lastCells(bodyRows(fixture)[0]);
		expect([...(marks?.querySelectorAll('.badge') ?? [])].map((b) => [b.textContent?.trim(), b.className])).toEqual(
			[
				['pe_edited', 'badge bg-light text-dark me-1 border'],
				['✖', 'badge bg-danger me-1'],
				['⚠', 'badge bg-warning text-dark me-1'],
			],
		);
		const edit = el<HTMLAnchorElement>(fixture, '#run_edit_e1') as HTMLAnchorElement;
		expect([link?.contains(edit), edit.getAttribute('href'), edit.title]).toEqual([
			true,
			'/payroll/runs/2026-11/payslips/e1/edit',
			'pe_title',
		]);
		expect(lastCells(bodyRows(fixture)[1])[0]?.querySelectorAll('.badge').length).toBe(0);
		expect(el(fixture, '#run_edit_e2')).not.toBeNull();
	});

	it('offers no Edit on a run past draft, nor to someone who may not edit', async () => {
		const approved = await opened(run({ ...edited(), status: 'approved' }));
		expect(el(approved.fixture, '#run_edit_e1')).toBeNull();
		const viewer = await opened(edited(), ['accounts.index']);
		expect(el(viewer.fixture, '#run_edit_e1')).toBeNull();
	});
});
