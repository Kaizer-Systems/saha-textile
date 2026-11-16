import { Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { daysBetween, istDay } from '@saha-textile/core-domain/purchasing';
import { firstValueFrom } from 'rxjs';

import { PILLS, apiProblem, escapeHtml, pill, rupees, saveBlob, shortDate } from '@core/purchasing/purchasing-format';
import { PurchasingGateway, injectOrdersQuery, tablePage } from '@core/purchasing/purchasing.gateway';
import { AuthStore } from '@core/state/auth.store';
import { Params } from '@data-access/interfaces/core.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { translateCount } from '@shared/pipes/language.pipes';
import { Table } from '@shared/ui/table/table';

import { unitsText } from '../shared/purchasing-labels';

import type { PurchaseOrder, PurchaseOrderListQuery } from '@saha-textile/contracts';

export type OrderFilter = PurchaseOrderListQuery['filter'];

export interface OrderTableRow {
	id: string;
	status: string;
	number: string;
	supplier: string;
	orderedOn: string;
	expectedBy: string;
	ordered: string;
	received: string;
	value: string;
	state: string;
}

/** A purchase order as the po01 table draws it; a late one gets a red "N days late" badge. */
export function toOrderRow(
	order: PurchaseOrder,
	today: string,
	t: (key: string, params?: Record<string, unknown>) => string,
	count: (key: string, n: number) => string,
): OrderTableRow {
	const lines = order.lines;
	const late = order.late
		? ` <span class="badge bg-danger">${escapeHtml(count('days_late', daysBetween(order.expectedBy, today)))}</span>`
		: '';
	return {
		id: order.id,
		status: order.status,
		number: `<h6 class="mb-0">${escapeHtml(order.number)}</h6>`,
		supplier: escapeHtml(order.supplierName),
		orderedOn: shortDate(order.sentAt ?? order.createdAt),
		expectedBy: `${shortDate(order.expectedBy)}${late}`,
		ordered: escapeHtml(unitsText(lines, t)),
		received: escapeHtml(
			unitsText(
				lines.map((line) => ({ quantity: line.receivedQuantity, soldBy: line.soldBy })),
				t,
			),
		),
		value: rupees(order.orderedValueINR),
		state: pill(PILLS.order[order.status], t(`po_status_${order.status}`)),
	};
}

/** Purchases › Purchase orders (po01): filters, late badges, copy as new draft, the order PDF. */
@Component({
	selector: 'app-order-list',
	templateUrl: './order-list.html',
	imports: [PageWrapper, HasPermissionDirective, RouterModule, Table, TranslocoModule],
})
export class OrderList {
	private readonly router = inject(Router);
	private readonly gateway = inject(PurchasingGateway);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);

	private readonly table = viewChild(Table);
	readonly filter = signal<OrderFilter>('all');
	private readonly params = signal<Params>({});
	readonly query = injectOrdersQuery(() => ({ filter: this.filter(), ...tablePage(this.params()) }));
	readonly counts = computed(() => this.query.data()?.counts ?? {});
	readonly filters: ReadonlyArray<{ key: OrderFilter; label: string }> = [
		{ key: 'all', label: 'filter_all' },
		{ key: 'draft', label: 'filter_drafts' },
		{ key: 'sent', label: 'filter_sent' },
		{ key: 'part_received', label: 'filter_part_received' },
		{ key: 'late', label: 'filter_late' },
		{ key: 'closed', label: 'filter_closed' },
	];

	readonly tableConfig = signal<ITableConfig<OrderTableRow>>({
		columns: [
			{ title: 'order_no', dataField: 'number', width: 170 },
			{ title: 'supplier', dataField: 'supplier', width: 220 },
			{ title: 'ordered_on', dataField: 'orderedOn' },
			{ title: 'expected_by', dataField: 'expectedBy', width: 190 },
			{ title: 'ordered', dataField: 'ordered', align: 'end' },
			{ title: 'received', dataField: 'received', align: 'end' },
			{ title: 'value_estimate', dataField: 'value', align: 'end' },
			{ title: 'status', dataField: 'state', width: 150 },
		],
		rowActions: [
			{
				label: 'view_purchase_order',
				actionToPerform: 'view',
				icon: 'ri-eye-line',
				permission: 'purchase_order.index',
			},
			{
				label: 'copy_as_new_draft',
				actionToPerform: 'copy',
				icon: 'ri-file-copy-line',
				permission: 'purchase_order.create',
			},
			{
				label: 'download_pdf',
				actionToPerform: 'pdf',
				icon: 'ri-file-pdf-2-line',
				permission: 'purchase_order.index',
			},
		],
		data: [],
		total: 0,
	});

	constructor() {
		effect(() => {
			const page = this.query.data();
			const today = istDay(new Date());
			const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
			const count = (key: string, n: number) => translateCount(this.transloco, key, n);
			this.tableConfig.update((config) => ({
				...config,
				data: page ? page.items.map((order) => toOrderRow(order, today, t, count)) : [],
				total: page ? page.total : 0,
			}));
		});
	}

	setFilter(filter: OrderFilter): void {
		const table = this.table();
		if (table) table.tableData['page'] = 1;
		this.filter.set(filter);
		this.params.update((params) => ({ ...params, page: 1 }));
	}

	onTableChange(data?: Params): void {
		this.params.set({ ...data });
	}

	/** Drafts open in the form for whoever may edit them; everything else opens the order page. */
	open(row: OrderTableRow): void {
		const editable = row.status === 'draft' && this.auth.permissions().includes('purchase_order.create');
		void this.router.navigate(editable ? ['/purchase-orders', row.id, 'edit'] : ['/purchase-orders', row.id]);
	}

	onAction(action: ITableClickedAction): void {
		const row = action.data as OrderTableRow | undefined;
		if (!row) return;
		if (action.actionToPerform === 'view') void this.router.navigate(['/purchase-orders', row.id]);
		else if (action.actionToPerform === 'copy') void this.copy(row);
		else if (action.actionToPerform === 'pdf') void this.pdf(row);
	}

	async copy(row: OrderTableRow): Promise<void> {
		try {
			const draft = await firstValueFrom(this.gateway.copyOrder(row.id));
			this.notifier.showSuccess(this.transloco.translate('po_copied', { number: draft.number }));
			void this.router.navigate(['/purchase-orders', draft.id, 'edit']);
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		}
	}

	async pdf(row: OrderTableRow): Promise<void> {
		try {
			const blob = await firstValueFrom(this.gateway.orderPdf(row.id));
			const number = row.number.replace(/<[^>]+>/g, '');
			saveBlob(`${number.replace(/\//g, '-')}.pdf`, blob);
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		}
	}
}
