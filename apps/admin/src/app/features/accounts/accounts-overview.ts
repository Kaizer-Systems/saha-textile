import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { ACCOUNTS_LIST_KEYS, AccountsListsGateway } from '@core/accounts/accounts-lists.gateway';
import { rupees, shortDate } from '@core/purchasing/purchasing-format';
import { AuthStore } from '@core/state/auth.store';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { PeriodPicker, type PeriodChoice, type PeriodPreset } from '@shared/ui/period-picker/period-picker';

import { accountsHint, accountsRange } from './accounts-period';

import type { OverviewWaiting } from '@saha-textile/contracts';

/** Where each waiting item is worked on (a Vouchers tab, or stock approvals), and its icon. */
export const WAITING_LINKS: Readonly<Record<OverviewWaiting['kind'], { path: string; icon: string }>> = {
	voucherDrafts: { path: '/accounts/vouchers/journal', icon: 'ri-draft-line' },
	creditNoteDrafts: { path: '/accounts/vouchers/creditNotes', icon: 'ri-file-reduce-line' },
	selfInvoicesDue: { path: '/accounts/vouchers/selfInvoices', icon: 'ri-time-line' },
	adjustmentsWaiting: { path: '/stock/approvals', icon: 'ri-shield-user-line' },
	refundsFailed: { path: '/accounts/vouchers/refundVouchers', icon: 'ri-error-warning-line' },
};

/** "November" for 2026-11, in the reader's language (Bengali month names keep English digits elsewhere). */
export function monthName(month: string, lang: string): string {
	const [y, m] = month.split('-').map(Number) as [number, number];
	return new Date(Date.UTC(y, m - 1, 1)).toLocaleString(lang === 'bn' ? 'bn-IN' : 'en-GB', {
		month: 'long',
		timeZone: 'UTC',
	});
}

/**
 * Accounts › Overview (accounts brief Q0): cash, bank, who owes whom, the month's GST, whether the month is locked,
 * the year's profit and stock at cost, then what is waiting for someone, each opening where it is worked on.
 */
@Component({
	selector: 'app-accounts-overview',
	imports: [PageWrapper, TranslocoModule, RouterLink, PeriodPicker],
	templateUrl: './accounts-overview.html',
})
export class AccountsOverviewPage {
	private readonly gateway = inject(AccountsListsGateway);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);

	readonly months: readonly PeriodPreset[] = ['this_month', 'last_month'];
	readonly hint = accountsHint;
	readonly links = WAITING_LINKS;
	readonly month = signal<string | null>(null);
	readonly canPost = computed(() => this.auth.permissions().includes('accounts.post'));
	private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

	readonly overview = injectQuery(() => ({
		queryKey: [...ACCOUNTS_LIST_KEYS.all, 'overview', this.month()],
		queryFn: () => firstValueFrom(this.gateway.overview(this.month())),
	}));

	readonly inr = (paise: number) => rupees(paise / 100);
	readonly day = shortDate;

	/** The month's name for the GST and period cards. */
	readonly monthLabel = computed(() => {
		const month = this.overview.data()?.month;
		return month ? monthName(month, this.lang()) : '';
	});

	readonly nameOf = (month: string) => monthName(month, this.lang());

	setMonth(choice: PeriodChoice): void {
		this.month.set(accountsRange(choice).from.slice(0, 7));
	}
}
