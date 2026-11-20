import { Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import { attentionTileLine, toOrderTableRow, type OrderTableRow } from '@core/orders/order-format';
import { injectAdminOrdersQuery, orderTablePage } from '@core/orders/orders.gateway';
import { Params } from '@data-access/interfaces/core.interface';
import { ITableClickedAction, ITableColumn, ITableConfig } from '@data-access/interfaces/table.interface';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Table } from '@shared/ui/table/table';

import type { OrderChannel, OrderListFilter, OrderPaymentStatus } from '@saha-textile/contracts';

const LIST_COLUMNS: ITableColumn[] = [
	{ title: 'ord_col_order', dataField: 'number', width: 170 },
	{ title: 'ord_col_date', dataField: 'date', width: 130 },
	{ title: 'ord_col_buyer', dataField: 'buyer' },
	{ title: 'ord_col_delivers_to', dataField: 'deliversTo', width: 140 },
	{ title: 'ord_col_total', dataField: 'total', align: 'end', width: 130 },
	{ title: 'ord_col_payment', dataField: 'payment', width: 200 },
	{ title: 'ord_col_status', dataField: 'status', width: 200 },
];

/** Needs attention (ol03): the reason each order waits on staff replaces where it goes and the money. */
const ATTENTION_COLUMNS: ITableColumn[] = [
	{ title: 'ord_col_order', dataField: 'number', width: 170 },
	{ title: 'ord_col_date', dataField: 'date', width: 120 },
	{ title: 'ord_col_buyer', dataField: 'buyer' },
	{ title: 'ord_col_why', dataField: 'why', width: 330 },
	{ title: 'ord_col_status', dataField: 'status', width: 190 },
];

/** Open orders show how long pieces have been held and where the money stands (oo01). */
const OPEN_COLUMNS: ITableColumn[] = [
	{ title: 'ord_col_order', dataField: 'number', width: 170 },
	{ title: 'ord_col_open_since', dataField: 'openSince', width: 150 },
	{ title: 'ord_col_buyer', dataField: 'buyer' },
	{ title: 'ord_col_pieces', dataField: 'pieces', align: 'end', width: 80 },
	{ title: 'ord_col_goods_so_far', dataField: 'goods', align: 'end', width: 140 },
	{ title: 'ord_col_paid', dataField: 'paid', align: 'end', width: 120 },
	{ title: 'ord_col_balance', dataField: 'balance', width: 180 },
];

/**
 * Admin › Orders (brief ol02–ol04, oo01; owner 2026-11-20: a date range beside the filters): the
 * four tiles, filters with their counts, payment / buyer / channel choices, the server search and the
 * date range, and a red row for an order waiting for its invoice address.
 */
@Component({
	selector: 'app-order',
	templateUrl: './order.html',
	styleUrls: ['./order.scss'],
	imports: [FormsModule, HasPermissionDirective, PageWrapper, RouterModule, Table, TranslocoModule],
})
export class Order {
	private readonly router = inject(Router);
	private readonly transloco = inject(TranslocoService);

	private readonly table = viewChild(Table);
	readonly filter = signal<OrderListFilter>('all');
	readonly payment = signal<OrderPaymentStatus | ''>('');
	readonly buyerKind = signal<'person' | 'business' | ''>('');
	readonly channel = signal<OrderChannel | ''>('');
	private readonly params = signal<Params>({});

	readonly query = injectAdminOrdersQuery(() => ({
		filter: this.filter(),
		...(this.payment() ? { payment: this.payment() as OrderPaymentStatus } : {}),
		...(this.buyerKind() ? { buyerKind: this.buyerKind() as 'person' | 'business' } : {}),
		...(this.channel() ? { channel: this.channel() as OrderChannel } : {}),
		...orderTablePage(this.params()),
	}));
	private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });
	readonly tiles = computed(() => this.query.data()?.tiles ?? null);
	/** ol02: what the Needs attention tile is made of; "Waiting on staff" when nothing is. */
	readonly attentionLine = computed(() => {
		this.lang();
		return attentionTileLine(this.tiles()?.attentionBy, (key, params) => this.transloco.translate(key, params));
	});
	/** ol04: "1 order matches “4821390761” (the number as it appears in an SMS, without hyphens)." */
	readonly searchLine = computed(() => {
		this.lang();
		const q = typeof this.params()['search'] === 'string' ? String(this.params()['search']).trim() : '';
		const total = this.query.data()?.total;
		if (!q || total === undefined) return null;
		const count = this.transloco.translate(`ord_search_matches_${total === 1 ? 'one' : 'other'}`, { count: total, q });
		return /^[A-Za-z]{0,3}\d{9,}$/.test(q.replace(/\s/g, '')) ? `${count} ${this.transloco.translate('ord_search_sms_form')}.` : `${count}.`;
	});
	readonly counts = computed<Partial<Record<OrderListFilter, number>>>(() => this.query.data()?.counts ?? {});

	readonly filters: ReadonlyArray<{ key: OrderListFilter; label: string }> = [
		{ key: 'all', label: 'ord_filter_all' },
		{ key: 'needsAttention', label: 'ord_filter_needsAttention' },
		{ key: 'open', label: 'ord_filter_open' },
		{ key: 'awaitingPayment', label: 'ord_filter_awaitingPayment' },
		{ key: 'placed', label: 'ord_filter_placed' },
		{ key: 'processing', label: 'ord_filter_processing' },
		{ key: 'packed', label: 'ord_filter_packed' },
		{ key: 'shipped', label: 'ord_filter_shipped' },
		{ key: 'delivered', label: 'ord_filter_delivered' },
		{ key: 'cancelled', label: 'ord_filter_cancelled' },
	];
	readonly paymentChoices: readonly OrderPaymentStatus[] = [
		'unpaid',
		'request_sent',
		'pending_at_bank',
		'paid',
		'part_paid',
		'paid_ahead',
		'due_on_delivery',
		'on_account',
		'refunded',
		'part_refunded',
	];

	readonly tableConfig = signal<ITableConfig<OrderTableRow>>({
		columns: LIST_COLUMNS,
		rowActions: [
			{ label: 'ord_view_order', actionToPerform: 'view', icon: 'ri-eye-line', permission: 'order.index' },
		],
		data: [],
		total: 0,
	});

	constructor() {
		effect(() => {
			const page = this.query.data();
			const open = this.filter() === 'open';
			const locale = this.transloco.getActiveLang() === 'bn' ? 'bn-IN' : 'en-IN';
			const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
			this.tableConfig.update((config) => ({
				...config,
				columns: open ? OPEN_COLUMNS : this.filter() === 'needsAttention' ? ATTENTION_COLUMNS : LIST_COLUMNS,
				data: page ? page.items.map((row) => toOrderTableRow(row, t, locale)) : [],
				total: page ? page.total : 0,
			}));
		});
	}

	setFilter(filter: OrderListFilter): void {
		this.firstPage();
		this.filter.set(filter);
	}

	setPayment(value: string): void {
		this.firstPage();
		this.payment.set(value as OrderPaymentStatus | '');
	}

	setBuyerKind(value: string): void {
		this.firstPage();
		this.buyerKind.set(value as 'person' | 'business' | '');
	}

	setChannel(value: string): void {
		this.firstPage();
		this.channel.set(value as OrderChannel | '');
	}

	/** A new filter starts at page 1, so the server's page matches what is shown. */
	private firstPage(): void {
		const table = this.table();
		if (table) table.tableData['page'] = 1;
		this.params.update((params) => ({ ...params, page: 1 }));
	}

	onTableChange(data?: Params): void {
		this.params.set({ ...data });
	}

	onAction(action: ITableClickedAction): void {
		if (action.actionToPerform === 'view' && action.data) this.view(action.data as OrderTableRow);
	}

	view(row: OrderTableRow): void {
		void this.router.navigate(['/order/details', row.id]);
	}
}
