import { Component, computed, inject, signal, type TemplateRef } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { LEDGER_KEYS, LedgerGateway } from '@core/accounts/ledger.gateway';
import { PAYROLL_KEYS, PayrollGateway } from '@core/accounts/payroll.gateway';
import { apiProblem, shortDate } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

import { monthLabel } from './payroll-format';
import { payingFrom } from './payroll-run-page';

import type { AdvanceSchedule } from '@saha-textile/contracts';

const istToday = (): string => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/** An advance's state: still being recovered, or all recovered. */
export function advanceState(a: Pick<AdvanceSchedule, 'leftPaise'>): 'recovering' | 'recovered' {
	return a.leftPaise > 0 ? 'recovering' : 'recovered';
}

/**
 * Advances and loans (accounts brief S9): everyone given an advance, and one person's schedule (each month's recovery,
 * actual from posted payrolls and planned after). Giving one pays it from cash or bank to Staff advance.
 */
@Component({
	selector: 'app-advances-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink, HasPermissionDirective],
	templateUrl: './advances-page.html',
})
export class AdvancesPage {
	private readonly gateway = inject(PayrollGateway);
	private readonly ledger = inject(LedgerGateway);
	private readonly route = inject(ActivatedRoute);
	private readonly modals = inject(NgbModal);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);
	private readonly queries = inject(QueryClient);

	readonly money = rupees;
	readonly state = advanceState;
	readonly employeeId = toSignal(this.route.paramMap.pipe(map((p) => p.get('employeeId') ?? '')), {
		initialValue: '',
	});
	readonly list = injectQuery(() => ({
		queryKey: PAYROLL_KEYS.advances,
		queryFn: () => firstValueFrom(this.gateway.advances()),
		enabled: !this.employeeId(),
	}));
	readonly one = injectQuery(() => ({
		queryKey: PAYROLL_KEYS.advance(this.employeeId()),
		queryFn: () => firstValueFrom(this.gateway.advance(this.employeeId())),
		enabled: !!this.employeeId(),
	}));
	readonly employees = injectQuery(() => ({
		queryKey: PAYROLL_KEYS.employees,
		queryFn: () => firstValueFrom(this.gateway.employees()),
	}));
	readonly chart = injectQuery(() => ({
		queryKey: LEDGER_KEYS.chart,
		queryFn: () => firstValueFrom(this.ledger.chart()),
	}));
	readonly banks = computed(() => {
		const chart = this.chart.data();
		return chart ? payingFrom(chart) : [];
	});
	readonly staff = computed(() => (this.employees.data() ?? []).filter((e) => !e.leftOn));
	readonly form = signal({
		employeeId: '',
		amountINR: 0,
		givenOn: istToday(),
		ledgerId: '',
		perMonthINR: 0,
		note: '',
	});
	readonly busy = signal(false);
	private modal: NgbModalRef | null = null;

	month(m: string): string {
		return monthLabel(m, this.transloco.getActiveLang());
	}

	day(date: string): string {
		return shortDate(date);
	}

	given(a: AdvanceSchedule): number {
		return a.given.reduce((s, g) => s + g.amountPaise, 0);
	}

	patch(fields: Partial<ReturnType<AdvancesPage['form']>>): void {
		this.form.update((f) => ({ ...f, ...fields }));
	}

	open(template: TemplateRef<unknown>): void {
		this.form.set({
			employeeId: this.employeeId(),
			amountINR: 0,
			givenOn: istToday(),
			ledgerId: '',
			perMonthINR: 0,
			note: '',
		});
		this.modal = this.modals.open(template, { centered: true });
	}

	async give(): Promise<void> {
		const { employeeId, ...write } = this.form();
		const version = this.employees.data()?.find((e) => e.id === employeeId)?.version ?? 0;
		this.busy.set(true);
		try {
			await firstValueFrom(this.gateway.giveAdvance(employeeId, { ...write, version }));
			this.notifier.showSuccess(this.transloco.translate('payroll_advance_given'));
			await this.queries.invalidateQueries({ queryKey: PAYROLL_KEYS.all });
			this.modal?.close();
		} catch (error) {
			this.notifier.showError(this.transloco.translate(`payroll_problem_${apiProblem(error, 'failed')}`));
		} finally {
			this.busy.set(false);
		}
	}
}
