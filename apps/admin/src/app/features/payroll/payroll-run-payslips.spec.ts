import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { PayrollGateway } from '@core/accounts/payroll.gateway';
import { LocationsGateway } from '@core/locations/locations.gateway';
import { saveBlob } from '@core/purchasing/purchasing-format';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { currentMonth } from './attendance-page';
import { PayrollRunPage } from './payroll-run-page';

vi.mock('@core/purchasing/purchasing-format', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing-format')>()),
	saveBlob: vi.fn(),
}));

/** A run's payslips in one PDF on the active payslip format (brief 25 PS4), from Payroll › Payroll runs. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const refusal = (code: string) => ({ error: { message: code } });
const row = (employeeId: string) => ({
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
});
const run = (rows: unknown[]) => ({
	month: '2026-11',
	status: 'posted',
	rows,
	version: 3,
	voucherId: 'jv1',
	payVoucherId: null,
});
const PDF = new Blob(['%PDF'], { type: 'application/pdf' });

async function opened(gateway: Record<string, unknown> = {}) {
	TestBed.resetTestingModule();
	vi.mocked(saveBlob).mockClear();
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const calls = {
		run: vi.fn(() => of(run([row('e1'), row('e2')]))),
		attendance: vi.fn(() => of({ lockedAt: '2026-12-01T05:30:00.000Z' })),
		bonusYear: vi.fn(() =>
			of({ year: '2026-27', ratePct: 8.33, rows: [], providedPaise: 0, duePaise: 0, paidVoucherId: null }),
		),
		payslipsPdf: vi.fn(() => of(PDF)),
		...gateway,
	};
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
			{ provide: PayrollGateway, useValue: calls },
			{ provide: LedgerGateway, useValue: { chart: vi.fn(() => of({ groups: [], ledgers: [] })) } },
			{ provide: LocationsGateway, useValue: { list: vi.fn(() => of([])) } },
			{ provide: NotificationService, useValue: notifier },
			{ provide: AuthStore, useValue: { permissions: signal(['accounts.index']) } },
		],
	});
	const fixture = TestBed.createComponent(PayrollRunPage);
	fixture.detectChanges();
	await settle(fixture);
	return { fixture, page: fixture.componentInstance, notifier, calls };
}

const payslips = (fixture: { nativeElement: HTMLElement }) =>
	fixture.nativeElement.querySelector('#run_payslips') as HTMLButtonElement | null;

describe('printing a run’s payslips (PS4)', () => {
	it('offers every payslip of a run with people on it, and saves them as one PDF named for the month', async () => {
		const { fixture, calls } = await opened();
		expect(payslips(fixture)?.textContent).toContain('payroll_print_payslips');
		expect(payslips(fixture)?.querySelector('i.ri-printer-line')).not.toBeNull();
		payslips(fixture)?.click();
		await settle(fixture);
		expect(calls.payslipsPdf).toHaveBeenCalledWith(currentMonth());
		expect(saveBlob).toHaveBeenCalledWith(`payslips-${currentMonth()}.pdf`, PDF);
	});

	it('names a refusal to make them, or says it simply failed, and saves nothing', async () => {
		const payslipsPdf = vi
			.fn()
			.mockReturnValueOnce(throwError(() => refusal('payroll_no_run')))
			.mockReturnValueOnce(throwError(() => new Error('down')));
		const { page, notifier } = await opened({ payslipsPdf });
		await page.printPayslips();
		expect(notifier.showError).toHaveBeenLastCalledWith('payroll_problem_payroll_no_run');
		await page.printPayslips();
		expect(notifier.showError).toHaveBeenLastCalledWith('payroll_problem_failed');
		expect(saveBlob).not.toHaveBeenCalled();
	});

	it('has nothing to print for a run with nobody on it, nor before one is prepared', async () => {
		const empty = await opened({ run: vi.fn(() => of(run([]))) });
		expect(payslips(empty.fixture)).toBeNull();
		const none = await opened({ run: vi.fn(() => throwError(() => refusal('payroll_no_run'))) });
		expect(payslips(none.fixture)).toBeNull();
	});
});
