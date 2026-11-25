import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, injectQuery, keepPreviousData } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { PAYROLL_KEYS, PayrollGateway } from '@core/accounts/payroll.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';

import type { EmployeeView, SalaryHead, SalaryRevisionInputValue } from '@saha-textile/contracts';

type Structure = EmployeeView['structure'];
export type RevisionKind = 'percent' | 'amount' | 'ctc' | 'heads';

/** The first day of next month in India: where a revision usually starts. */
export function nextMonthStart(now = new Date()): string {
	const ist = new Date(now.getTime() + 5.5 * 3_600_000);
	return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

/**
 * Revise pay (brief 26 SR2, approved 2026-11-26): four ways in (a %, an amount, a new CTC kept locked, or head by
 * head), the breakup worked out by the API as it is typed (now, new and the change), any head typed over after, the
 * arrears and the checks; a decrease needs the person's agreement; Accept saves the new salary from its day.
 */
@Component({
	selector: 'app-revise-pay-popup',
	imports: [TranslocoModule, FormsModule],
	templateUrl: './revise-pay-popup.html',
})
export class RevisePayPopup {
	readonly active = inject(NgbActiveModal);
	private readonly gateway = inject(PayrollGateway);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);
	private readonly queries = inject(QueryClient);

	readonly employee = signal<EmployeeView | null>(null);
	readonly kind = signal<RevisionKind>('percent');
	readonly pct = signal(8);
	readonly amount = signal(0);
	readonly per = signal<'month' | 'year'>('month');
	readonly ctcYear = signal(0);
	/** Head by head: the heads as typed. */
	readonly heads = signal<Structure>({ basic: 0, da: 0, hra: 0, special: 0, conveyance: 0, other: 0 });
	/** Heads typed over after the figures appear. */
	readonly typed = signal<Partial<Record<SalaryHead, number>>>({});
	readonly lockCtc = signal(true);
	readonly from = signal(nextMonthStart());
	readonly reason = signal('');
	readonly agreed = signal(false);
	readonly busy = signal(false);

	start(e: EmployeeView): void {
		this.employee.set(e);
		this.ctcYear.set(e.ctcYearINR ?? 0);
		this.heads.set({ ...e.structure });
	}

	/** The revision as the API takes it. */
	readonly input = computed((): SalaryRevisionInputValue => {
		const kind = this.kind();
		const way =
			kind === 'percent'
				? { kind, pct: this.pct() }
				: kind === 'amount'
					? { kind, monthINR: this.per() === 'year' ? this.amount() / 12 : this.amount() }
					: kind === 'ctc'
						? { kind, yearINR: this.ctcYear() }
						: { kind, structure: this.heads() };
		return {
			way,
			from: this.from(),
			typed: kind === 'heads' ? {} : this.typed(),
			lockCtc: this.lockCtc(),
			reason: this.reason().trim() || 'Revision',
			agreed: this.agreed(),
		};
	});

	/** Whether what is typed can be worked out at all (a new CTC must be above nothing, the day a day). */
	readonly ready = computed(
		() =>
			!!this.employee() &&
			/^\d{4}-\d{2}-\d{2}$/.test(this.from()) &&
			(this.kind() !== 'ctc' || this.ctcYear() > 0),
	);

	readonly preview = injectQuery(() => ({
		queryKey: [...PAYROLL_KEYS.all, 'revision', this.employee()?.id ?? '', JSON.stringify(this.input())],
		queryFn: () => firstValueFrom(this.gateway.revisionPreview(this.employee()?.id ?? '', this.input())),
		enabled: this.ready(),
		placeholderData: keepPreviousData,
	}));

	readonly blocking = computed(() => (this.preview.data()?.checks ?? []).some((c) => c.blocking));

	setKind(kind: RevisionKind): void {
		this.kind.set(kind);
		this.typed.set({});
	}

	/** A head typed in the New column: over the worked-out figure, or (head by head) the head itself. */
	setHead(head: SalaryHead, value: unknown): void {
		const n = Math.max(0, Number(value) || 0);
		if (this.kind() === 'heads') this.heads.update((h) => ({ ...h, [head]: n }));
		else this.typed.update((t) => ({ ...t, [head]: n }));
	}

	async accept(): Promise<void> {
		const e = this.employee();
		if (!e) return;
		this.busy.set(true);
		try {
			await firstValueFrom(this.gateway.reviseSalary(e.id, { ...this.input(), reason: this.reason().trim() }));
			this.notifier.showSuccess(this.transloco.translate('rev_accepted'));
			await this.queries.invalidateQueries({ queryKey: PAYROLL_KEYS.all });
			this.active.close(true);
		} catch (error) {
			this.notifier.showError(this.transloco.translate(`payroll_problem_${apiProblem(error, 'failed')}`));
		} finally {
			this.busy.set(false);
		}
	}
}
