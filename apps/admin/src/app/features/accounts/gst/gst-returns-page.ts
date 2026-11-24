import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { GST_STATES } from '@saha-textile/core-domain/company';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { GST_KEYS, GstReturnsGateway } from '@core/accounts/gst-returns.gateway';
import { COMPANY_KEYS, CompanyGateway } from '@core/company/company.gateway';
import { apiProblem, shortDate } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

import type { GstCalendarChip, GstCalendarRow } from '@saha-textile/contracts';

export const GST_CHIPS: readonly GstCalendarChip[] = ['due', 'filed', 'all'];
export const GST_STATUS_PILL: Record<GstCalendarRow['status'], string> = {
	not_started: 'status-pending',
	prepared: 'status-pending',
	checked: 'status-pending',
	approved: 'status-pending',
	filed: 'status-success',
};

/** Refusals the GST return routes give, each with its own words. */
const GST_PROBLEMS = new Set([
	'gst_return_not_ready',
	'gst_return_filed',
	'gst_return_approved',
	'gst_draft_not_found',
	'gst_return_wrong_step',
	'gst_return_approver_only',
	'gst_return_has_problems',
	'gst_draft_changed',
	'gst_due_dates_not_installed',
	'gst_registration_unknown',
	'gst_already_filed',
	'arn_shape',
	'gst_gstr1_not_filed',
	'gst_return_qrmp_later',
	'gstr2b_file_unreadable',
	'gstr2b_line_unreadable',
	'gstr2b_other_gstin',
	'gstr2b_month_filed',
	'gstr2b_not_imported',
	'gstr2b_line_unknown',
	'gstr2b_changed',
]);

/** A prepared return's page: GSTR-3B has its own (G6), GSTR-1 the tables page (G4). */
export function returnLink(returnType: GstCalendarRow['returnType'], id: string): string[] {
	return returnType === 'GSTR-3B' ? ['/accounts/gst/returns/3b', id] : ['/accounts/gst/returns', id];
}

/** A failed GST call as its words' key: `gst_problem_<refusal without "gst_">`, or the general one. */
export function gstProblem(error: unknown): string {
	const code = apiProblem(error, '');
	return GST_PROBLEMS.has(code) ? `gst_problem_${code.replace(/^gst_/, '')}` : 'gst_problem_failed';
}

/**
 * GST returns (accounts brief G3): a GSTIN's GSTR-1 and GSTR-3B for each month and GSTR-9 for each year, with due dates
 * from the due-date rule set, where each stands and its ARN. A GSTR-1 not started is prepared from the books here.
 */
@Component({
	selector: 'app-gst-returns-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, HasPermissionDirective],
	templateUrl: './gst-returns-page.html',
})
export class GstReturnsPage {
	private readonly gateway = inject(GstReturnsGateway);
	private readonly company = inject(CompanyGateway);
	private readonly router = inject(Router);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);

	readonly chips = GST_CHIPS;
	readonly pill = GST_STATUS_PILL;
	readonly chip = signal<GstCalendarChip>('due');
	readonly registrationId = signal('');
	readonly busy = signal(false);

	readonly registrations = injectQuery(() => ({
		queryKey: COMPANY_KEYS.registrations,
		queryFn: () => firstValueFrom(this.company.registrations()),
	}));
	readonly active = computed(() => (this.registrations.data() ?? []).filter((r) => r.active !== false));
	readonly registration = computed(() => this.active().find((r) => r.id === this.registrationId()) ?? null);
	/** G3's heading: the GSTIN and its State. */
	readonly heading = computed(() => {
		const registration = this.registration();
		if (!registration) return '—';
		const state = GST_STATES.find((s) => s.code === registration.stateCode)?.name;
		return state ? `${registration.gstin} · ${state}` : registration.gstin;
	});
	readonly calendar = injectQuery(() => {
		const query = { gstRegistrationId: this.registrationId(), chip: this.chip() };
		return {
			queryKey: GST_KEYS.calendar(query),
			queryFn: () => firstValueFrom(this.gateway.calendar(query)),
			enabled: !!query.gstRegistrationId,
		};
	});

	/** Why the calendar can't show: due dates not installed has its own words. */
	readonly calendarProblem = computed(() => {
		const error = this.calendar.error();
		if (!error) return null;
		const key = gstProblem(error);
		return key === 'gst_problem_failed' ? 'gst_problem_calendar' : key;
	});

	constructor() {
		// The first active registration is shown until another is picked.
		effect(() => {
			const first = this.active()[0];
			if (first && !this.registrationId()) this.registrationId.set(first.id);
		});
	}

	day(date: string): string {
		return shortDate(date);
	}

	/** A month's return opens its draft; a GSTR-1 or GSTR-3B not started is prepared from the books first. */
	async open(row: GstCalendarRow): Promise<void> {
		if (row.draftId) {
			void this.router.navigate(returnLink(row.returnType, row.draftId));
			return;
		}
		if (row.returnType === 'GSTR-9') return;
		const returnType = row.returnType;
		this.busy.set(true);
		try {
			const draft = await firstValueFrom(
				this.gateway.prepare({ gstRegistrationId: this.registrationId(), returnType, month: row.period }),
			);
			void this.router.navigate(returnLink(returnType, draft.id));
		} catch (error) {
			this.notifier.showError(this.transloco.translate(gstProblem(error)));
		} finally {
			this.busy.set(false);
		}
	}
}
