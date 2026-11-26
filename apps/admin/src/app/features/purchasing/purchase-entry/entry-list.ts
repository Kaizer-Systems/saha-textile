import { Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import {
	PILLS,
	RupeesPipe,
	ShortDatePipe,
	apiProblem,
	escapeHtml,
	pill,
	rupees,
	saveBlob,
	shortDate,
} from '@core/purchasing/purchasing-format';
import { PurchasingGateway, injectEntriesQuery, tablePage } from '@core/purchasing/purchasing.gateway';
import { AuthStore } from '@core/state/auth.store';
import { Params } from '@data-access/interfaces/core.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { PluralPipe } from '@shared/pipes/language.pipes';
import { Table } from '@shared/ui/table/table';

import type { PurchaseEntryListQuery, PurchaseEntryListRow } from '@saha-textile/contracts';

export type EntryFilter = PurchaseEntryListQuery['filter'];

export interface EntryTableRow {
	id: string;
	status: string;
	number: string;
	supplier: string;
	billNumber: string;
	billDate: string;
	pieces: string;
	total: string;
	stock: string;
	payment: string;
}

/** A purchase entry as p01 draws it: two status columns, because stock and money move separately. */
export function toEntryRow(row: PurchaseEntryListRow, t: (key: string) => string): EntryTableRow {
	return {
		id: row.id,
		status: row.status,
		number: row.number
			? `<h6 class="mb-0">${escapeHtml(row.number)}</h6>`
			: `<span class="text-muted">${escapeHtml(t('gets_number_on_posting'))}</span>`,
		supplier: escapeHtml(row.supplierName),
		billNumber: escapeHtml(row.billNumber),
		billDate: shortDate(row.billDate),
		pieces: String(row.pieces),
		total: rupees(row.totalINR),
		stock: pill(PILLS.entry[row.status], t(`pe_status_${row.status}`)),
		payment:
			row.status === 'posted'
				? pill(PILLS.payment[row.paymentStatus], t(`pay_status_${row.paymentStatus}`))
				: '<span class="text-muted">—</span>',
	};
}

/** Purchases › Purchase entries (p01): tiles, filters, copy as new draft, the goods receipt. */
@Component({
	selector: 'app-entry-list',
	templateUrl: './entry-list.html',
	imports: [
		HasPermissionDirective,
		PageWrapper,
		PluralPipe,
		RouterModule,
		RupeesPipe,
		ShortDatePipe,
		Table,
		TranslocoModule,
	],
})
export class EntryList {
	private readonly router = inject(Router);
	private readonly gateway = inject(PurchasingGateway);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);

	private readonly table = viewChild(Table);
	readonly filter = signal<EntryFilter>('all');
	private readonly params = signal<Params>({});
	readonly query = injectEntriesQuery(() => ({ filter: this.filter(), ...tablePage(this.params()) }));
	readonly tiles = computed(() => this.query.data()?.tiles ?? null);
	readonly counts = computed(() => this.query.data()?.counts ?? {});
	readonly filters: ReadonlyArray<{ key: EntryFilter; label: string }> = [
		{ key: 'all', label: 'filter_all' },
		{ key: 'draft', label: 'filter_drafts' },
		{ key: 'checked', label: 'filter_waiting_to_post' },
		{ key: 'unpaid', label: 'filter_unpaid' },
		{ key: 'void', label: 'filter_void' },
	];

	readonly tableConfig = signal<ITableConfig<EntryTableRow>>({
		columns: [
			{ title: 'entry_no', dataField: 'number', width: 170 },
			{ title: 'supplier', dataField: 'supplier', width: 220 },
			{ title: 'their_bill_no', dataField: 'billNumber' },
			{ title: 'bill_date', dataField: 'billDate' },
			{ title: 'pieces', dataField: 'pieces', align: 'end' },
			{ title: 'bill_total', dataField: 'total', align: 'end' },
			{ title: 'stock', dataField: 'stock', width: 140 },
			{ title: 'payment', dataField: 'payment', width: 120 },
		],
		rowActions: [
			{
				label: 'view_purchase_entry',
				actionToPerform: 'view',
				icon: 'ri-eye-line',
				permission: 'purchase.index',
			},
			{
				label: 'copy_as_new_draft',
				actionToPerform: 'copy',
				icon: 'ri-file-copy-line',
				permission: 'purchase.create',
			},
			{
				label: 'print_goods_receipt',
				actionToPerform: 'receipt',
				icon: 'ri-printer-line',
				permission: 'purchase.index',
			},
		],
		data: [],
		total: 0,
	});

	constructor() {
		effect(() => {
			const page = this.query.data();
			const t = (key: string) => this.transloco.translate(key);
			this.tableConfig.update((config) => ({
				...config,
				data: page ? page.items.map((row) => toEntryRow(row, t)) : [],
				total: page ? page.total : 0,
			}));
		});
	}

	setFilter(filter: EntryFilter): void {
		const table = this.table();
		if (table) table.tableData['page'] = 1;
		this.filter.set(filter);
		this.params.update((params) => ({ ...params, page: 1 }));
	}

	onTableChange(data?: Params): void {
		this.params.set({ ...data });
	}

	/** Drafts open in the form for whoever may edit them; posted and void entries open their page. */
	open(row: EntryTableRow): void {
		const editable =
			(row.status === 'draft' || row.status === 'checked') && this.auth.permissions().includes('purchase.create');
		void this.router.navigate(editable ? ['/purchase-entries', row.id, 'edit'] : ['/purchase-entries', row.id]);
	}

	onAction(action: ITableClickedAction): void {
		const row = action.data as EntryTableRow | undefined;
		if (!row) return;
		if (action.actionToPerform === 'view') void this.router.navigate(['/purchase-entries', row.id]);
		else if (action.actionToPerform === 'copy')
			void this.router.navigate(['/purchase-entries', 'create'], { queryParams: { copy: row.id } });
		else if (action.actionToPerform === 'receipt') void this.receipt(row);
	}

	async receipt(row: EntryTableRow): Promise<void> {
		try {
			const blob = await firstValueFrom(this.gateway.entryReceiptPdf(row.id));
			saveBlob(`goods-receipt-${row.id}.pdf`, blob);
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		}
	}
}
