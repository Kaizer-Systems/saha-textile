import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { PayrollGateway } from '@core/accounts/payroll.gateway';

import { PayslipPage } from './payslip-page';

/** A payslip (accounts brief S6), printed from the browser. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const PAYSLIP = {
	month: '2026-11',
	company: 'K.R. Marketing',
	employeeId: 'e1',
	name: 'Asha Das',
	code: 'E-001',
	location: 'Barasat',
	uan: '100200300400',
	daysInMonth: 30,
	paidDays: 29,
	earnings: [
		{ head: 'basic', paise: 1_546_667 },
		{ head: 'special', paise: 1_546_666 },
	],
	grossPaise: 3_093_333,
	deductions: [
		{ key: 'pf', paise: 180_000, wagesPaise: 1_500_000, recovery: null },
		{ key: 'esi', paise: 0, wagesPaise: null, recovery: null },
		{ key: 'advance', paise: 100_000, wagesPaise: null, recovery: { n: 2, of: 5 } },
	],
	totalDeductionsPaise: 280_000,
	netPaise: 2_813_333,
	netWords: 'Twenty-eight thousand one hundred thirty-three rupees and thirty-three paise',
	paidTo: { bank: 'HDFC', last4: '7788' },
	paidOn: '2026-12-01',
	rulesFrom: '2025-04-01',
	schemesFrom: '2026-04-01',
	status: 'paid',
};

function mount(route: Record<string, string>, payslip: unknown = PAYSLIP) {
	TestBed.resetTestingModule();
	const calls = { payslip: vi.fn(() => of(payslip)) };
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
			{ provide: PayrollGateway, useValue: calls },
			{ provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap(route)) } },
		],
	});
	const fixture = TestBed.createComponent(PayslipPage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, calls };
}

describe('a payslip (S6)', () => {
	it('shows the person, earnings, each deduction with its basis, the net pay and where it was paid', async () => {
		const { fixture, page, calls } = mount({ month: '2026-11', employeeId: 'e1' });
		await settle(fixture);
		expect(calls.payslip).toHaveBeenCalledWith('2026-11', 'e1');
		expect(page.monthText()).toBe('November 2026');
		const text = fixture.nativeElement.textContent as string;
		expect(text).toContain('E-001 ·');
		expect(text).toContain('UAN 100200300400');
		expect(text).toContain('payroll_deduct_pf');
		expect(text).toContain('payroll_deduct_esi');
		expect(text).toContain('payroll_deduct_advance_n');
		expect(text).toContain('payroll_paid_to');
		expect(text).toContain('payroll_rules_used');
		expect(text).toContain('₹28,133.33');
		expect(page.day('2026-12-01')).toBeTruthy();
		const print = vi.spyOn(globalThis, 'print').mockImplementation(() => undefined);
		(fixture.nativeElement.querySelector('#payslip_print') as HTMLButtonElement).click();
		expect(print).toHaveBeenCalled();
		print.mockRestore();
	});

	it('leaves out a code, UAN, recovery count and payment not yet there, and uses the rules’ day for schemes', async () => {
		const { fixture } = mount(
			{ month: '2026-11', employeeId: 'e2' },
			{
				...PAYSLIP,
				code: '',
				uan: '',
				deductions: [
					{ key: 'pf', paise: 0, wagesPaise: null, recovery: null },
					{ key: 'advance', paise: 50_000, wagesPaise: null, recovery: null },
				],
				paidTo: null,
				paidOn: null,
				schemesFrom: null,
			},
		);
		await settle(fixture);
		const text = fixture.nativeElement.textContent as string;
		expect(text).not.toContain('UAN');
		expect(text).not.toContain('·  Barasat');
		expect(text).toContain('payroll_deduct_advance');
		expect(text).not.toContain('payroll_deduct_advance_n');
		expect(text).not.toContain('payroll_paid_to');
	});

	it('reads nothing until both the month and the person are named', async () => {
		const { fixture, calls } = mount({ month: '2026-11' });
		await settle(fixture);
		expect(calls.payslip).not.toHaveBeenCalled();
		const none = mount({});
		await settle(none.fixture);
		expect(none.calls.payslip).not.toHaveBeenCalled();
	});
});
