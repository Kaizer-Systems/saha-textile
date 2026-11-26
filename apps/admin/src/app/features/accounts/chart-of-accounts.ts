import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { LEDGER_KEYS, LedgerGateway } from '@core/accounts/ledger.gateway';
import { COMPANY_KEYS, CompanyGateway } from '@core/company/company.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { type ChartNode, chartTree, drCr } from './ledger-helpers';
import { MoneyLandingCard } from './money-landing-card';

import type { Ledger } from '@saha-textile/contracts';

/** The day in India, for "balances today". */
const indiaToday = (): string => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

type Editing =
	| { kind: 'group'; name: string; parentId: string }
	| {
			kind: 'ledger';
			id: string | null;
			name: string;
			groupId: string;
			active: boolean;
			expectedUpdatedAt: string | null;
			system: boolean;
	  };

/**
 * Accounts › Ledgers: the chart of accounts (accounts brief Q1, as drawn; owner-approved 2026-11-23). Groups and
 * ledgers made for the kind of business, each with today's balance; system ledgers are marked and only documents
 * post to them. Add group, Add ledger and a ledger's pencil open the form in the side column.
 */
@Component({
	selector: 'app-chart-of-accounts',
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink, NgTemplateOutlet, MoneyLandingCard],
	templateUrl: './chart-of-accounts.html',
})
export class ChartOfAccountsPage {
	private readonly gateway = inject(LedgerGateway);
	private readonly company = inject(CompanyGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);

	readonly today = indiaToday();
	readonly canEdit = computed(() => this.auth.permissions().includes('accounts.edit'));
	readonly chart = injectQuery(() => ({
		queryKey: LEDGER_KEYS.chart,
		queryFn: () => firstValueFrom(this.gateway.chart()),
	}));
	readonly balances = injectQuery(() => ({
		queryKey: LEDGER_KEYS.balances(this.today),
		queryFn: () => firstValueFrom(this.gateway.balances(this.today)),
	}));
	readonly profile = injectQuery(() => ({
		queryKey: COMPANY_KEYS.profile,
		queryFn: () => firstValueFrom(this.company.profile()),
	}));
	readonly tree = computed<ChartNode[]>(() => {
		const chart = this.chart.data();
		return chart ? chartTree(chart, this.balances.data() ?? {}) : [];
	});
	/** Top-level groups start open, as drawn. */
	readonly open = signal<ReadonlySet<string>>(new Set());
	private opened = false;
	readonly isOpen = (id: string, depth: number) => this.open().has(id) || (depth === 0 && !this.closedTop().has(id));
	readonly closedTop = signal<ReadonlySet<string>>(new Set());
	readonly editing = signal<Editing | null>(null);
	readonly saving = signal(false);
	readonly drCr = drCr;

	/** Bootstrap's own left padding steps for each level of the tree. */
	indent(depth: number): string {
		return ['ps-2', 'ps-4', 'ps-5', 'ps-5 ms-3', 'ps-5 ms-5'][Math.min(depth, 4)] ?? 'ps-2';
	}

	toggle(id: string, depth: number): void {
		void this.opened;
		if (depth === 0) {
			const next = new Set(this.closedTop());
			if (next.has(id)) next.delete(id);
			else next.add(id);
			this.closedTop.set(next);
			return;
		}
		const next = new Set(this.open());
		if (next.has(id)) next.delete(id);
		else next.add(id);
		this.open.set(next);
	}

	addGroup(): void {
		const first = this.tree()[0]?.group.id ?? '';
		this.editing.set({ kind: 'group', name: '', parentId: first });
	}

	addLedger(): void {
		const groups = this.chart.data()?.groups ?? [];
		this.editing.set({
			kind: 'ledger',
			id: null,
			name: '',
			groupId: groups.find((g) => g.systemKey === 'indirect_expenses')?.id ?? groups[0]?.id ?? '',
			active: true,
			expectedUpdatedAt: null,
			system: false,
		});
	}

	editLedger(ledger: Ledger): void {
		this.editing.set({
			kind: 'ledger',
			id: ledger.id,
			name: ledger.name,
			groupId: ledger.groupId,
			active: ledger.active,
			expectedUpdatedAt: ledger.updatedAt,
			system: !!ledger.systemKey,
		});
	}

	patch(change: Partial<Editing>): void {
		const current = this.editing();
		if (current) this.editing.set({ ...current, ...change } as Editing);
	}

	async save(): Promise<void> {
		const form = this.editing();
		if (!form || !this.canEdit()) return;
		this.saving.set(true);
		try {
			if (form.kind === 'group')
				await firstValueFrom(this.gateway.addGroup({ name: form.name, parentId: form.parentId }));
			else if (form.id)
				await firstValueFrom(
					this.gateway.saveLedger(form.id, {
						name: form.name,
						groupId: form.groupId,
						active: form.active,
						expectedUpdatedAt: form.expectedUpdatedAt,
					}),
				);
			else
				await firstValueFrom(
					this.gateway.addLedger({
						name: form.name,
						groupId: form.groupId,
						active: form.active,
						expectedUpdatedAt: null,
					}),
				);
			await this.queryClient.invalidateQueries({ queryKey: ['accounts'] });
			this.notifier.showSuccess(this.transloco.translate('accounts_chart_saved'));
			this.editing.set(null);
		} catch (error) {
			const code = (error as { error?: { error?: { message?: string } } }).error?.error?.message ?? '';
			this.notifier.showError(
				this.transloco.translate(
					code === 'ledger_changed' ? 'accounts_ledger_changed' : 'accounts_chart_save_failed',
				),
			);
		} finally {
			this.saving.set(false);
		}
	}
}
