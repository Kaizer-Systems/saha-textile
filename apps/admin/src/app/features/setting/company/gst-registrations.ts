import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import {
	type GstRegistration,
	type GstRegistrationTerms,
	type GstReturnScheme,
	type GstTaxpayerKind,
	gstStateName,
	gstinProblem,
} from '@saha-textile/contracts';
import { termsOn, termsProblems, turnoverChecks } from '@saha-textile/core-domain/company';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { COMPANY_KEYS, CompanyGateway } from '@core/company/company.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

interface Draft {
	id: string | null;
	gstin: string;
	legalName: string;
	tradeName: string;
	from: string;
	kind: GstTaxpayerKind;
	scheme: GstReturnScheme;
	compositionRatePercent: number | null;
	lastYearTurnoverINR: number;
	active: boolean;
}

const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * Settings › GST registrations (accounts brief J2, G1, G2; owner-approved 2026-11-23). One row per
 * GSTIN; Add or Edit opens a form whose terms are dated, so a change applies from its date and
 * earlier periods keep theirs. The turnover checks (e-invoice, HSN digits, GSTR-9, 9C, QRMP,
 * composition) show as the turnover is typed, from the same rules the API enforces.
 */
@Component({
	selector: 'app-gst-registrations',
	imports: [PageWrapper, TranslocoModule, FormsModule],
	templateUrl: './gst-registrations.html',
})
export class GstRegistrationsSettings {
	private readonly gateway = inject(CompanyGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);

	readonly canEdit = computed(() => this.auth.permissions().includes('company.edit'));
	readonly query = injectQuery(() => ({
		queryKey: COMPANY_KEYS.registrations,
		queryFn: () => firstValueFrom(this.gateway.registrations()),
	}));
	readonly rows = computed(() =>
		(this.query.data() ?? []).map((registration) => ({
			registration,
			terms: termsOn(registration, today()) ?? registration.terms[0] ?? null,
		})),
	);
	readonly draft = signal<Draft | null>(null);
	readonly saving = signal(false);
	readonly gstinCheck = computed(() => {
		const value = this.draft()?.gstin.replace(/\s+/g, '').toUpperCase() ?? '';
		return value.length === 15 ? gstinProblem(value) : value ? { problem: 'shape' as const } : null;
	});
	readonly stateName = computed(() => {
		const gstin = this.draft()?.gstin ?? '';
		return gstin.length >= 2 ? gstStateName(gstin.slice(0, 2)) : null;
	});
	readonly checks = computed(() => {
		const draft = this.draft();
		return draft ? turnoverChecks(draft.lastYearTurnoverINR, draft.gstin.slice(0, 2)) : null;
	});
	readonly problems = computed(() => {
		const draft = this.draft();
		return draft ? termsProblems(this.termsOf(draft), draft.gstin.slice(0, 2)) : [];
	});
	readonly stateLabel = gstStateName;

	add(): void {
		this.draft.set({
			id: null,
			gstin: '',
			legalName: '',
			tradeName: '',
			from: today(),
			kind: 'regular',
			scheme: 'monthly',
			compositionRatePercent: null,
			lastYearTurnoverINR: 0,
			active: true,
		});
	}

	edit(registration: GstRegistration): void {
		const terms = termsOn(registration, today()) ?? registration.terms[0];
		if (!terms) return;
		this.draft.set({
			id: registration.id,
			gstin: registration.gstin,
			legalName: registration.legalName,
			tradeName: registration.tradeName,
			from: today(),
			kind: terms.kind,
			scheme: terms.scheme,
			compositionRatePercent: terms.compositionRatePercent,
			lastYearTurnoverINR: terms.lastYearTurnoverINR,
			active: registration.active,
		});
	}

	patch(change: Partial<Draft>): void {
		this.draft.update((draft) => (draft ? { ...draft, ...change } : draft));
	}

	close(): void {
		this.draft.set(null);
	}

	private termsOf(draft: Draft): GstRegistrationTerms {
		const checks = turnoverChecks(draft.lastYearTurnoverINR, draft.gstin.slice(0, 2));
		return {
			from: draft.from,
			kind: draft.kind,
			scheme: draft.kind === 'isd' ? 'monthly' : draft.scheme,
			compositionRatePercent: draft.kind === 'composition' ? draft.compositionRatePercent : null,
			lastYearTurnoverINR: draft.lastYearTurnoverINR,
			eInvoice: checks.eInvoice,
			eInvoiceThirtyDays: checks.eInvoiceThirtyDays,
			annualReturn: checks.annualReturn,
			reconciliationStatement: checks.reconciliationStatement,
			hsnDigits: checks.hsnDigits,
		};
	}

	async save(): Promise<void> {
		const draft = this.draft();
		if (!draft || !this.canEdit() || this.gstinCheck() || this.problems().length) return;
		this.saving.set(true);
		const body = {
			gstin: draft.gstin.replace(/\s+/g, '').toUpperCase(),
			legalName: draft.legalName,
			tradeName: draft.tradeName,
			terms: this.termsOf(draft),
			active: draft.active,
		};
		try {
			await firstValueFrom(
				draft.id ? this.gateway.saveRegistration(draft.id, body) : this.gateway.addRegistration(body),
			);
			this.draft.set(null);
			await this.queryClient.invalidateQueries({ queryKey: COMPANY_KEYS.registrations });
			this.notifier.showSuccess(this.transloco.translate('gst_registration_saved'));
		} catch {
			this.notifier.showError(this.transloco.translate('gst_registration_save_failed'));
		} finally {
			this.saving.set(false);
		}
	}
}
