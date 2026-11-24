import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { LEDGER_KEYS, LedgerGateway } from '@core/accounts/ledger.gateway';
import { downloadCsv, shortDate } from '@core/purchasing/purchasing-format';
import { chartTree, rupees, type ChartNode } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { indent } from './statement-page';

import type { ChartOfAccounts } from '@saha-textile/contracts';

export interface TrialRow {
	name: string;
	depth: number;
	debitPaise: number;
	creditPaise: number;
}

/**
 * U4's rows: each top group's balance (debit positive), or at ledger level every ledger with a balance under its group.
 * A balance goes in Debit when positive, Credit when negative; zero balances are left out.
 */
export function trialRows(
	chart: ChartOfAccounts,
	balances: Readonly<Record<string, number>>,
	level: 'group' | 'ledger',
): TrialRow[] {
	const side = (paise: number) => ({ debitPaise: Math.max(0, paise), creditPaise: Math.max(0, -paise) });
	const rows: TrialRow[] = [];
	const walk = (nodes: ChartNode[], depth: number) => {
		for (const node of nodes) {
			if (!node.balancePaise && level === 'group') continue;
			if (level === 'group') {
				rows.push({ name: node.group.name, depth, ...side(node.balancePaise) });
				continue;
			}
			const ledgers = node.ledgers.filter((l) => l.balancePaise);
			if (!ledgers.length && !node.groups.some((g) => g.balancePaise)) continue;
			rows.push({ name: node.group.name, depth, debitPaise: 0, creditPaise: 0 });
			for (const l of ledgers) rows.push({ name: l.ledger.name, depth: depth + 1, ...side(l.balancePaise) });
			walk(node.groups, depth + 1);
		}
	};
	walk(chartTree(chart, balances), 0);
	return rows;
}

const istToday = (): string => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/** Trial balance (accounts brief U4): group level, or every ledger under its group, as at a day; debits equal credits. */
@Component({
	selector: 'app-trial-balance-page',
	imports: [PageWrapper, TranslocoModule, FormsModule],
	templateUrl: './trial-balance-page.html',
})
export class TrialBalancePage {
	private readonly ledger = inject(LedgerGateway);
	private readonly transloco = inject(TranslocoService);

	readonly indent = indent;
	readonly money = (paise: number) => (paise ? rupees(paise) : '');
	readonly asAt = signal(istToday());
	readonly level = signal<'group' | 'ledger'>('group');
	readonly chart = injectQuery(() => ({
		queryKey: LEDGER_KEYS.chart,
		queryFn: () => firstValueFrom(this.ledger.chart()),
	}));
	readonly balances = injectQuery(() => ({
		queryKey: LEDGER_KEYS.balances(this.asAt()),
		queryFn: () => firstValueFrom(this.ledger.balances(this.asAt())),
		enabled: /^\d{4}-\d{2}-\d{2}$/.test(this.asAt()),
	}));
	readonly rows = computed(() => {
		const chart = this.chart.data();
		const balances = this.balances.data();
		return chart && balances ? trialRows(chart, balances, this.level()) : [];
	});
	readonly totals = computed(() =>
		this.rows().reduce((sum, r) => ({ debit: sum.debit + r.debitPaise, credit: sum.credit + r.creditPaise }), {
			debit: 0,
			credit: 0,
		}),
	);

	day(date: string): string {
		return shortDate(date);
	}

	download(): void {
		downloadCsv(
			`trial-balance_${this.asAt()}.csv`,
			['', this.transloco.translate('accounts_debit'), this.transloco.translate('accounts_credit')],
			this.rows().map((r) => [
				`${'  '.repeat(r.depth)}${r.name}`,
				r.debitPaise / 100 || null,
				r.creditPaise / 100 || null,
			]),
		);
	}
}
