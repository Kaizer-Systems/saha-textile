import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { BANK_KEYS, BanksGateway } from '@core/accounts/banks.gateway';
import { apiProblem, shortDate } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { accountsHint, accountsRange } from '@features/accounts/accounts-period';
import { rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { ACCOUNTS_PRESETS, PeriodPicker, type PeriodChoice } from '@shared/ui/period-picker/period-picker';

import { LinkPopup } from './link-popup';
import { statementProblem } from './statement-import';

import type { ReconcileRow, ReconcileTab } from '@saha-textile/contracts';

export const RECONCILE_TABS: readonly ReconcileTab[] = ['suggested', 'unmatched', 'accepted'];
export type Sureness = 'sure' | 'unsure' | 'rule' | 'none';
export const SURE_PILL: Record<Sureness, string> = {
	sure: 'status-success',
	unsure: 'status-pending',
	rule: 'status-success',
	none: 'status-danger',
};

/** How sure a line's match is, as BA7's last column says it. */
export function sureness(row: Pick<ReconcileRow, 'match'>): Sureness {
	if (!row.match) return 'none';
	if (row.match.entry) return 'rule';
	return row.match.sure ? 'sure' : 'unsure';
}

/** Bank charges with their GST taken out of the amount, as the entry will post them. */
export function chargeSplit(amountPaise: number, gstPercent: number | null): { taxable: number; tax: number } {
	const taxable = Math.round((amountPaise * 100) / (100 + (gstPercent ?? 0)));
	return { taxable, tax: amountPaise - taxable };
}

/**
 * Reconcile (accounts brief BA7): the account's statement lines for a period, each with the match the app suggests by
 * its rules, as a draft. Accept or turn down each, accept all sure ones at once, link a line elsewhere (BA8), make an
 * entry for a line the books lack, or break an accepted match.
 */
@Component({
	selector: 'app-reconcile-page',
	imports: [PageWrapper, TranslocoModule, RouterLink, HasPermissionDirective, PeriodPicker],
	templateUrl: './reconcile-page.html',
})
export class ReconcilePage {
	private readonly gateway = inject(BanksGateway);
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly modals = inject(NgbModal);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);
	private readonly queries = inject(QueryClient);

	readonly tabs = RECONCILE_TABS;
	readonly presets = ACCOUNTS_PRESETS;
	readonly hint = accountsHint;
	readonly pill = SURE_PILL;

	readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('id') ?? '')), { initialValue: '' });
	readonly tab = signal<ReconcileTab>('suggested');
	readonly range = signal(accountsRange({ period: 'this_month' }));
	readonly busy = signal(false);

	readonly account = injectQuery(() => ({
		queryKey: BANK_KEYS.one(this.id()),
		queryFn: () => firstValueFrom(this.gateway.one(this.id())),
		enabled: !!this.id(),
	}));
	readonly view = injectQuery(() => {
		const query = { ...this.range(), tab: this.tab() };
		return {
			queryKey: BANK_KEYS.reconcile(this.id(), query),
			queryFn: () => firstValueFrom(this.gateway.reconcile(this.id(), query)),
			enabled: !!this.id(),
		};
	});
	readonly rows = computed(() => this.view.data()?.items ?? []);

	setPeriod(choice: PeriodChoice): void {
		this.range.set(accountsRange(choice));
	}

	sure(row: ReconcileRow): Sureness {
		return sureness(row);
	}

	amount(row: Pick<ReconcileRow, 'inPaise' | 'outPaise'>): string {
		return row.inPaise ? rupees(row.inPaise) : `−${rupees(row.outPaise)}`;
	}

	day(date: string): string {
		return shortDate(date);
	}

	/** What the line is matched to: the entries by number, or the entry a rule will make. */
	matchText(row: ReconcileRow): string {
		const match = row.match;
		if (match?.entry === 'bank_charge') {
			const split = chargeSplit(row.outPaise, match.gstPercent);
			return this.transloco.translate('bank_new_bank_charge', {
				taxable: rupees(split.taxable),
				tax: rupees(split.tax),
			});
		}
		if (match?.entry === 'interest')
			return this.transloco.translate('bank_new_interest', { amount: rupees(row.inPaise) });
		return row.entries.map((e) => `${e.number} · ${e.narration}`).join('; ') || '—';
	}

	whyText(row: ReconcileRow): string {
		const why = row.match?.why;
		if (!why) return this.transloco.translate('bank_why_none');
		if (why.startsWith('rule:')) return this.transloco.translate('bank_why_rule', { words: why.slice(5) });
		return this.transloco.translate(`bank_why_${why}`);
	}

	accept(row: ReconcileRow): Promise<boolean> {
		return this.run(() => firstValueFrom(this.gateway.accept(this.id(), row.id, this.range())), 'bank_done_accept');
	}

	reject(row: ReconcileRow): Promise<boolean> {
		return this.run(() => firstValueFrom(this.gateway.reject(this.id(), row.id, this.range())), 'bank_done_reject');
	}

	unmatch(row: ReconcileRow): Promise<boolean> {
		return this.run(() => firstValueFrom(this.gateway.unmatch(this.id(), row.id)), 'bank_done_unmatch');
	}

	async acceptSure(): Promise<void> {
		let count = 0;
		const ok = await this.run(async () => {
			count = (await firstValueFrom(this.gateway.acceptSure(this.id(), this.range()))).accepted;
		}, null);
		if (ok) this.notifier.showSuccess(this.transloco.translate('bank_accepted_n', { count }));
	}

	/** BA8: a suggestion is turned down first, then the line is linked to the entries picked. */
	async relink(row: ReconcileRow): Promise<void> {
		let removed: string | null = null;
		if (row.match) {
			removed = this.matchText(row);
			const ok = await this.run(() => firstValueFrom(this.gateway.reject(this.id(), row.id, this.range())), null);
			if (!ok) return;
		}
		const popup = this.modals.open(LinkPopup, {
			centered: true,
			size: 'lg',
			windowClass: 'theme-modal',
			ariaLabelledBy: 'bank_link_title',
		});
		(popup.componentInstance as LinkPopup).start({ bankAccountId: this.id(), line: row, removed });
		const linked = await popup.result.catch(() => false);
		if (linked) await this.queries.invalidateQueries({ queryKey: BANK_KEYS.all });
	}

	/** BA7 "+": a receipt or payment on the account, filled in from the line, to finish and post in Vouchers. */
	makeEntry(row: ReconcileRow): void {
		const account = this.account.data();
		void this.router.navigate(['/accounts/vouchers/new'], {
			queryParams: {
				bankLedger: account?.ledgerId ?? '',
				location: account?.locationId ?? '',
				way: row.inPaise ? 'in' : 'out',
				amount: (row.inPaise || row.outPaise) / 100,
				date: row.date,
				narration: row.description,
			},
		});
	}

	/** Runs one decision; true when it went through. */
	private async run(work: () => Promise<unknown>, done: string | null): Promise<boolean> {
		this.busy.set(true);
		try {
			await work();
			if (done) this.notifier.showSuccess(this.transloco.translate(done));
			await this.queries.invalidateQueries({ queryKey: BANK_KEYS.all });
			return true;
		} catch (error) {
			const problem = statementProblem(apiProblem(error, 'failed'));
			this.notifier.showError(this.transloco.translate(problem.key, problem.params));
			return false;
		} finally {
			this.busy.set(false);
		}
	}
}
