import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { LEDGER_KEYS, LedgerGateway } from '@core/accounts/ledger.gateway';
import { LOCATION_KEYS, LocationsGateway } from '@core/locations/locations.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { rupees } from './ledger-helpers';

const today = (): string => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/**
 * One voucher with its lines (accounts brief Q3, Q5). A posted voucher is never edited: Reverse posts the opposite
 * entry on a chosen date with a reason (super admin; the API refuses anyone else).
 */
@Component({
	selector: 'app-voucher-view',
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink],
	templateUrl: './voucher-view.html',
})
export class VoucherViewPage {
	private readonly gateway = inject(LedgerGateway);
	private readonly locationsGateway = inject(LocationsGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly router = inject(Router);
	private readonly auth = inject(AuthStore);

	readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('id') ?? '')), { initialValue: '' });
	readonly canPost = computed(() => this.auth.permissions().includes('accounts.post'));
	readonly reversing = signal(false);
	readonly reverseDate = signal(today());
	readonly reason = signal('');
	readonly busy = signal(false);
	private readonly key = `rev-${crypto.randomUUID()}`;
	readonly rupees = rupees;

	readonly voucher = injectQuery(() => ({
		queryKey: LEDGER_KEYS.voucher(this.id()),
		queryFn: () => firstValueFrom(this.gateway.voucher(this.id())),
		enabled: !!this.id(),
	}));
	readonly chart = injectQuery(() => ({
		queryKey: LEDGER_KEYS.chart,
		queryFn: () => firstValueFrom(this.gateway.chart()),
	}));
	readonly locations = injectQuery(() => ({
		queryKey: LOCATION_KEYS.list,
		queryFn: () => firstValueFrom(this.locationsGateway.list()),
	}));
	readonly ledgerName = (id: string) => this.chart.data()?.ledgers.find((l) => l.id === id)?.name ?? id;
	readonly locationName = (id: string) => this.locations.data()?.find((l) => l.id === id)?.name ?? id;

	async reverse(): Promise<void> {
		this.busy.set(true);
		try {
			const reversal = await firstValueFrom(
				this.gateway.reverse(this.id(), {
					date: this.reverseDate(),
					reason: this.reason(),
					idempotencyKey: this.key,
				}),
			);
			await this.queryClient.invalidateQueries({ queryKey: ['accounts'] });
			this.notifier.showSuccess(this.transloco.translate('accounts_reversed_as', { number: reversal.number }));
			this.reversing.set(false);
			await this.router.navigate(['/accounts/vouchers', reversal.id]);
		} catch (error) {
			const code = (error as { error?: { error?: { message?: string } } }).error?.error?.message ?? '';
			this.notifier.showError(
				this.transloco.translate(
					code === 'reverse_super_admin_only'
						? 'accounts_reverse_super_admin'
						: code.startsWith('voucher_problem:')
							? `accounts_problem_${code.split(':')[1]}`
							: 'accounts_post_failed',
				),
			);
		} finally {
			this.busy.set(false);
		}
	}
}
