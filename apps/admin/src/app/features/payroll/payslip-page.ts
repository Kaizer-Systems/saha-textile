import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { PAYROLL_KEYS, PayrollGateway } from '@core/accounts/payroll.gateway';
import { shortDate } from '@core/purchasing/purchasing-format';
import { rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { monthLabel } from './payroll-format';

/**
 * A payslip (accounts brief S6): earnings for the days worked, deductions with the wages PF was worked out on and which
 * advance recovery this is, the net pay in words, where it was paid, and the rule versions used, so a reprint never
 * changes. Printed from the browser.
 */
@Component({
	selector: 'app-payslip-page',
	imports: [PageWrapper, TranslocoModule, RouterLink],
	templateUrl: './payslip-page.html',
})
export class PayslipPage {
	private readonly gateway = inject(PayrollGateway);
	private readonly transloco = inject(TranslocoService);
	private readonly route = inject(ActivatedRoute);

	readonly month = toSignal(this.route.paramMap.pipe(map((p) => p.get('month') ?? '')), { initialValue: '' });
	readonly employeeId = toSignal(this.route.paramMap.pipe(map((p) => p.get('employeeId') ?? '')), {
		initialValue: '',
	});
	readonly money = rupees;
	readonly payslip = injectQuery(() => ({
		queryKey: PAYROLL_KEYS.payslip(this.month(), this.employeeId()),
		queryFn: () => firstValueFrom(this.gateway.payslip(this.month(), this.employeeId())),
		enabled: !!this.month() && !!this.employeeId(),
	}));
	readonly monthText = computed(() => monthLabel(this.month(), this.transloco.getActiveLang()));

	day(date: string | null): string {
		return shortDate(date);
	}

	print(): void {
		globalThis.print();
	}
}
