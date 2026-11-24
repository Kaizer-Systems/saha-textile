import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, type Params } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { money } from '@core/orders/order-format';
import { escapeHtml } from '@core/purchasing/purchasing-format';
import { TRANSFER_KEYS, TransfersGateway } from '@core/transfers/transfers.gateway';
import { accountsHint, accountsRange } from '@features/accounts/accounts-period';
import { CASH_PRESETS } from '@features/cash/cash-sheets-list';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { PeriodPicker, type PeriodChoice } from '@shared/ui/period-picker/period-picker';
import { Table } from '@shared/ui/table/table';

import { TRANSFER_CHIPS, TRANSFER_PILL } from './transfer-format';

import type { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import type { TransferListQuery, TransferRow } from '@saha-textile/contracts';

type Chip = (typeof TRANSFER_CHIPS)[number];
type TransferTableRow = TransferRow & { row: TransferRow; [key: string]: unknown };

/**
 * Stock › Transfers (accounts brief N3): every transfer to or from the locations in reach, with its status, value at
 * cost and delivery challan; chips for those waiting, packing, on the way and received short.
 */
@Component({
	selector: 'app-transfers-list',
	imports: [PageWrapper, TranslocoModule, Table, PeriodPicker],
	templateUrl: './transfers-list.html',
})
export class TransfersListPage {
	private readonly gateway = inject(TransfersGateway);
	private readonly router = inject(Router);
	private readonly transloco = inject(TranslocoService);

	readonly chips = TRANSFER_CHIPS;
	readonly presets = CASH_PRESETS;
	readonly hint = accountsHint;
	readonly chip = signal<Chip>('all');
	readonly range = signal(accountsRange({ period: 'this_month' }));
	private readonly params = signal<Params>({});
	private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

	readonly query = computed((): Partial<TransferListQuery> => {
		const search = typeof this.params()['search'] === 'string' ? String(this.params()['search']).trim() : '';
		return {
			...this.range(),
			chip: this.chip(),
			...(search ? { search } : {}),
			page: Number(this.params()['page']) || 1,
			pageSize: Math.min(Number(this.params()['paginate']) || 30, 100),
		};
	});
	readonly list = injectQuery(() => ({
		queryKey: TRANSFER_KEYS.list(this.query()),
		queryFn: () => firstValueFrom(this.gateway.list(this.query())),
	}));
	readonly counts = computed(() => this.list.data()?.counts);

	readonly tableConfig = computed((): ITableConfig<TransferTableRow> => {
		this.lang();
		const t = (key: string) => this.transloco.translate(key);
		const page = this.list.data();
		return {
			columns: [
				{ title: 'tr_number', dataField: 'number' },
				{ title: 'tr_from_to', dataField: 'routeText' },
				{ title: 'tr_pieces', dataField: 'pieces', align: 'end' },
				{ title: 'tr_value_at_cost', dataField: 'valueText', align: 'end' },
				{ title: 'tr_document', dataField: 'documentText' },
				{ title: 'status', dataField: 'statusHtml' },
			],
			rowActions: [
				{ label: 'al_view', actionToPerform: 'view', icon: 'ri-eye-line', permission: 'transfer.index' },
			],
			data: (page?.items ?? []).map((row) => ({
				...row,
				row,
				routeText: escapeHtml(`${row.fromName} → ${row.toName}`),
				valueText: row.valueINR ? money(row.valueINR, 'INR') : '—',
				documentText: row.challanNumber ?? row.branchInvoice?.number ?? '—',
				statusHtml: `<div class="${TRANSFER_PILL[row.status]}"><span>${t(`tr_status_${row.status}`)}</span></div>`,
			})),
			total: page?.total ?? 0,
		};
	});

	setChip(chip: Chip): void {
		this.chip.set(chip);
		this.params.update((params) => ({ ...params, page: 1 }));
	}

	setPeriod(choice: PeriodChoice): void {
		this.range.set(accountsRange(choice));
		this.params.update((params) => ({ ...params, page: 1 }));
	}

	onTableChange(params?: Params): void {
		this.params.set({ ...params });
	}

	open(row: TransferTableRow): void {
		void this.router.navigate(['/transfers', row.id]);
	}

	onAction(action: ITableClickedAction): void {
		const row = action.data as TransferTableRow | undefined;
		if (action.actionToPerform === 'view' && row) this.open(row);
	}
}
