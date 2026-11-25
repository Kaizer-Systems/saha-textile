import { Component, computed, inject, signal, type TemplateRef } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { dayLetter, istTime } from '@saha-textile/core-domain/payroll-rules';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { ATTENDANCE_KEYS, AttendanceGateway } from '@core/accounts/attendance.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import type { AttendanceDay, LeaveAsk } from '@saha-textile/contracts';

/** Today in India, `YYYY-MM-DD`. */
const istToday = (now = new Date()) => new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/**
 * My attendance (brief 26 AT1, approved 2026-11-26): on the person's own phone, Mark in and Mark out at the server's
 * time, the month so far and the leave left, asking for leave, and the month's days.
 */
@Component({
	selector: 'app-my-attendance-page',
	imports: [PageWrapper, TranslocoModule, FormsModule],
	templateUrl: './my-attendance-page.html',
})
export class MyAttendancePage {
	private readonly gateway = inject(AttendanceGateway);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);
	private readonly queries = inject(QueryClient);
	private readonly modals = inject(NgbModal);
	private modal: NgbModalRef | null = null;

	readonly busy = signal(false);
	readonly showDays = signal(false);
	readonly me = injectQuery(() => ({
		queryKey: ATTENDANCE_KEYS.me,
		queryFn: () => firstValueFrom(this.gateway.me()),
	}));
	readonly days = injectQuery(() => ({
		queryKey: ATTENDANCE_KEYS.myMonth(this.me.data()?.today.slice(0, 7) ?? ''),
		queryFn: () => firstValueFrom(this.gateway.myMonth((this.me.data()?.today ?? '').slice(0, 7))),
		enabled: this.showDays() && !!this.me.data(),
	}));

	/** Where today stands: not marked in, in, or marked out. */
	readonly state = computed(() => {
		const day = this.me.data()?.day;
		if (!day?.inAt) return 'out';
		return day.outAt ? 'done' : 'in';
	});

	/** "21 present · 1 CL". */
	readonly monthLine = computed(() => {
		const me = this.me.data();
		if (!me) return '';
		const present = this.transloco.translate('att_present_n', { n: me.present });
		return [present, ...Object.entries(me.leaveByType).map(([key, n]) => `${n} ${key}`)].join(' · ');
	});

	/** "EL 0 · CL 5.5 · SL 9.5"; a type given on request or without pay has no balance to show. */
	readonly leaveLine = computed(() =>
		(this.me.data()?.leave ?? [])
			.filter((l) => l.left !== null)
			.map((l) => `${l.key} ${l.left}`)
			.join(' · '),
	);

	readonly time = (iso: string) => istTime(iso);
	/** "Wed, 25 Nov, 2026" (English digits and month names in both languages, as every date in the admin). */
	readonly dayName = (day: string) =>
		new Date(`${day}T12:00:00+05:30`).toLocaleDateString('en-IN', {
			timeZone: 'Asia/Kolkata',
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			year: 'numeric',
		});
	/** Why the page can't show: most often a login not linked to an employee. */
	readonly problem = computed(() => (this.me.error() ? apiProblem(this.me.error(), 'failed') : ''));
	readonly letter = (d: AttendanceDay) => dayLetter(d);

	async mark(): Promise<void> {
		this.busy.set(true);
		try {
			await firstValueFrom(this.state() === 'out' ? this.gateway.markIn() : this.gateway.markOut());
			await this.queries.invalidateQueries({ queryKey: ATTENDANCE_KEYS.all });
		} catch (error) {
			this.notifier.showError(this.transloco.translate(`payroll_problem_${apiProblem(error, 'failed')}`));
		} finally {
			this.busy.set(false);
		}
	}

	readonly ask = signal<LeaveAsk>({ leaveKey: '', from: istToday(), to: istToday(), half: false, reason: '' });
	/** The type picked, for its balance and whether it takes half days. */
	readonly askType = computed(() => this.me.data()?.leave.find((l) => l.key === this.ask().leaveKey) ?? null);

	setAsk(patch: Partial<LeaveAsk>): void {
		this.ask.update((a) => {
			const next = { ...a, ...patch };
			// A half day is one day; a later "from" moves "to" with it.
			if (next.to < next.from || next.half) next.to = next.from;
			return next;
		});
	}

	openAsk(template: TemplateRef<unknown>): void {
		const first = this.me.data()?.leave[0]?.key ?? '';
		this.ask.set({ leaveKey: first, from: istToday(), to: istToday(), half: false, reason: '' });
		this.modal = this.modals.open(template, { centered: true });
	}

	async sendAsk(): Promise<void> {
		this.busy.set(true);
		try {
			await firstValueFrom(this.gateway.askLeave(this.ask()));
			this.notifier.showSuccess(this.transloco.translate('att_leave_asked'));
			await this.queries.invalidateQueries({ queryKey: ATTENDANCE_KEYS.all });
			this.modal?.close();
		} catch (error) {
			this.notifier.showError(this.transloco.translate(`payroll_problem_${apiProblem(error, 'failed')}`));
		} finally {
			this.busy.set(false);
		}
	}
}
