import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { PAYROLL_KEYS, PayrollGateway } from '@core/accounts/payroll.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

import type { AttendanceRow } from '@saha-textile/contracts';

/** This month in India, `YYYY-MM`. */
export function currentMonth(now = new Date()): string {
	return new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 7);
}

/** Attendance and leave (accounts brief S8): paid days per person for the month, locked before the payroll run. */
@Component({
	selector: 'app-attendance-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, HasPermissionDirective],
	templateUrl: './attendance-page.html',
})
export class AttendancePage {
	private readonly gateway = inject(PayrollGateway);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);
	private readonly queries = inject(QueryClient);

	readonly month = signal(currentMonth());
	readonly rows = signal<AttendanceRow[]>([]);
	readonly busy = signal(false);
	readonly attendance = injectQuery(() => ({
		queryKey: PAYROLL_KEYS.attendance(this.month()),
		queryFn: () => firstValueFrom(this.gateway.attendance(this.month())),
		enabled: /^\d{4}-\d{2}$/.test(this.month()),
	}));
	readonly employees = injectQuery(() => ({
		queryKey: PAYROLL_KEYS.employees,
		queryFn: () => firstValueFrom(this.gateway.employees()),
	}));
	readonly locked = computed(() => !!this.attendance.data()?.lockedAt);

	constructor() {
		effect(() => {
			const a = this.attendance.data();
			if (a) this.rows.set(a.rows.map((r) => ({ ...r })));
		});
	}

	name(id: string): string {
		return this.employees.data()?.find((e) => e.id === id)?.name ?? id;
	}

	setRow(index: number, patch: Partial<AttendanceRow>): void {
		this.rows.update((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
	}

	async save(lock: boolean): Promise<void> {
		this.busy.set(true);
		try {
			await firstValueFrom(
				this.gateway.saveAttendance(this.month(), {
					rows: this.rows(),
					lock,
					version: this.attendance.data()?.version ?? 0,
				}),
			);
			this.notifier.showSuccess(
				this.transloco.translate(lock ? 'payroll_attendance_locked' : 'payroll_attendance_saved'),
			);
			await this.queries.invalidateQueries({ queryKey: PAYROLL_KEYS.all });
		} catch (error) {
			this.notifier.showError(this.transloco.translate(`payroll_problem_${apiProblem(error, 'failed')}`));
		} finally {
			this.busy.set(false);
		}
	}
}
