import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { LEDGER_KEYS, LedgerGateway } from '@core/accounts/ledger.gateway';
import { PAYROLL_KEYS, PayrollGateway } from '@core/accounts/payroll.gateway';
import { LOCATION_KEYS, LocationsGateway } from '@core/locations/locations.gateway';
import { apiProblem, saveBlob, shortDate } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

import { currentMonth } from './attendance-page';
import { yearOf } from './employees-page';
import { stateName } from './payroll-rules-page';

import type { ChartOfAccounts, PayrollRow, PayrollRun, PayrollRunStatus } from '@saha-textile/contracts';

export const PAYROLL_STEPS: readonly PayrollRunStatus[] = ['draft', 'approved', 'posted', 'paid'];

/** A step pill's icon: passed, the next one, or still to come. */
export function payrollStepIcon(status: PayrollRunStatus, index: number): string {
	const reached = PAYROLL_STEPS.indexOf(status);
	if (index <= reached) return 'ri-checkbox-circle-line text-success';
	if (index === reached + 1) return 'ri-time-line text-warning';
	return 'ri-checkbox-blank-circle-line text-muted';
}

/** The run's total row: every money column added up (paise). */
export function payrollTotals(rows: readonly PayrollRow[]) {
	const sum = (pick: (r: PayrollRow) => number) => rows.reduce((total, r) => total + pick(r), 0);
	return {
		gross: sum((r) => r.grossPaise),
		pf: sum((r) => r.pfEmployeePaise),
		esi: sum((r) => r.esiEmployeePaise),
		pt: sum((r) => r.ptPaise),
		tds: sum((r) => r.tdsPaise),
		advance: sum((r) => r.advancePaise),
		net: sum((r) => r.netPaise),
	};
}

/** The bank and cash ledgers the net pay can leave from. */
export function payingFrom(chart: ChartOfAccounts): { id: string; name: string }[] {
	const keys = new Set(['cash_in_hand', 'bank_accounts', 'bank_od']);
	const groups = new Map(chart.groups.map((g) => [g.id, g]));
	const placed = (groupId: string): boolean => {
		const group = groups.get(groupId);
		if (!group) return false;
		return (
			(group.systemKey !== null && keys.has(group.systemKey)) || (group.parentId ? placed(group.parentId) : false)
		);
	};
	return chart.ledgers
		.filter((l) => l.active !== false && placed(l.groupId))
		.map((l) => ({ id: l.id, name: l.name }));
}

const istToday = (): string => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/**
 * A month's payroll run (accounts brief S5): prepared from locked attendance, approved by someone who may lock the
 * books, posted as one payroll journal per location, then paid from a bank ledger.
 */
@Component({
	selector: 'app-payroll-run-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink, HasPermissionDirective],
	templateUrl: './payroll-run-page.html',
})
export class PayrollRunPage {
	private readonly gateway = inject(PayrollGateway);
	private readonly ledger = inject(LedgerGateway);
	private readonly locationsGateway = inject(LocationsGateway);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);
	private readonly queries = inject(QueryClient);

	readonly steps = PAYROLL_STEPS;
	readonly icon = payrollStepIcon;
	readonly money = rupees;
	readonly month = signal(currentMonth());
	readonly busy = signal(false);
	readonly bankLedgerId = signal('');
	readonly paidOn = signal(istToday());
	readonly run = injectQuery(() => ({
		queryKey: PAYROLL_KEYS.run(this.month()),
		queryFn: () => firstValueFrom(this.gateway.run(this.month())),
		enabled: /^\d{4}-\d{2}$/.test(this.month()),
	}));
	readonly attendance = injectQuery(() => ({
		queryKey: PAYROLL_KEYS.attendance(this.month()),
		queryFn: () => firstValueFrom(this.gateway.attendance(this.month())),
		enabled: /^\d{4}-\d{2}$/.test(this.month()),
	}));
	readonly chart = injectQuery(() => ({
		queryKey: LEDGER_KEYS.chart,
		queryFn: () => firstValueFrom(this.ledger.chart()),
	}));
	readonly locations = injectQuery(() => ({
		queryKey: LOCATION_KEYS.list,
		queryFn: () => firstValueFrom(this.locationsGateway.list()),
	}));
	readonly banks = computed(() => {
		const chart = this.chart.data();
		return chart ? payingFrom(chart) : [];
	});
	readonly totals = computed(() => payrollTotals(this.run.data()?.rows ?? []));

	readonly stateName = stateName;
	/** BN1: the month's financial year, its bonus, and the bank and day it is paid from. */
	readonly bonusYearLabel = computed(() => yearOf(this.month()));
	readonly bonus = injectQuery(() => ({
		queryKey: PAYROLL_KEYS.bonus(this.bonusYearLabel()),
		queryFn: () => firstValueFrom(this.gateway.bonusYear(this.bonusYearLabel())),
		enabled: /^\d{4}-\d{2}$/.test(this.month()),
	}));
	readonly bonusBank = signal('');
	readonly bonusPaidOn = signal(istToday());
	readonly bonusShort = computed(() => (this.bonus.data()?.rows ?? []).filter((r) => r.providedPaise < r.duePaise));

	/** PS4: every payslip of the run in one PDF, each on its own page, on the active payslip format. */
	async printPayslips(): Promise<void> {
		try {
			saveBlob(`payslips-${this.month()}.pdf`, await firstValueFrom(this.gateway.payslipsPdf(this.month())));
		} catch (error) {
			this.notifier.showError(this.transloco.translate(`payroll_problem_${apiProblem(error, 'failed')}`));
		}
	}

	async payBonus(): Promise<void> {
		this.busy.set(true);
		try {
			await firstValueFrom(
				this.gateway.payBonus(this.bonusYearLabel(), {
					bankLedgerId: this.bonusBank(),
					paidOn: this.bonusPaidOn(),
				}),
			);
			this.notifier.showSuccess(this.transloco.translate('payroll_bonus_paid'));
			await this.queries.invalidateQueries({ queryKey: PAYROLL_KEYS.all });
		} catch (error) {
			this.notifier.showError(this.transloco.translate(`payroll_problem_${apiProblem(error, 'failed')}`));
		} finally {
			this.busy.set(false);
		}
	}

	/** ST1: the States on the run with no payroll rules yet, by name. */
	statesMissing(run: PayrollRun): string {
		return (run.statesMissing ?? []).map(stateName).join(', ');
	}

	locationName(id: string): string {
		return this.locations.data()?.find((l) => l.id === id)?.name ?? '';
	}

	day(iso: string): string {
		return shortDate(iso.slice(0, 10));
	}

	private async act(call: () => Promise<PayrollRun>, saved: string): Promise<void> {
		this.busy.set(true);
		try {
			await call();
			this.notifier.showSuccess(this.transloco.translate(saved));
			await this.queries.invalidateQueries({ queryKey: PAYROLL_KEYS.all });
		} catch (error) {
			this.notifier.showError(this.transloco.translate(`payroll_problem_${apiProblem(error, 'failed')}`));
		} finally {
			this.busy.set(false);
		}
	}

	prepare(): Promise<void> {
		return this.act(() => firstValueFrom(this.gateway.prepare(this.month())), 'payroll_run_prepared');
	}

	step(run: PayrollRun, to: 'approved' | 'posted' | 'paid'): Promise<void> {
		const paid = to === 'paid' ? { bankLedgerId: this.bankLedgerId() || null, paidOn: this.paidOn() || null } : {};
		return this.act(
			() => firstValueFrom(this.gateway.step(this.month(), { to, version: run.version, ...paid })),
			`payroll_run_${to}`,
		);
	}
}
