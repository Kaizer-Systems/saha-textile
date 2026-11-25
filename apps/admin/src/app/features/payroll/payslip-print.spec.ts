import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { PayrollGateway } from '@core/accounts/payroll.gateway';
import { saveBlob } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';

import { PayslipPage } from './payslip-page';

vi.mock('@core/purchasing/purchasing-format', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing-format')>()),
	saveBlob: vi.fn(),
}));

/** Printing one payslip (brief 25 PS4): a refusal is named, as the run page names it, and nothing is saved. */

describe('printing a payslip that cannot be made (PS4)', () => {
	it('names the refusal, or says it simply failed, and saves no file', async () => {
		const payslipsPdf = vi
			.fn()
			.mockReturnValueOnce(throwError(() => ({ error: { message: 'payslip_format_missing' } })))
			.mockReturnValueOnce(throwError(() => new Error('down')));
		const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
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
				{ provide: PayrollGateway, useValue: { payslip: vi.fn(() => of(null)), payslipsPdf } },
				{ provide: NotificationService, useValue: notifier },
				{
					provide: ActivatedRoute,
					useValue: { paramMap: of(convertToParamMap({ month: '2026-11', employeeId: 'e1' })) },
				},
			],
		});
		TestBed.overrideComponent(PayslipPage, { set: { template: '' } });
		vi.mocked(saveBlob).mockClear();
		const page = TestBed.createComponent(PayslipPage).componentInstance;
		await page.print();
		expect(notifier.showError).toHaveBeenLastCalledWith('payroll_problem_payslip_format_missing');
		await page.print();
		expect(notifier.showError).toHaveBeenLastCalledWith('payroll_problem_failed');
		expect(saveBlob).not.toHaveBeenCalled();
	});
});
