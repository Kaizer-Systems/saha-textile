import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { MONEY_LANDING_KEY, MoneyLandingGateway } from '@core/accounts/money-landing.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';
import { NotificationService } from '@data-access/services/notification.service';

import { bankLedgers, cashAndBankLedgers } from './cash-bank-ledgers';

import type { ChartOfAccounts, Ledger, MoneyLandingWrite } from '@saha-textile/contracts';

type Field = keyof MoneyLandingWrite;

/** Each choice, and which ledgers it offers: banks only, cash only, or any active ledger. */
export const LANDING_FIELDS: readonly { field: Field; offers: 'bank' | 'cash' | 'any' }[] = [
	{ field: 'receivedByGateway', offers: 'any' },
	{ field: 'receivedByUpi', offers: 'any' },
	{ field: 'receivedByBank', offers: 'bank' },
	{ field: 'cashOnDelivery', offers: 'any' },
	{ field: 'paidByBank', offers: 'bank' },
	{ field: 'paidInCash', offers: 'cash' },
];

/**
 * Accounts › Ledgers › "Where money lands" (Postings and Convert brief AP1, approved 24 Nov): the ledger each way of
 * paying posts to. Empty means the role's own ledger (gateway clearing, UPI and card clearing, COD receivable, cash).
 */
@Component({
	selector: 'app-money-landing-card',
	imports: [TranslocoModule, FormsModule],
	templateUrl: './money-landing-card.html',
})
export class MoneyLandingCard {
	private readonly gateway = inject(MoneyLandingGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);

	readonly chart = input<ChartOfAccounts | undefined>(undefined);
	readonly canEdit = input(false);
	readonly fields = LANDING_FIELDS;
	readonly form = signal<MoneyLandingWrite | null>(null);
	readonly busy = signal(false);

	readonly landing = injectQuery(() => ({
		queryKey: MONEY_LANDING_KEY,
		queryFn: () => firstValueFrom(this.gateway.get()),
	}));

	constructor() {
		effect(() => {
			const data = this.landing.data();
			if (!data) return;
			const { updatedAt, updatedBy, ...write } = data;
			void updatedAt;
			void updatedBy;
			untracked(() => this.form.set(write));
		});
	}

	private readonly lists = computed(() => {
		const chart = this.chart();
		const cashOrBank = cashAndBankLedgers(chart);
		const banks = bankLedgers(chart);
		return {
			bank: banks,
			cash: cashOrBank.filter((l) => !banks.includes(l)),
			any: (chart?.ledgers ?? []).filter((l) => l.active),
		};
	});

	options(offers: 'bank' | 'cash' | 'any'): Ledger[] {
		return this.lists()[offers];
	}

	set(field: Field, value: string): void {
		this.form.update((form) => (form ? { ...form, [field]: value || null } : form));
	}

	async save(): Promise<void> {
		const form = this.form();
		if (!form) return;
		this.busy.set(true);
		try {
			await firstValueFrom(this.gateway.save(form));
			await this.queryClient.invalidateQueries({ queryKey: MONEY_LANDING_KEY });
			this.notifier.showSuccess(this.transloco.translate('ml_saved'));
		} catch (error) {
			const message = apiProblem(error, this.transloco.translate('ord_action_failed'));
			const field = /^money_landing_wrong_ledger:(\w+)$/.exec(message)?.[1];
			this.notifier.showError(
				this.transloco.translate(
					field ? 'ml_wrong_ledger' : message === 'money_landing_changed' ? 'ml_changed' : message,
					{
						field: field ? this.transloco.translate(`ml_${field}`) : '',
					},
				),
			);
		} finally {
			this.busy.set(false);
		}
	}
}
