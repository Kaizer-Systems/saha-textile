import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { RETURN_KEYS, ReturnsGateway, returnProblemKey } from '@core/accounts/returns.gateway';
import { apiProblem, openPdf } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import type { OrderReturn, ReturnOutcome, ReturnStatus } from '@saha-textile/contracts';

export const RETURN_STEPS: readonly ReturnStatus[] = [
	'asked',
	'pickup_booked',
	'received',
	'checked',
	'credit_note',
	'refunded',
];
export const OUTCOMES: readonly ReturnOutcome[] = ['restock', 'damaged', 'write_off'];

/** A return (accounts brief B3, as drawn): where it is, each piece checked, then the credit note. */
@Component({
	selector: 'app-return-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink],
	templateUrl: './return-page.html',
})
export class ReturnPage {
	private readonly gateway = inject(ReturnsGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly router = inject(Router);

	readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('id') ?? '')), { initialValue: '' });
	readonly steps = RETURN_STEPS;
	readonly outcomes = OUTCOMES;
	readonly busy = signal(false);
	readonly choices = signal<Record<string, { outcome: ReturnOutcome; note: string }>>({});
	readonly entry = injectQuery(() => ({
		queryKey: RETURN_KEYS.one(this.id()),
		queryFn: () => firstValueFrom(this.gateway.getReturn(this.id())),
		enabled: !!this.id(),
	}));
	readonly checkable = computed(() => ['received', 'checked'].includes(this.entry.data()?.status ?? ''));

	/** When a step was reached, from the return's timeline; null when not yet. */
	reached(entry: OrderReturn, step: ReturnStatus): string | null {
		const at = entry.timeline.find((t) => t.status === step)?.at;
		return at ? new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null;
	}

	choice(lineId: string, current: { outcome: ReturnOutcome | null; note: string }) {
		return this.choices()[lineId] ?? { outcome: current.outcome ?? 'restock', note: current.note };
	}

	setChoice(
		lineId: string,
		current: { outcome: ReturnOutcome | null; note: string },
		patch: Partial<{ outcome: ReturnOutcome; note: string }>,
	) {
		this.choices.update((all) => ({ ...all, [lineId]: { ...this.choice(lineId, current), ...patch } }));
	}

	private async run(work: () => Promise<void>): Promise<void> {
		this.busy.set(true);
		try {
			await work();
			await this.queryClient.invalidateQueries({ queryKey: RETURN_KEYS.one(this.id()) });
		} catch (error) {
			const message = apiProblem(error, this.transloco.translate('ord_action_failed'));
			const problem = returnProblemKey(message);
			this.notifier.showError(problem ? this.transloco.translate(problem.key, problem.params) : message);
		} finally {
			this.busy.set(false);
		}
	}

	/** B3 "Print return note". */
	printNote(): Promise<void> {
		return this.run(async () => openPdf(await firstValueFrom(this.gateway.returnNotePdf(this.id()))));
	}

	step(to: 'pickup_booked' | 'received'): Promise<void> {
		return this.run(async () => void (await firstValueFrom(this.gateway.step(this.id(), { to }))));
	}

	saveCheck(entry: OrderReturn): Promise<void> {
		return this.run(async () => {
			const lines = entry.lines.map((line) => ({ lineId: line.lineId, ...this.choice(line.lineId, line) }));
			await firstValueFrom(this.gateway.check(this.id(), { lines }));
			this.notifier.showSuccess(this.transloco.translate('ret_check_saved'));
		});
	}

	makeCreditNote(entry: OrderReturn): Promise<void> {
		return this.run(async () => {
			if (entry.status !== 'checked')
				await firstValueFrom(
					this.gateway.check(this.id(), {
						lines: entry.lines.map((line) => ({ lineId: line.lineId, ...this.choice(line.lineId, line) })),
					}),
				);
			const draft = await firstValueFrom(this.gateway.creditNoteFromReturn(this.id()));
			await this.router.navigate(['/accounts/credit-notes', draft.id]);
		});
	}
}
