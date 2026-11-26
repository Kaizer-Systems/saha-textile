import { Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import { escapeHtml, pill, rupees } from '@core/purchasing/purchasing-format';
import { injectReturnsQuery, tablePage } from '@core/purchasing/purchasing.gateway';
import { Params } from '@data-access/interfaces/core.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Table } from '@shared/ui/table/table';

import { returnStatus, returnWhy, unitsText } from '../shared/purchasing-labels';

import type { PurchaseReturn, PurchaseReturnListQuery } from '@saha-textile/contracts';

export type ReturnFilter = PurchaseReturnListQuery['filter'];

export interface ReturnTableRow {
	id: string;
	number: string;
	supplier: string;
	entry: string;
	why: string;
	pieces: string;
	value: string;
	status: string;
}

/** A return as r01 draws it: the two drafts the goods check made sit beside returns made by hand. */
export function toReturnRow(
	ret: PurchaseReturn,
	t: (key: string, params?: Record<string, unknown>) => string,
): ReturnTableRow {
	const state = returnStatus(ret, t);
	return {
		id: ret.id,
		number: ret.number
			? `<h6 class="mb-0">${escapeHtml(ret.number)}</h6>`
			: `<span class="text-muted">${escapeHtml(t(ret.kind === 'short_supply' ? 'pr_no_goods_to_send' : 'pr_number_on_sending'))}</span>`,
		supplier: escapeHtml(ret.supplierName),
		entry: escapeHtml(ret.purchaseEntryNumber ?? '—'),
		why: escapeHtml(returnWhy(ret, t)),
		pieces: escapeHtml(unitsText(ret.lines, t)),
		value: rupees(ret.totalINR),
		status: pill(state.pill, state.label),
	};
}

/** Purchases › Purchase returns (r01). */
@Component({
	selector: 'app-return-list',
	templateUrl: './return-list.html',
	imports: [HasPermissionDirective, PageWrapper, RouterModule, Table, TranslocoModule],
})
export class ReturnList {
	private readonly router = inject(Router);
	private readonly transloco = inject(TranslocoService);

	private readonly table = viewChild(Table);
	readonly filter = signal<ReturnFilter>('all');
	private readonly params = signal<Params>({});
	readonly query = injectReturnsQuery(() => ({ filter: this.filter(), ...tablePage(this.params()) }));
	readonly counts = computed(() => this.query.data()?.counts ?? {});
	readonly filters: ReadonlyArray<{ key: ReturnFilter; label: string }> = [
		{ key: 'all', label: 'filter_all' },
		{ key: 'draft', label: 'filter_drafts' },
		{ key: 'sent', label: 'filter_sent' },
		{ key: 'waiting', label: 'filter_waiting_credit_note' },
		{ key: 'settled', label: 'filter_settled' },
	];

	readonly tableConfig = signal<ITableConfig<ReturnTableRow>>({
		columns: [
			{ title: 'debit_note', dataField: 'number', width: 190 },
			{ title: 'supplier', dataField: 'supplier', width: 200 },
			{ title: 'from_entry', dataField: 'entry', width: 160 },
			{ title: 'pr_why', dataField: 'why' },
			{ title: 'pieces', dataField: 'pieces', align: 'end' },
			{ title: 'value', dataField: 'value', align: 'end' },
			{ title: 'status', dataField: 'status', width: 230 },
		],
		rowActions: [
			{ label: 'view_return', actionToPerform: 'view', icon: 'ri-eye-line', permission: 'purchase_return.index' },
		],
		data: [],
		total: 0,
	});

	constructor() {
		effect(() => {
			const page = this.query.data();
			const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
			this.tableConfig.update((config) => ({
				...config,
				data: page ? page.items.map((ret) => toReturnRow(ret, t)) : [],
				total: page ? page.total : 0,
			}));
		});
	}

	setFilter(filter: ReturnFilter): void {
		const table = this.table();
		if (table) table.tableData['page'] = 1;
		this.filter.set(filter);
		this.params.update((params) => ({ ...params, page: 1 }));
	}

	onTableChange(data?: Params): void {
		this.params.set({ ...data });
	}

	open(row: ReturnTableRow): void {
		void this.router.navigate(['/purchase-returns', row.id]);
	}

	onAction(action: ITableClickedAction): void {
		const row = action.data as ReturnTableRow | undefined;
		if (row && action.actionToPerform === 'view') this.open(row);
	}
}
