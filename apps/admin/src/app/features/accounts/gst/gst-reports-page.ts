import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { termsOn } from '@saha-textile/core-domain/company';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { COMPANY_KEYS, CompanyGateway } from '@core/company/company.gateway';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import type { GstRegistrationTerms } from '@saha-textile/contracts';

/** Who a report is for: everyone, or only a GSTIN with these terms. */
type ForWhom =
	'monthly' | 'when_needed' | 'view' | 'qrmp' | 'composition' | 'isd' | 'if_any' | 'yearly' | 'job_work' | 'any_time';

export interface GstReport {
	key: string;
	/** The form's own name (GSTR-1, ITC-04), the same in every language; null when the report is named in words. */
	name: string | null;
	forWhom: ForWhom;
	/** Where it is in the admin; null when it is read and filed on the portal only. */
	link: string | null;
}

/** G7: every GST report, in the drawn order. */
export const GST_REPORTS: readonly GstReport[] = [
	{ key: 'gstr1', name: 'GSTR-1 / IFF', forWhom: 'monthly', link: '/accounts/gst/returns' },
	{ key: 'gstr1a', name: 'GSTR-1A', forWhom: 'when_needed', link: null },
	{ key: 'gstr2a', name: 'GSTR-2A', forWhom: 'view', link: null },
	{ key: 'gstr2b', name: 'GSTR-2B', forWhom: 'monthly', link: '/accounts/gst/2b' },
	{ key: 'ims', name: 'IMS', forWhom: 'monthly', link: '/accounts/gst/2b' },
	{ key: 'gstr3b', name: 'GSTR-3B', forWhom: 'monthly', link: '/accounts/gst/returns' },
	{ key: 'pmt06', name: 'PMT-06', forWhom: 'qrmp', link: null },
	{ key: 'cmp08', name: 'CMP-08 · GSTR-4', forWhom: 'composition', link: null },
	{ key: 'gstr6', name: 'GSTR-6 · GSTR-6A', forWhom: 'isd', link: null },
	{ key: 'gstr7', name: null, forWhom: 'if_any', link: null },
	{ key: 'gstr9', name: 'GSTR-9 · GSTR-9C', forWhom: 'yearly', link: '/accounts/gst/annual' },
	{ key: 'itc04', name: 'ITC-04', forWhom: 'job_work', link: null },
	{ key: 'edocs', name: null, forWhom: 'monthly', link: '/accounts/e-invoices' },
	{ key: 'ledgers', name: null, forWhom: 'any_time', link: '/accounts/ledgers' },
	{ key: 'books', name: null, forWhom: 'monthly', link: '/accounts/gst/annual' },
];

/** "For you": the report's cadence, or "not for you" when the GSTIN's terms rule it out. */
export function forYou(
	report: Pick<GstReport, 'forWhom'>,
	terms: Pick<GstRegistrationTerms, 'kind' | 'scheme'> | null,
): string {
	const not = 'gst_report_for_not_you';
	switch (report.forWhom) {
		case 'qrmp':
			return terms?.scheme === 'qrmp' ? 'gst_report_for_monthly' : not;
		case 'composition':
			return terms?.kind === 'composition' ? 'gst_report_for_composition' : not;
		case 'isd':
			return terms?.kind === 'isd' ? 'gst_report_for_monthly' : not;
		case 'monthly':
			return terms?.scheme === 'qrmp' ? 'gst_report_for_quarterly' : 'gst_report_for_monthly';
		default:
			return `gst_report_for_${report.forWhom}`;
	}
}

/** GST reports (accounts brief G7): every GST report with what it is and whether it is for this GSTIN. */
@Component({
	selector: 'app-gst-reports-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink],
	templateUrl: './gst-reports-page.html',
})
export class GstReportsPage {
	private readonly company = inject(CompanyGateway);

	readonly reports = GST_REPORTS;
	readonly registrationId = signal('');
	readonly registrations = injectQuery(() => ({
		queryKey: COMPANY_KEYS.registrations,
		queryFn: () => firstValueFrom(this.company.registrations()),
	}));
	readonly active = computed(() => (this.registrations.data() ?? []).filter((r) => r.active !== false));
	/** The picked GSTIN's terms today. */
	readonly terms = computed(() => {
		const registration = this.active().find((r) => r.id === this.registrationId());
		return registration
			? termsOn(registration, new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10))
			: null;
	});

	constructor() {
		effect(() => {
			const first = this.active()[0];
			if (first && !this.registrationId()) this.registrationId.set(first.id);
		});
	}

	forYou(report: GstReport): string {
		return forYou(report, this.terms());
	}
}
