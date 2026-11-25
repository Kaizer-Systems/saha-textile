import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { YEAR_CLOSE_KEYS, YearCloseGateway } from '@core/accounts/year-close.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

import type {
	ProfitChoice,
	ProfitChoiceOption,
	ProfitShareRow,
	YearCloseCheck,
	YearCloseView,
} from '@saha-textile/contracts';

/** A year's label, `2025-26`, for the year starting in April of `start`. */
export function yearLabel(start: number): string {
	return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** The last financial year that has ended on a day (India): in November 2026, 2025-26. */
export function lastEndedYear(now = new Date()): string {
	const day = new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
	const y = Number(day.slice(0, 4));
	return yearLabel(day.slice(5) >= '04-01' ? y - 1 : y - 2);
}

/** The years offered: the one running now and the three before it. */
export function yearChoices(now = new Date()): string[] {
	const start = Number(lastEndedYear(now).slice(0, 4)) + 1;
	return [0, 1, 2, 3].map((back) => yearLabel(start - back));
}

/** A check's icon, as drawn: done, needs doing, a warning, or not in use. */
export function checkIcon(state: YearCloseCheck['state']): string {
	return {
		ok: 'ri-checkbox-circle-line text-success',
		attention: 'ri-close-circle-line text-danger',
		warning: 'ri-error-warning-line text-warning',
		not_in_use: 'ri-checkbox-blank-circle-line text-muted',
	}[state];
}

/**
 * Close the year (accounts brief T3): the ten checks with what is still open, the closing entries, then the year locked
 * for everyone. The accountant prepares; the owner or the CA closes.
 */
@Component({
	selector: 'app-year-close-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink, HasPermissionDirective, DatePipe],
	templateUrl: './year-close-page.html',
})
export class YearClosePage {
	private readonly gateway = inject(YearCloseGateway);
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);
	private readonly queries = inject(QueryClient);

	readonly money = rupees;
	readonly icon = checkIcon;
	readonly years = yearChoices();
	readonly year = toSignal(this.route.queryParamMap.pipe(map((q) => q.get('year') ?? lastEndedYear())), {
		initialValue: lastEndedYear(),
	});
	readonly view = injectQuery(() => ({
		queryKey: YEAR_CLOSE_KEYS.one(this.year()),
		queryFn: () => firstValueFrom(this.gateway.view(this.year())),
	}));
	readonly note = signal('');
	readonly busy = signal(false);
	readonly checks = computed(() => this.view.data()?.checks ?? []);
	/** YC1: the choice being picked, until it is saved (null: the one in force). */
	readonly picked = signal<ProfitChoice | null>(null);
	readonly chosen = computed(() => this.picked() ?? this.view.data()?.profitChoice ?? null);
	readonly dirty = computed(() => {
		const picked = this.picked();
		const saved = this.view.data()?.profitChoice;
		return !!picked && !!saved && JSON.stringify(picked) !== JSON.stringify(saved);
	});
	/** YC3's rows, one per part of the sharing, with a figure for each partner. */
	readonly shareParts = ['interestPaise', 'remunerationPaise', 'sharePaise', 'totalPaise', 'tdsPaise'] as const;

	total(rows: readonly ProfitShareRow[], part: (typeof this.shareParts)[number]): number {
		return rows.reduce((sum, row) => sum + row[part], 0);
	}

	pickChoice(option: ProfitChoiceOption): void {
		const now = this.chosen();
		this.picked.set({ option, reserveBasis: now?.reserveBasis ?? 'percent', reserveValue: now?.reserveValue ?? 0 });
	}

	setReserve(change: Partial<Pick<ProfitChoice, 'reserveBasis' | 'reserveValue'>>): void {
		const now = this.chosen();
		if (now)
			this.picked.set({
				...now,
				...change,
				reserveValue: Math.max(0, Number(change.reserveValue ?? now.reserveValue) || 0),
			});
	}

	async saveChoice(): Promise<void> {
		const profitChoice = this.chosen();
		if (!profitChoice) return;
		await this.act(() => firstValueFrom(this.gateway.confirm(this.year(), { profitChoice })), 'year_close_saved');
		this.picked.set(null);
	}

	pick(year: string): void {
		void this.router.navigate([], { queryParams: { year } });
	}

	private async act(call: () => Promise<YearCloseView>, done: string): Promise<void> {
		this.busy.set(true);
		try {
			await call();
			this.notifier.showSuccess(this.transloco.translate(done));
			await this.queries.invalidateQueries({ queryKey: YEAR_CLOSE_KEYS.one(this.year()) });
		} catch (error) {
			this.notifier.showError(this.transloco.translate(`year_close_problem_${apiProblem(error, 'failed')}`));
		} finally {
			this.busy.set(false);
		}
	}

	confirmAccruals(): Promise<void> {
		return this.act(
			() => firstValueFrom(this.gateway.confirm(this.year(), { accruals: true })),
			'year_close_saved',
		);
	}

	carrySuspense(): Promise<void> {
		return this.act(
			() => firstValueFrom(this.gateway.confirm(this.year(), { suspenseNote: this.note() })),
			'year_close_saved',
		);
	}

	postClosing(): Promise<void> {
		return this.act(() => firstValueFrom(this.gateway.postClosing(this.year())), 'year_close_posted');
	}

	close(): Promise<void> {
		return this.act(() => firstValueFrom(this.gateway.close(this.year())), 'year_close_closed');
	}
}
