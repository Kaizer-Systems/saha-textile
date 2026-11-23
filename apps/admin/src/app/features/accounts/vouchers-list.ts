import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { LEDGER_KEYS, LedgerGateway } from '@core/accounts/ledger.gateway';
import { AuthStore } from '@core/state/auth.store';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { PeriodPicker } from '@shared/ui/period-picker/period-picker';

import { periodRange } from './edoc-list';
import { rupees } from './ledger-helpers';

import type { DashboardPeriodQuery, VoucherKind } from '@saha-textile/contracts';

const today = (): string => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/** Accounts › Vouchers (accounts brief A, Q3, Q4): every voucher in a period, by kind, with a search. */
@Component({
	selector: 'app-vouchers-list',
	imports: [PageWrapper, TranslocoModule, FormsModule, PeriodPicker, RouterLink],
	templateUrl: './vouchers-list.html',
})
export class VouchersListPage {
	private readonly gateway = inject(LedgerGateway);
	private readonly auth = inject(AuthStore);
	readonly canPost = computed(() => this.auth.permissions().includes('accounts.post'));
	readonly kinds: VoucherKind[] = ['journal', 'receipt', 'payment', 'contra', 'opening', 'document'];
	readonly tab = signal<'posted' | 'drafts'>('posted');
	readonly kind = signal<VoucherKind | ''>('');
	readonly search = signal('');
	readonly range = signal(periodRange({ period: 'last_30_days' }));
	readonly page = signal(1);
	readonly rupees = rupees;

	readonly query = injectQuery(() => ({
		queryKey: [...LEDGER_KEYS.vouchers, this.kind(), this.search(), this.range(), this.page()],
		queryFn: () =>
			firstValueFrom(
				this.gateway.vouchers({
					from: this.range().from ?? '2000-01-01',
					to: this.range().to ?? today(),
					kinds: this.kind() ? [this.kind() as VoucherKind] : [],
					search: this.search().trim(),
					page: this.page(),
				}),
			),
	}));
	readonly pages = computed(() => Math.max(1, Math.ceil((this.query.data()?.total ?? 0) / 25)));
	private readonly queryClient = inject(QueryClient);
	/** Q3 drafts: saved, not posted, no number. */
	readonly drafts = injectQuery(() => ({
		queryKey: LEDGER_KEYS.drafts,
		queryFn: () => firstValueFrom(this.gateway.drafts()),
		enabled: this.canPost(),
	}));
	readonly draftTotal = (lines: { debitPaise: number }[]) => lines.reduce((sum, l) => sum + l.debitPaise, 0);

	async deleteDraft(id: string): Promise<void> {
		await firstValueFrom(this.gateway.deleteDraft(id));
		await this.queryClient.invalidateQueries({ queryKey: LEDGER_KEYS.drafts });
	}

	setPeriod(q: DashboardPeriodQuery): void {
		this.range.set(periodRange(q));
		this.page.set(1);
	}
}
