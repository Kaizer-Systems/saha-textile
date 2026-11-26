import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { BANK_CHIPS, BANK_KEYS, BanksGateway } from '@core/accounts/banks.gateway';
import { escapeHtml } from '@core/purchasing/purchasing-format';
import { rupees } from '@features/accounts/ledger-helpers';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Table } from '@shared/ui/table/table';

import type { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import type { BankAccountRow } from '@saha-textile/contracts';

type Chip = (typeof BANK_CHIPS)[number];
type BankTableRow = BankAccountRow & { row: BankAccountRow; [key: string]: unknown };
const CHIP_OF: Record<BankAccountRow['kind'], Chip> = {
	current: 'current',
	savings: 'current',
	cash_credit: 'credit',
	overdraft: 'credit',
	fixed_deposit: 'deposits',
};

/** "₹4,34,388.00 Dr" from a debit-less-credit balance in paise. */
export function drCr(paise: number): string {
	return `${rupees(Math.abs(paise))} ${paise < 0 ? 'Cr' : 'Dr'}`;
}

/** Accounts › Bank accounts (BA1): every account with its kind, masked number, balance in the books and what lands there. */
@Component({
	selector: 'app-banks-list',
	imports: [PageWrapper, TranslocoModule, Table, HasPermissionDirective],
	templateUrl: './banks-list.html',
})
export class BanksListPage {
	private readonly gateway = inject(BanksGateway);
	private readonly router = inject(Router);
	private readonly transloco = inject(TranslocoService);
	private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

	readonly chips = BANK_CHIPS;
	readonly chip = signal<Chip>('all');
	readonly list = injectQuery(() => ({
		queryKey: BANK_KEYS.list,
		queryFn: () => firstValueFrom(this.gateway.list()),
	}));
	readonly counts = computed(() => this.list.data()?.counts);

	readonly tableConfig = computed((): ITableConfig<BankTableRow> => {
		this.lang();
		const t = (key: string) => this.transloco.translate(key);
		const items = (this.list.data()?.items ?? []).filter(
			(a) => this.chip() === 'all' || CHIP_OF[a.kind] === this.chip(),
		);
		return {
			columns: [
				{ title: 'bank_account', dataField: 'accountHtml' },
				{ title: 'bank_kind', dataField: 'kindText' },
				{ title: 'bank_number', dataField: 'numberShown' },
				{ title: 'bank_in_books', dataField: 'balanceText', align: 'end' },
				{ title: 'bank_last_statement', dataField: 'statementText' },
			],
			rowActions: [
				{ label: 'al_view', actionToPerform: 'view', icon: 'ri-eye-line', permission: 'accounts.index' },
			],
			data: items.map((row) => ({
				...row,
				row,
				accountHtml: `${escapeHtml(row.shortName)}<small class="d-block text-muted">${escapeHtml(
					row.lands.map((key) => t(`bank_lands_${key}`)).join(', ') || row.bankName,
				)}</small>`,
				kindText: t(`bank_kind_${row.kind}`),
				balanceText: drCr(row.balancePaise),
				statementText: row.lastStatementOn ?? '—',
			})),
			total: items.length,
		};
	});

	open(row: BankTableRow): void {
		void this.router.navigate(['/accounts/banks', row.id]);
	}

	onAction(action: ITableClickedAction): void {
		const row = action.data as BankTableRow | undefined;
		if (action.actionToPerform === 'view' && row) this.open(row);
	}

	add(): void {
		void this.router.navigate(['/accounts/banks/new']);
	}
}
