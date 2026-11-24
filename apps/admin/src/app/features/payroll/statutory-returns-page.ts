import { Component, computed, inject, signal, type TemplateRef } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { PAYROLL_KEYS, PayrollGateway } from '@core/accounts/payroll.gateway';
import { apiProblem, saveBlob, shortDate } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';
import { rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

import { periodLabel, splitReturns } from './payroll-format';

import type { StatutoryReturn } from '@saha-textile/contracts';

const istToday = (): string => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/**
 * Statutory returns (accounts brief S7): PF ECR, ESI, professional tax and the labour welfare fund each month, TDS on
 * salary each quarter; each with its due day, the file its portal takes, and a filed mark with the portal's reference.
 */
@Component({
	selector: 'app-statutory-returns-page',
	imports: [PageWrapper, TranslocoModule, FormsModule, HasPermissionDirective],
	templateUrl: './statutory-returns-page.html',
})
export class StatutoryReturnsPage {
	private readonly gateway = inject(PayrollGateway);
	private readonly modals = inject(NgbModal);
	private readonly transloco = inject(TranslocoService);
	private readonly notifier = inject(NotificationService);
	private readonly queries = inject(QueryClient);

	readonly money = rupees;
	readonly tab = signal<'due' | 'filed'>('due');
	readonly returns = injectQuery(() => ({
		queryKey: PAYROLL_KEYS.statutory,
		queryFn: () => firstValueFrom(this.gateway.statutory()),
	}));
	readonly split = computed(() => splitReturns(this.returns.data() ?? []));
	readonly shown = computed(() => this.split()[this.tab()]);
	readonly filing = signal<StatutoryReturn | null>(null);
	readonly reference = signal('');
	readonly filedOn = signal(istToday());
	readonly busy = signal(false);
	private modal: NgbModalRef | null = null;

	period(r: StatutoryReturn): string {
		return periodLabel(r, this.transloco.getActiveLang());
	}

	filingName(): string {
		const r = this.filing();
		return r ? this.transloco.translate(`payroll_return_${r.kind}`) : '';
	}

	day(date: string | null): string {
		return shortDate(date);
	}

	async download(r: StatutoryReturn): Promise<void> {
		try {
			const file = await firstValueFrom(this.gateway.statutoryFile(r.kind, r.period));
			saveBlob(file.fileName, new Blob([file.text], { type: 'text/plain;charset=utf-8' }));
		} catch (error) {
			this.notifier.showError(this.transloco.translate(`payroll_problem_${apiProblem(error, 'failed')}`));
		}
	}

	open(template: TemplateRef<unknown>, r: StatutoryReturn): void {
		this.filing.set(r);
		this.reference.set('');
		this.filedOn.set(istToday());
		this.modal = this.modals.open(template, { centered: true });
	}

	async markFiled(): Promise<void> {
		const r = this.filing();
		if (!r) return;
		this.busy.set(true);
		try {
			await firstValueFrom(
				this.gateway.markFiled(r.kind, r.period, { reference: this.reference(), filedOn: this.filedOn() }),
			);
			this.notifier.showSuccess(this.transloco.translate('payroll_statutory_marked'));
			await this.queries.invalidateQueries({ queryKey: PAYROLL_KEYS.statutory });
			this.modal?.close();
		} catch (error) {
			this.notifier.showError(this.transloco.translate(`payroll_problem_${apiProblem(error, 'failed')}`));
		} finally {
			this.busy.set(false);
		}
	}
}
