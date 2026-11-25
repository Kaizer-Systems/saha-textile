import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { PayrollGateway } from '@core/accounts/payroll.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { PayslipPage } from './payslip-page';

/** A payslip's own number (brief 25 PS): shown after the month once the payslip is numbered. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const payslip = (payslipNo: string | null) => ({
	month: '2026-11',
	company: 'K.R. Marketing',
	employeeId: 'e1',
	name: 'Asha Das',
	code: 'E-001',
	location: 'Barasat',
	uan: '100200300400',
	daysInMonth: 30,
	paidDays: 30,
	earnings: [{ head: 'basic', paise: 3_000_000 }],
	grossPaise: 3_000_000,
	deductions: [],
	totalDeductionsPaise: 0,
	netPaise: 3_000_000,
	netWords: 'Thirty thousand rupees',
	paidTo: null,
	paidOn: null,
	rulesFrom: '2025-04-01',
	schemesFrom: '2026-04-01',
	status: 'posted',
	payslipNo,
});

async function opened(payslipNo: string | null) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			PayslipPage,
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
				useValue: { payslip: vi.fn(() => of(payslip(payslipNo))), payslipsPdf: vi.fn() },
			},
			{ provide: NotificationService, useValue: { showError: vi.fn(), showSuccess: vi.fn() } },
			{
				provide: ActivatedRoute,
				useValue: { paramMap: of(convertToParamMap({ month: '2026-11', employeeId: 'e1' })) },
			},
		],
	});
	const fixture = TestBed.createComponent(PayslipPage);
	fixture.detectChanges();
	await settle(fixture);
	return fixture.nativeElement.textContent as string;
}

describe('a payslip’s number (PS)', () => {
	it('follows the month once the payslip has one, and is left out before', async () => {
		expect(await opened('PS/26-27/000031')).toMatch(/payroll_payslip_for\s*·\s*PS\/26-27\/000031/);
		expect(await opened(null)).not.toContain('PS/');
	});
});
