import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { PAYROLL_KEYS, PayrollGateway } from '@core/accounts/payroll.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

import type { SalaryHead, SalaryTemplate, StructureComponentWrite } from '@saha-textile/contracts';

export const SALARY_HEADS: readonly SalaryHead[] = ['basic', 'da', 'hra', 'conveyance', 'special', 'other'];

/** S4's starting template: basic 40%, DA 5%, HRA 20%, conveyance ₹1,600, special the rest. */
export function starterComponents(): StructureComponentWrite[] {
	return [
		{ head: 'basic', how: 'percent', value: 40 },
		{ head: 'da', how: 'percent', value: 5 },
		{ head: 'hra', how: 'percent', value: 20 },
		{ head: 'conveyance', how: 'fixed', value: 1_600 },
		{ head: 'special', how: 'rest', value: 0 },
	];
}

/** Heads not yet used, for the next line. */
export function freeHeads(components: readonly StructureComponentWrite[]): SalaryHead[] {
	return SALARY_HEADS.filter((h) => !components.some((c) => c.head === h));
}

/**
 * Salary structures (accounts brief S4): a template sets each head as a % of pay, a fixed amount or the rest, previewed
 * on an example pay with what counts as wages, and a warning when basic and DA fall under half the pay.
 */
@Component({
	selector: 'app-salary-structures-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, HasPermissionDirective],
	templateUrl: './salary-structures-page.html',
})
export class SalaryStructuresPage {
	private readonly gateway = inject(PayrollGateway);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);
	private readonly queries = inject(QueryClient);

	readonly money = (inr: number) => rupees(Math.round(inr * 100));
	readonly heads = SALARY_HEADS;
	readonly templates = injectQuery(() => ({
		queryKey: PAYROLL_KEYS.structures,
		queryFn: () => firstValueFrom(this.gateway.structures()),
	}));
	readonly editing = signal<SalaryTemplate | null>(null);
	readonly name = signal('');
	readonly examplePayINR = signal(20_000);
	readonly components = signal<StructureComponentWrite[]>(starterComponents());
	readonly busy = signal(false);
	readonly free = computed(() => freeHeads(this.components()));
	readonly preview = injectQuery(() => ({
		queryKey: ['payroll', 'structure-preview', this.examplePayINR(), JSON.stringify(this.components())],
		queryFn: () =>
			firstValueFrom(
				this.gateway.previewStructure({ components: this.components(), payINR: this.examplePayINR() }),
			),
		enabled: this.components().length > 0 && this.examplePayINR() >= 0,
	}));

	pick(template: SalaryTemplate | null): void {
		this.editing.set(template);
		this.name.set(template?.name ?? '');
		this.examplePayINR.set(template?.examplePayINR ?? 20_000);
		this.components.set(template ? template.components.map((c) => ({ ...c })) : starterComponents());
	}

	setLine(index: number, patch: Partial<StructureComponentWrite>): void {
		this.components.update((list) => list.map((c, i) => (i === index ? { ...c, ...patch } : c)));
	}

	addLine(): void {
		const head = this.free()[0];
		if (head) this.components.update((list) => [...list, { head, how: 'fixed', value: 0 }]);
	}

	removeLine(index: number): void {
		this.components.update((list) => list.filter((_, i) => i !== index));
	}

	async save(): Promise<void> {
		const write = { name: this.name(), examplePayINR: this.examplePayINR(), components: this.components() };
		const editing = this.editing();
		this.busy.set(true);
		try {
			const saved = editing
				? await firstValueFrom(this.gateway.updateStructure(editing.id, { ...write, version: editing.version }))
				: await firstValueFrom(this.gateway.createStructure(write));
			this.editing.set(saved);
			this.notifier.showSuccess(this.transloco.translate('payroll_structure_saved'));
			await this.queries.invalidateQueries({ queryKey: PAYROLL_KEYS.structures });
		} catch (error) {
			this.notifier.showError(this.transloco.translate(`payroll_problem_${apiProblem(error, 'failed')}`));
		} finally {
			this.busy.set(false);
		}
	}
}
