import { Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { catchError, firstValueFrom, of } from 'rxjs';

import {
	PILLS,
	RupeesPipe,
	downloadCsv,
	escapeHtml,
	itemCell,
	pill,
	rupees,
	shortDate,
} from '@core/purchasing/purchasing-format';
import { tablePage } from '@core/purchasing/purchasing.gateway';
import { STOCK_KEYS, StockGateway } from '@core/purchasing/stock.gateway';
import { AuthStore } from '@core/state/auth.store';
import { Params } from '@data-access/interfaces/core.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { CategoryService } from '@data-access/services/category.service';
import { categoryPaths } from '@features/purchasing/purchase-entry/draft-product-popup';
import { quantityText } from '@features/purchasing/shared/purchasing-labels';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { PluralPipe } from '@shared/pipes/language.pipes';
import { Table } from '@shared/ui/table/table';

import { AdjustPopup } from './adjust-popup';

import type { AdminCategoryRow, StockListQuery, StockListRow } from '@saha-textile/contracts';

export type StockFilter = StockListQuery['filter'];

export interface StockTableRow {
	id: string;
	productId: string;
	item: string;
	category: string;
	onHand: string;
	held: string;
	inOrders: string;
	free: string;
	status: string;
	value: string;
	lastReceived: string;
	oldest: string;
	row: StockListRow;
}

const muted = (text: string) => `<span class="text-muted">${text}</span>`;

/** One variant as i01 draws it: metres in every column for fabric, cost only for those allowed (P8). */
export function toStockRow(
	row: StockListRow,
	t: (key: string, params?: Record<string, unknown>) => string,
): StockTableRow {
	const qty = (units: number) => quantityText(units, row.soldBy, t);
	return {
		id: row.variantId,
		productId: row.productId,
		item: itemCell({ imageUrl: row.imageUrl, title: row.title, sku: row.sku, optionsLabel: row.optionsLabel }),
		category: row.categoryName ? escapeHtml(row.categoryName) : '—',
		onHand: qty(row.onHand),
		held: row.held ? qty(row.held) : muted('0'),
		inOrders: row.inOrders ? qty(row.inOrders) : muted('0'),
		free: `<strong>${qty(row.freeToSell)}</strong>`,
		status: pill(PILLS.stock[row.status], t(`stock_status_${row.status}`)),
		value: row.valueAtCostINR === null ? '—' : rupees(row.valueAtCostINR),
		lastReceived: row.lastReceivedOn ? shortDate(row.lastReceivedOn) : '—',
		oldest:
			row.oldestPieceDays === null
				? '—'
				: row.oldestPieceDays > 180
					? `<span class="text-danger fw-semibold">${t('days_n', { count: row.oldestPieceDays })}</span>`
					: t('days_n', { count: row.oldestPieceDays }),
		row,
	};
}

/** Stock › All stock (i01): on hand, held, in orders and free to sell for every item. */
@Component({
	selector: 'app-stock-list',
	templateUrl: './stock-list.html',
	imports: [
		FormsModule,
		HasPermissionDirective,
		PageWrapper,
		PluralPipe,
		RouterModule,
		RupeesPipe,
		Table,
		TranslocoModule,
	],
})
export class StockList {
	private readonly router = inject(Router);
	private readonly gateway = inject(StockGateway);
	private readonly modals = inject(NgbModal);
	private readonly transloco = inject(TranslocoService);
	private readonly queryClient = inject(QueryClient);
	private readonly auth = inject(AuthStore);
	private readonly categories = inject(CategoryService);

	private readonly table = viewChild(Table);
	readonly canSeeCost = computed(() => this.auth.permissions().includes('stock.cost'));
	readonly filter = signal<StockFilter>('all');
	readonly categoryId = signal('');
	private readonly params = signal<Params>({});
	readonly query = injectQuery(() => ({
		queryKey: [...STOCK_KEYS.stock, 'list', this.filter(), this.categoryId(), this.params()],
		queryFn: () =>
			firstValueFrom(
				this.gateway.list({
					filter: this.filter(),
					...(this.categoryId() ? { categoryId: this.categoryId() } : {}),
					...tablePage(this.params()),
				}),
			),
	}));
	private readonly categoryRows = toSignal(
		this.categories.getCategoryRows().pipe(catchError(() => of([] as AdminCategoryRow[]))),
		{
			initialValue: [] as AdminCategoryRow[],
		},
	);
	readonly categoryOptions = computed(() => categoryPaths(this.categoryRows(), this.transloco.getActiveLang()));
	readonly tiles = computed(() => this.query.data()?.tiles ?? null);
	readonly counts = computed(() => this.query.data()?.counts ?? { low: 0, out: 0, held: 0, older180: 0 });
	readonly filters: ReadonlyArray<{
		key: StockFilter;
		label: string;
		count: 'low' | 'out' | 'held' | 'older180' | null;
	}> = [
		{ key: 'all', label: 'filter_all', count: null },
		{ key: 'low', label: 'filter_low', count: 'low' },
		{ key: 'out', label: 'filter_out', count: 'out' },
		{ key: 'held', label: 'filter_held', count: 'held' },
		{ key: 'older_180', label: 'filter_older_180', count: 'older180' },
	];

	readonly tableConfig = signal<ITableConfig<StockTableRow>>({ columns: [], rowActions: [], data: [], total: 0 });

	constructor() {
		effect(() => {
			const page = this.query.data();
			const cost = this.canSeeCost();
			const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
			this.tableConfig.set({
				columns: [
					{ title: 'item', dataField: 'item', width: 280 },
					{ title: 'category', dataField: 'category' },
					{ title: 'on_hand', dataField: 'onHand', align: 'end' },
					{ title: 'held', dataField: 'held', align: 'end' },
					{ title: 'in_orders', dataField: 'inOrders', align: 'end' },
					{ title: 'free_to_sell', dataField: 'free', align: 'end' },
					{ title: 'status', dataField: 'status', width: 130 },
					...(cost ? [{ title: 'value_at_cost', dataField: 'value', align: 'end' as const }] : []),
					{ title: 'last_received', dataField: 'lastReceived' },
					{ title: 'oldest_piece', dataField: 'oldest' },
				],
				rowActions: [
					{
						label: 'stock_history',
						actionToPerform: 'history',
						icon: 'ri-history-line',
						permission: 'stock.index',
					},
					{
						label: 'adjust_stock',
						actionToPerform: 'adjust',
						icon: 'ri-equalizer-line',
						permission: ['stock.adjust', 'stock.approve', 'stock.hold'],
					},
					{
						label: 'receive_stock',
						actionToPerform: 'receive',
						icon: 'ri-inbox-archive-line',
						permission: 'purchase.create',
					},
				],
				data: page ? page.items.map((row) => toStockRow(row, t)) : [],
				total: page ? page.total : 0,
			});
		});
	}

	setFilter(filter: StockFilter): void {
		const table = this.table();
		if (table) table.tableData['page'] = 1;
		this.filter.set(filter);
		this.params.update((params) => ({ ...params, page: 1 }));
	}

	setCategory(id: string): void {
		const table = this.table();
		if (table) table.tableData['page'] = 1;
		this.categoryId.set(id);
	}

	onTableChange(data?: Params): void {
		this.params.set({ ...data });
	}

	open(row: StockTableRow): void {
		void this.router.navigate(['/stock', 'items', row.id]);
	}

	onAction(action: ITableClickedAction): void {
		const row = action.data as StockTableRow | undefined;
		if (!row) return;
		if (action.actionToPerform === 'history') this.open(row);
		else if (action.actionToPerform === 'adjust') void this.adjust(row);
		else if (action.actionToPerform === 'receive')
			void this.router.navigate(['/purchase-entries', 'create'], { queryParams: { variant: row.id } });
	}

	async adjust(row: StockTableRow): Promise<void> {
		const popup = this.modals.open(AdjustPopup, {
			size: 'lg',
			windowClass: 'theme-modal modal-lg',
			ariaLabelledBy: 'adjust_popup_title',
		});
		await (popup.componentInstance as AdjustPopup).start(row.row);
		if (await popup.result.catch(() => null))
			void this.queryClient.invalidateQueries({ queryKey: STOCK_KEYS.stock });
	}

	/** The list as filtered, as a spreadsheet (cost columns only for those allowed). */
	async exportList(): Promise<void> {
		const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
		const all = await firstValueFrom(
			this.gateway.list({
				filter: this.filter(),
				...(this.categoryId() ? { categoryId: this.categoryId() } : {}),
				page: 1,
				pageSize: 100,
			}),
		);
		const cost = this.canSeeCost();
		downloadCsv(
			'stock.csv',
			[
				t('sku'),
				t('item'),
				t('category'),
				t('on_hand'),
				t('held'),
				t('in_orders'),
				t('free_to_sell'),
				...(cost ? [t('value_at_cost')] : []),
				t('last_received'),
			],
			all.items.map((row) => [
				row.sku,
				[row.title, row.optionsLabel].filter(Boolean).join(' · '),
				row.categoryName,
				quantityText(row.onHand, row.soldBy, t),
				quantityText(row.held, row.soldBy, t),
				quantityText(row.inOrders, row.soldBy, t),
				quantityText(row.freeToSell, row.soldBy, t),
				...(cost ? [row.valueAtCostINR] : []),
				row.lastReceivedOn,
			]),
		);
	}

	startCount(): void {
		void this.router.navigate(['/stock-counts'], { queryParams: { start: 1 } });
	}
}
