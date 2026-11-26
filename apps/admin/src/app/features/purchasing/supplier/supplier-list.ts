import { Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { apiProblem, escapeHtml, rupees, shortDate } from '@core/purchasing/purchasing-format';
import {
	PURCHASING_KEYS,
	PurchasingGateway,
	injectSuppliersQuery,
	tablePage,
} from '@core/purchasing/purchasing.gateway';
import { Params } from '@data-access/interfaces/core.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { translateCount } from '@shared/pipes/language.pipes';
import { Table } from '@shared/ui/table/table';

import type { SupplierListQuery, SupplierListRow } from '@saha-textile/contracts';

export type SupplierFilter = SupplierListQuery['filter'];

export interface SupplierTableRow {
	id: string;
	supplier: string;
	gstin: string;
	state: string;
	kind: string;
	terms: string;
	owed: string;
	last: string;
}

/** Payment terms in words: "30 days", or "On delivery" for 0. `count` picks the plural form. */
export function termsText(
	days: number,
	count: (key: string, n: number) => string,
	plain: (key: string) => string,
): string {
	return days === 0 ? plain('supplier_terms_on_delivery') : count('supplier_terms_days', days);
}

/** A supplier as the S01 table draws it. Every value is escaped: names come from people. */
export function toSupplierRow(
	row: SupplierListRow,
	translate: (key: string, count?: number) => string,
): SupplierTableRow {
	const name = row.shortName || row.legalName;
	const place = [row.address.city, translate('supplier_purchase_count', row.purchaseCount)].filter(Boolean);
	const inactive = row.active
		? ''
		: ` <span class="badge bg-secondary">${escapeHtml(translate('supplier_inactive'))}</span>`;
	return {
		id: row.id,
		supplier: `<h6 class="mb-0">${escapeHtml(name)}${inactive}</h6><small class="text-muted">${escapeHtml(place.join(' · '))}</small>`,
		gstin: row.gstin ? escapeHtml(row.gstin) : '<span class="text-muted">—</span>',
		state: escapeHtml(row.stateName),
		// A badge only when the supplier is not Regular: their bills carry no claimable GST (s01).
		kind:
			row.kind === 'regular'
				? escapeHtml(translate('supplier_kind_regular'))
				: `<span class="badge bg-warning">${escapeHtml(translate(`supplier_kind_${row.kind}`))}</span>`,
		terms: escapeHtml(
			termsText(
				row.paymentTermsDays,
				(key, count) => translate(key, count),
				(key) => translate(key),
			),
		),
		owed: row.owedINR > 0 ? rupees(row.owedINR) : '<span class="text-muted">—</span>',
		last: row.lastPurchaseOn ? shortDate(row.lastPurchaseOn) : '<span class="text-muted">—</span>',
	};
}

/** Purchases › Suppliers (s01): filters, search by name, GSTIN or city, soft delete. */
@Component({
	selector: 'app-supplier-list',
	templateUrl: './supplier-list.html',
	imports: [PageWrapper, HasPermissionDirective, RouterModule, Table, TranslocoModule],
})
export class SupplierList {
	private readonly router = inject(Router);
	private readonly gateway = inject(PurchasingGateway);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly queryClient = inject(QueryClient);

	private readonly table = viewChild(Table);
	readonly filter = signal<SupplierFilter>('all');
	private readonly params = signal<Params>({});
	readonly query = injectSuppliersQuery(() => ({ filter: this.filter(), ...tablePage(this.params()) }));
	readonly counts = computed(() => this.query.data()?.counts ?? { all: 0, owed: 0, inactive: 0 });
	readonly filters: ReadonlyArray<{ key: SupplierFilter; label: string }> = [
		{ key: 'all', label: 'supplier_filter_all' },
		{ key: 'owed', label: 'supplier_filter_owed' },
		{ key: 'inactive', label: 'supplier_filter_inactive' },
	];

	readonly tableConfig = signal<ITableConfig<SupplierTableRow>>({
		columns: [
			{ title: 'supplier', dataField: 'supplier', width: 240 },
			{ title: 'gstin', dataField: 'gstin', width: 170 },
			{ title: 'state', dataField: 'state' },
			{ title: 'type', dataField: 'kind' },
			{ title: 'supplier_terms', dataField: 'terms' },
			{ title: 'supplier_we_owe', dataField: 'owed', align: 'end' },
			{ title: 'supplier_last_purchase', dataField: 'last' },
		],
		rowActions: [
			{ label: 'view_supplier', actionToPerform: 'view', icon: 'ri-eye-line', permission: 'supplier.index' },
			{ label: 'edit_supplier', actionToPerform: 'edit', icon: 'ri-pencil-line', permission: 'supplier.edit' },
			{
				label: 'delete_supplier',
				actionToPerform: 'delete',
				icon: 'ri-delete-bin-line',
				permission: 'supplier.destroy',
			},
		],
		data: [],
		total: 0,
	});

	constructor() {
		effect(() => {
			const page = this.query.data();
			const translate = (key: string, count?: number) =>
				count === undefined ? this.transloco.translate(key) : translateCount(this.transloco, key, count);
			this.tableConfig.update((config) => ({
				...config,
				data: page ? page.items.map((row) => toSupplierRow(row, translate)) : [],
				total: page ? page.total : 0,
			}));
		});
	}

	/** A new filter starts again at page 1, in the table's pager too. */
	setFilter(filter: SupplierFilter): void {
		const table = this.table();
		if (table) table.tableData['page'] = 1;
		this.filter.set(filter);
		this.params.update((params) => ({ ...params, page: 1 }));
	}

	onTableChange(data?: Params): void {
		this.params.set({ ...data });
	}

	onAction(action: ITableClickedAction): void {
		const row = action.data as SupplierTableRow | undefined;
		if (!row) return;
		if (action.actionToPerform === 'view') this.view(row);
		else if (action.actionToPerform === 'edit') void this.router.navigate(['/suppliers', row.id, 'edit']);
		else if (action.actionToPerform === 'delete') this.remove(row);
	}

	view(row: SupplierTableRow): void {
		void this.router.navigate(['/suppliers', row.id]);
	}

	/** A soft delete, refused while the supplier has entries or orders (they stay for the books). */
	private remove(row: SupplierTableRow): void {
		this.gateway.deleteSupplier(row.id).subscribe({
			next: () => {
				this.notifier.showSuccess(this.transloco.translate('supplier_deleted'));
				void this.queryClient.invalidateQueries({ queryKey: PURCHASING_KEYS.suppliers });
			},
			error: (error: unknown) =>
				this.notifier.showError(apiProblem(error, this.transloco.translate('purchasing_action_failed'))),
		});
	}
}
