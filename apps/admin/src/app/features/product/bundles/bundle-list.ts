import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { productStatusView } from '@core/catalog/product-status';
import { Params } from '@data-access/interfaces/core.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { BundleService } from '@data-access/services/bundle.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Table } from '@shared/ui/table/table';

import type { AdminProductRow } from '@saha-textile/contracts';

interface BundleRow {
	id: string;
	thumb: { original_url: string } | null;
	name: string;
	levels: string;
	price: string;
	stock: string;
	status: string;
	shop: string;
}

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const pill = (css: string, words: string) => `<div class="${css}"><span>${escapeHtml(words)}</span></div>`;
const rupees = (value: number) => `₹${Math.round(value).toLocaleString('en-IN')}`;

/**
 * Products › Bundles (bundle builder brief B1–B3, approved 2026-11-22): every bundle with its levels, its set price
 * today ("From" when it has choices), its worked-out stock and why, Status and Show on shop. Edit opens the builder;
 * Add bundle starts one from its name.
 */
@Component({
	selector: 'app-bundle-list',
	templateUrl: './bundle-list.html',
	imports: [PageWrapper, HasPermissionDirective, RouterModule, Table, TranslocoModule],
})
export class BundleList {
	private router = inject(Router);
	private bundles = inject(BundleService);
	private transloco = inject(TranslocoService);
	private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
	private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });
	private readonly params = signal<Params>({});

	readonly listQuery = injectQuery(() => ({
		queryKey: ['bundles', this.params()],
		queryFn: () =>
			firstValueFrom(
				this.bundles.list({
					search: typeof this.params()['search'] === 'string' ? this.params()['search'] : undefined,
					page: Number(this.params()['page']) || 1,
					pageSize: Number(this.params()['paginate']) || 30,
				}),
			),
		enabled: this.isBrowser,
	}));

	readonly tableConfig = signal<ITableConfig<BundleRow>>({
		columns: [
			{
				title: 'image',
				dataField: 'thumb',
				class: 'tbl-image',
				type: 'image',
				placeholder: 'assets/images/product.png',
			},
			{ title: 'name', dataField: 'name' },
			{ title: 'bundle_levels', dataField: 'levels' },
			{ title: 'set_price', dataField: 'price' },
			{ title: 'stock', dataField: 'stock' },
			{ title: 'status', dataField: 'status' },
			{ title: 'show_on_shop', dataField: 'shop' },
		],
		rowActions: [{ label: 'edit', actionToPerform: 'edit', icon: 'ri-pencil-line', permission: 'product.index' }],
		data: [],
		total: 0,
	});

	constructor() {
		effect(() => {
			const list = this.listQuery.data();
			this.lang();
			const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
			const data = (list?.items ?? []).map((row) => this.row(row, t));
			this.tableConfig.update((config) => ({ ...config, data, total: list?.total ?? 0 }));
		});
	}

	/** The stock column (B3): worked out, never typed; the note says why. */
	private row(row: AdminProductRow, t: (key: string, params?: Record<string, unknown>) => string): BundleRow {
		const set = row.bundle;
		const stock = set?.stock;
		const status = productStatusView(row.status, row.wasLive);
		const stockCell = !stock
			? `<span class="help-text">${escapeHtml(t('bundle_no_levels_yet'))}</span>`
			: stock.state === 'out_of_stock'
				? `${pill('status-out_of_stock', t('out_of_stock'))}${
						stock.soldOutPieces.length
							? `<small class="text-danger d-block">${escapeHtml(t('bundle_pieces_sold_out', { count: stock.soldOutPieces.length, total: stock.totalPieces }))}</small>`
							: `<small class="text-danger d-block">${escapeHtml(t('bundle_no_combination'))}</small>`
					}`
				: `${pill(stock.state === 'low_stock' ? 'status-pending' : 'status-in_stock', t(stock.state === 'low_stock' ? 'low_stock' : 'in_stock'))}<small class="help-text d-block">${escapeHtml(
						t('bundle_sets_possible', { count: stock.setsPossible }),
					)}</small>${
						stock.soldOutChoices.length
							? `<small class="text-warning d-block">${escapeHtml(t('bundle_choices_sold_out', { count: stock.soldOutChoices.length, total: stock.totalChoices }))}</small>`
							: ''
					}`;
		return {
			id: row.id,
			thumb: row.thumbnailUrl ? { original_url: row.thumbnailUrl } : null,
			name: `${escapeHtml(row.title)}<small class="help-text d-block">${escapeHtml(row.sku)}</small>`,
			levels: set ? `${set.levels}${set.choices ? ` · ${escapeHtml(t('choose_your_set'))}` : ''}` : '0',
			price:
				set?.setPriceINR === null || set?.setPriceINR === undefined
					? '—'
					: set.fromPrice
						? escapeHtml(t('from_price', { price: rupees(set.setPriceINR) }))
						: rupees(set.setPriceINR),
			stock: stockCell,
			status: pill(status.pill, t(status.label)),
			shop: row.showOnShop ? pill('status-in_stock', t('shown')) : pill('status-pending', t('hidden_from_shop')),
		};
	}

	onTableChange(data?: Params) {
		this.params.set({ ...data });
	}

	onActionClicked(action: ITableClickedAction) {
		if (action.actionToPerform === 'edit') this.open(action.data as BundleRow);
	}

	open(row: BundleRow) {
		void this.router.navigate(['/product/bundle', row.id]);
	}
}
