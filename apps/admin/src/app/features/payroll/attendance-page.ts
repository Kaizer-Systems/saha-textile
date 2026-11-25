import { Component, computed, effect, inject, signal, type TemplateRef } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { dayLetter, daysOfMonth, istTime } from '@saha-textile/core-domain/payroll-rules';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { ATTENDANCE_KEYS, AttendanceGateway } from '@core/accounts/attendance.gateway';
import { PAYROLL_KEYS } from '@core/accounts/payroll.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { askConfirm } from '@features/purchasing/shared/popups';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { ExportMenu, type ExportSource } from '@shared/ui/export-menu/export-menu';

import type { AttendanceDay, AttendanceMonthGrid, DayStatus } from '@saha-textile/contracts';

/** This month in India, `YYYY-MM`. */
export function currentMonth(now = new Date()): string {
	return new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 7);
}

type Person = AttendanceMonthGrid['people'][number];

/** One day's cell in the month grid: its letter, its colour, and whether a change waits on it. */
export interface GridCell {
	day: string;
	letter: string;
	tone: string;
	waiting: boolean;
	record: AttendanceDay | null;
}

/** The theme's badge colours for each kind of day (AT2's legend). */
const TONES: Record<DayStatus, string> = {
	present: 'bg-success',
	half: 'bg-warning text-dark',
	absent: 'bg-danger',
	leave: 'bg-info text-dark',
	weekly_off: 'bg-light text-dark border',
	holiday: 'bg-secondary',
	incomplete: 'bg-light text-dark border border-warning',
};

/** The reports the Export menu writes from the month (AT2). */
export const ATTENDANCE_REPORTS = ['grid', 'late', 'absences', 'leave'] as const;
export type AttendanceReport = (typeof ATTENDANCE_REPORTS)[number];

/** AT3: what the day pop-up sets. */
export interface DayForm {
	person: Person;
	day: string;
	status: DayStatus;
	leaveKey: string;
	inTime: string;
	outTime: string;
	reason: string;
	was: string;
}

/** "10:05" on a day in India, as the instant the API keeps. */
const instantOf = (day: string, time: string) => (time ? new Date(`${day}T${time}:00+05:30`).toISOString() : null);

/**
 * Payroll › Attendance (brief 26 AT2, AT3; approved 2026-11-26): a store's month day by day for the stores in the
 * user's charge, each person's totals, the reports in the Export menu, and Lock the month. A day opens its pop-up:
 * someone who may edit changes it at once; a manager asks for the change, which waits for approval.
 */
@Component({
	selector: 'app-attendance-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, HasPermissionDirective, ExportMenu],
	templateUrl: './attendance-page.html',
})
export class AttendancePage {
	private readonly gateway = inject(AttendanceGateway);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);
	private readonly queries = inject(QueryClient);
	private readonly modals = inject(NgbModal);
	private readonly auth = inject(AuthStore);
	private modal: NgbModalRef | null = null;

	readonly month = signal(currentMonth());
	readonly locationId = signal('');
	readonly report = signal<AttendanceReport>('grid');
	readonly reports = ATTENDANCE_REPORTS;
	readonly statuses: readonly DayStatus[] = ['present', 'half', 'absent', 'leave', 'weekly_off', 'holiday'];
	readonly busy = signal(false);

	readonly stores = injectQuery(() => ({
		queryKey: ATTENDANCE_KEYS.stores,
		queryFn: () => firstValueFrom(this.gateway.stores()),
	}));
	readonly grid = injectQuery(() => ({
		queryKey: ATTENDANCE_KEYS.grid(this.month(), this.locationId()),
		queryFn: () => firstValueFrom(this.gateway.grid(this.month(), this.locationId())),
		enabled: /^\d{4}-\d{2}$/.test(this.month()) && !!this.locationId(),
	}));

	constructor() {
		// The first store in the user's charge until they pick another.
		effect(() => {
			const first = this.stores.data()?.[0]?.id;
			if (first && !this.locationId()) this.locationId.set(first);
		});
	}

	readonly days = computed(() => (/^\d{4}-\d{2}$/.test(this.month()) ? daysOfMonth(this.month()) : []));
	readonly locked = computed(() => !!this.grid.data()?.lockedAt);
	readonly mayEdit = computed(() => this.auth.permissions().includes('attendance.edit'));
	readonly unmarked = computed(() => (this.grid.data()?.people ?? []).reduce((n, p) => n + p.unmarked, 0));

	/** AT2: a person's day: their record (a waiting change shown as "?"), else a holiday, a weekly off, or blank. */
	cell(person: Person, day: string): GridCell {
		const grid = this.grid.data();
		const record = person.days.find((d) => d.day === day) ?? null;
		const set = record && (record.inAt || record.markedBy || record.changedBy) ? record : null;
		if (record?.pending) return { day, letter: '?', tone: TONES.incomplete, waiting: true, record };
		if (set) return { day, letter: dayLetter(set), tone: TONES[set.status], waiting: false, record: set };
		if (grid?.holidays.some((h) => h.day === day))
			return { day, letter: 'H', tone: TONES.holiday, waiting: false, record: null };
		if (grid?.offDays.includes(day))
			return { day, letter: 'WO', tone: TONES.weekly_off, waiting: false, record: null };
		return { day, letter: '', tone: '', waiting: false, record: null };
	}

	/** "CL 1 · SL 2". */
	leaveLine(person: Person): string {
		return Object.entries(person.leaveByType)
			.map(([key, n]) => `${key} ${n}`)
			.join(' · ');
	}

	readonly dayNumber = (day: string) => Number(day.slice(8));
	readonly storeName = (id: string) => this.stores.data()?.find((s) => s.id === id)?.name ?? id;

	/** AT2's reports, from the month on screen. */
	readonly exportSource = (): ExportSource | null => {
		const grid = this.grid.data();
		if (!grid) return null;
		const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
		const report = this.report();
		const base = {
			fileName: `attendance-${report}-${grid.month}-${grid.locationId}`,
			title: `${t('payroll_attendance')}: ${t(`att_report_${report}`)}`,
			area: 'accounts' as const,
			filters: [
				{ label: t('att_month'), value: grid.month },
				{ label: t('location'), value: this.storeName(grid.locationId) },
			],
		};
		if (report === 'grid')
			return {
				...base,
				header: [t('payroll_col_name'), ...this.days().map((d) => String(this.dayNumber(d)))],
				rows: grid.people.map((p) => [p.name, ...this.days().map((d) => this.cell(p, d).letter)]),
			};
		if (report === 'late')
			return {
				...base,
				header: [t('payroll_col_name'), t('date'), t('att_in'), t('att_late_minutes')],
				rows: grid.people.flatMap((p) =>
					p.days
						.filter((d) => d.lateMinutes > 0)
						.map((d) => [p.name, d.day, d.inAt ? istTime(d.inAt) : '', d.lateMinutes]),
				),
			};
		if (report === 'absences') {
			// Days marked absent, and days on the person's roll nobody marked, up to today (none still to come).
			const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
			return {
				...base,
				header: [t('payroll_col_name'), t('date'), t('att_day')],
				rows: grid.people.flatMap((p) =>
					this.days()
						.filter((d) => this.cell(p, d).letter === 'A' || (p.unmarkedDays.includes(d) && d <= today))
						.map((d) => [p.name, d, this.cell(p, d).letter ? t('att_status_absent') : t('att_not_marked')]),
				),
			};
		}
		return {
			...base,
			header: [
				t('payroll_col_name'),
				t('att_paid_days'),
				t('att_leave_by_type'),
				t('att_without_pay'),
				t('att_late_marks'),
				t('att_unmarked'),
			],
			rows: grid.people.map((p) => [
				p.name,
				p.paidDays,
				this.leaveLine(p),
				p.withoutPay,
				p.lateMarks,
				p.unmarked,
			]),
		};
	};

	/** AT2: lock the month from the days; days nobody marked are named first, as they count absent. */
	async lock(): Promise<void> {
		const unmarked = this.unmarked();
		if (
			unmarked &&
			!(await askConfirm(this.modals, {
				icon: 'ri-lock-line',
				title: 'att_lock_title',
				body: 'att_lock_unmarked',
				params: { n: unmarked },
				yes: 'att_lock',
			}))
		)
			return;
		this.busy.set(true);
		try {
			await firstValueFrom(this.gateway.lock(this.month()));
			this.notifier.showSuccess(this.transloco.translate('payroll_attendance_locked'));
			await this.queries.invalidateQueries({ queryKey: ATTENDANCE_KEYS.all });
			await this.queries.invalidateQueries({ queryKey: PAYROLL_KEYS.all });
		} catch (error) {
			this.notifier.showError(this.transloco.translate(`payroll_problem_${apiProblem(error, 'failed')}`));
		} finally {
			this.busy.set(false);
		}
	}

	readonly form = signal<DayForm | null>(null);

	/** AT3: open a day; a locked month opens only for someone who may edit. */
	openDay(template: TemplateRef<unknown>, person: Person, day: string): void {
		if (this.locked() && !this.mayEdit()) return;
		const c = this.cell(person, day);
		const r = c.record;
		this.form.set({
			person,
			day,
			status: r?.status === 'incomplete' || !r ? 'present' : r.status,
			leaveKey: r?.leaveKey ?? this.grid.data()?.leaveTypes[0]?.key ?? '',
			inTime: r?.inAt ? istTime(r.inAt) : '',
			outTime: r?.outAt ? istTime(r.outAt) : '',
			reason: '',
			// What the grid shows: the day's own status, else its holiday or weekly off, else not marked.
			was: this.transloco.translate(
				r
					? `att_status_${r.status}`
					: c.letter === 'H'
						? 'att_status_holiday'
						: c.letter === 'WO'
							? 'att_status_weekly_off'
							: 'att_not_marked',
			),
		});
		this.modal = this.modals.open(template, { centered: true });
	}

	setForm(patch: Partial<DayForm>): void {
		this.form.update((f) => (f ? { ...f, ...patch } : f));
	}

	/** A leave day or half day carries its type; in and out times only for days worked. */
	readonly needsLeave = (status: DayStatus) => status === 'leave' || status === 'half';
	readonly worked = (status: DayStatus) => status === 'present' || status === 'half';

	async saveDay(): Promise<void> {
		const f = this.form();
		if (!f) return;
		this.busy.set(true);
		try {
			await firstValueFrom(
				this.gateway.change(f.person.employeeId, f.day, {
					status: f.status,
					leaveKey: this.needsLeave(f.status) ? f.leaveKey || null : null,
					inAt: this.worked(f.status) ? instantOf(f.day, f.inTime) : null,
					outAt: this.worked(f.status) ? instantOf(f.day, f.outTime) : null,
					reason: f.reason.trim(),
				}),
			);
			this.notifier.showSuccess(this.transloco.translate(this.mayEdit() ? 'att_day_saved' : 'att_change_asked'));
			await this.queries.invalidateQueries({ queryKey: ATTENDANCE_KEYS.all });
			this.modal?.close();
		} catch (error) {
			this.notifier.showError(this.transloco.translate(`payroll_problem_${apiProblem(error, 'failed')}`));
		} finally {
			this.busy.set(false);
		}
	}
}
