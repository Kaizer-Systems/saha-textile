import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { GST_KEYS, GstReturnsGateway } from '@core/accounts/gst-returns.gateway';
import { COMPANY_KEYS, CompanyGateway } from '@core/company/company.gateway';
import { shortDate } from '@core/purchasing/purchasing-format';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

import { gstProblem } from './gst-returns-page';

import type { Gstr2bChip, Gstr2bResult, Gstr2bRow } from '@saha-textile/contracts';

export const GSTR2B_CHIPS: readonly Gstr2bChip[] = ['all', 'matched', 'different', 'only_2b', 'only_books', 'note'];
export const GSTR2B_PILL: Record<Gstr2bResult, string> = {
	matched: 'status-success',
	different: 'status-danger',
	only_2b: 'status-pending',
	only_books: 'status-pending',
	note: 'status-success',
};
/** The portal's 2B file is posted as it is; the API takes requests up to 1 MB. */
export const GSTR2B_MAX_BYTES = 1_000_000;

/** Last month in India, `YYYY-MM`: the month whose 2B is out on the 14th. */
export function lastMonth(now = new Date()): string {
	const ist = new Date(now.getTime() + 5.5 * 3_600_000);
	return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
}

/** A row's taxable value and tax, as "₹2,420.00 + ₹121.00"; a dash when the side has none. */
export function sideText(side: Gstr2bRow['books']): string {
	return side ? `${rupees(side.taxable)} + ${rupees(side.igst + side.cgst + side.sgst)}` : '—';
}

/**
 * Input credit check (accounts brief G5): the month's GSTR-2B from the portal against our posted bills, matched,
 * different, only in 2B or only in our books, with what was done on the portal (IMS) for each line and the credit
 * GSTR-3B may claim.
 */
@Component({
	selector: 'app-gstr2b-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, HasPermissionDirective],
	templateUrl: './gstr2b-page.html',
})
export class Gstr2bPage {
	private readonly gateway = inject(GstReturnsGateway);
	private readonly company = inject(CompanyGateway);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);
	private readonly queries = inject(QueryClient);
	private readonly auth = inject(AuthStore);

	readonly chips = GSTR2B_CHIPS;
	/** Recording what was done on the portal needs `accounts.edit`, as the API checks. */
	readonly canEdit = computed(() => this.auth.permissions().includes('accounts.edit'));
	readonly pill = GSTR2B_PILL;
	readonly side = sideText;
	readonly chip = signal<Gstr2bChip>('all');
	readonly month = signal(lastMonth());
	readonly registrationId = signal('');
	readonly busy = signal(false);
	readonly problem = signal<string | null>(null);

	readonly registrations = injectQuery(() => ({
		queryKey: COMPANY_KEYS.registrations,
		queryFn: () => firstValueFrom(this.company.registrations()),
	}));
	readonly active = computed(() => (this.registrations.data() ?? []).filter((r) => r.active !== false));
	readonly view = injectQuery(() => {
		const query = { gstRegistrationId: this.registrationId(), month: this.month(), chip: this.chip() };
		return {
			queryKey: GST_KEYS.twoB(query),
			queryFn: () => firstValueFrom(this.gateway.twoB(query)),
			enabled: !!query.gstRegistrationId && /^\d{4}-\d{2}$/.test(query.month),
		};
	});
	/** The month as words, "November 2026". */
	readonly monthName = computed(() =>
		new Date(`${this.month()}-01T00:00:00Z`).toLocaleString('en-IN', {
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC',
		}),
	);

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

	claimText(): string {
		const claim = this.view.data()?.claim;
		return claim ? `IGST ${rupees(claim.igst)} · CGST ${rupees(claim.cgst)} · SGST ${rupees(claim.sgst)}` : '—';
	}

	/** Reads the portal's 2B file (JSON) and imports it for this GSTIN; its month comes from the file. */
	async read(file: File | null | undefined): Promise<void> {
		if (!file) return;
		this.problem.set(null);
		if (file.size > GSTR2B_MAX_BYTES) {
			this.problem.set('gstr2b_too_large');
			return;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(await file.text());
		} catch {
			this.problem.set('gst_problem_gstr2b_file_unreadable');
			return;
		}
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
			this.problem.set('gst_problem_gstr2b_file_unreadable');
			return;
		}
		await this.run(async () => {
			const view = await firstValueFrom(
				this.gateway.import2b({
					gstRegistrationId: this.registrationId(),
					file: parsed as Record<string, unknown>,
				}),
			);
			this.month.set(view.month);
			this.chip.set('all');
		}, 'gstr2b_imported');
	}

	/** Records what was done on the portal (IMS) for a line. */
	decide(row: Gstr2bRow, action: 'accept' | 'reject' | 'pending'): Promise<boolean> {
		return this.run(
			() =>
				firstValueFrom(
					this.gateway.decide2b({
						gstRegistrationId: this.registrationId(),
						month: this.month(),
						key: row.key,
						action,
						version: this.view.data()?.version ?? 0,
					}),
				),
			'gstr2b_decided',
		);
	}

	private async run(work: () => Promise<unknown>, done: string): Promise<boolean> {
		this.busy.set(true);
		try {
			await work();
			this.notifier.showSuccess(this.transloco.translate(done));
			await this.queries.invalidateQueries({ queryKey: GST_KEYS.all });
			return true;
		} catch (error) {
			this.notifier.showError(this.transloco.translate(gstProblem(error)));
			return false;
		} finally {
			this.busy.set(false);
		}
	}
}
