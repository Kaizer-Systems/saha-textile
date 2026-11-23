import { Component, computed, inject, signal, type TemplateRef } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { LEDGER_KEYS, LedgerGateway } from '@core/accounts/ledger.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import type { BookPart, PeriodLock, PeriodState } from '@saha-textile/contracts';

/** T1's columns: "Cash and bank" is one column over the two parts. */
export const PERIOD_COLUMNS: { key: string; parts: BookPart[] }[] = [
	{ key: 'sales', parts: ['sales'] },
	{ key: 'purchases', parts: ['purchases'] },
	{ key: 'stock', parts: ['stock'] },
	{ key: 'cash_bank', parts: ['cash', 'bank'] },
	{ key: 'payroll', parts: ['payroll'] },
	{ key: 'journal', parts: ['journal'] },
];

/** A column's state in a month: the strictest of its parts (locked > closed for staff > open). */
export function columnState(locks: readonly PeriodLock[], month: string, parts: readonly BookPart[]): PeriodState {
	const rank: Record<PeriodState, number> = { open: 0, closed_for_staff: 1, locked: 2 };
	return parts
		.map((part) => locks.find((l) => l.month === month && l.part === part)?.state ?? 'open')
		.reduce<PeriodState>((worst, s) => (rank[s] > rank[worst] ? s : worst), 'open');
}

/**
 * Accounts › Periods and locks (accounts brief T1, T2, as drawn): each part of the books per month, open, closed
 * for staff or locked; Lock a month closes or locks everything or chosen parts with a reason. Reopening is for
 * the super admin (the API refuses others) and is logged.
 */
@Component({
	selector: 'app-periods',
	imports: [PageWrapper, TranslocoModule, FormsModule],
	templateUrl: './periods.html',
})
export class PeriodsPage {
	private readonly gateway = inject(LedgerGateway);
	private readonly modals = inject(NgbModal);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);

	readonly columns = PERIOD_COLUMNS;
	readonly allParts: BookPart[] = ['sales', 'purchases', 'stock', 'cash', 'bank', 'payroll', 'journal'];
	readonly canLock = computed(() => this.auth.permissions().includes('accounts.lock'));
	readonly grid = injectQuery(() => ({
		queryKey: LEDGER_KEYS.periods,
		queryFn: () => firstValueFrom(this.gateway.periods()),
	}));
	/** This financial year by default; the year before one click away. */
	readonly year = signal<'this' | 'last'>('this');
	readonly months = computed(() => {
		const months = this.grid.data()?.months ?? [];
		return this.year() === 'this' ? months.slice(12) : months.slice(0, 12);
	});
	readonly yearLabel = computed(() => {
		const first = this.months()[0] ?? '';
		const start = Number(first.slice(0, 4));
		return start ? `${start}-${String((start + 1) % 100).padStart(2, '0')}` : '';
	});
	readonly state = (month: string, parts: readonly BookPart[]) =>
		columnState(this.grid.data()?.locks ?? [], month, parts);

	readonly lockMonth = signal('');
	readonly everything = signal(true);
	readonly chosen = signal<ReadonlySet<BookPart>>(new Set());
	readonly lockState = signal<PeriodState>('locked');
	readonly reason = signal('');
	readonly busy = signal(false);
	private modal: NgbModalRef | null = null;

	open(template: TemplateRef<unknown>, month?: string): void {
		const currentMonth = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 7);
		this.lockMonth.set(month ?? this.months().find((m) => m === currentMonth) ?? this.months()[0] ?? '');
		this.everything.set(true);
		this.chosen.set(new Set());
		this.lockState.set('locked');
		this.reason.set('');
		this.modal = this.modals.open(template, { centered: true, size: 'lg' });
	}

	toggle(part: BookPart, on: boolean): void {
		const next = new Set(this.chosen());
		if (on) next.add(part);
		else next.delete(part);
		this.chosen.set(next);
	}

	async lock(): Promise<void> {
		this.busy.set(true);
		try {
			await firstValueFrom(
				this.gateway.lock({
					months: [this.lockMonth()],
					parts: this.everything() ? this.allParts : [...this.chosen()],
					state: this.lockState(),
					reason: this.reason(),
				}),
			);
			await this.queryClient.invalidateQueries({ queryKey: LEDGER_KEYS.periods });
			this.notifier.showSuccess(this.transloco.translate('accounts_period_saved'));
			this.modal?.close();
		} catch (error) {
			const code = (error as { error?: { error?: { message?: string } } }).error?.error?.message ?? '';
			this.notifier.showError(
				this.transloco.translate(
					code === 'reopen_super_admin_only' ? 'accounts_reopen_super_admin' : 'accounts_period_failed',
				),
			);
		} finally {
			this.busy.set(false);
		}
	}
}
