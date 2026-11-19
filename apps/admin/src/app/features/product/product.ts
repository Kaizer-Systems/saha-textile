import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, effect, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

import { goLiveLabels, goLiveToast } from '@core/catalog/go-live-report';
import { rememberProductQueue } from '@core/catalog/product-queue';
import { productStatusView } from '@core/catalog/product-status';
import { injectMissingLanguage } from '@core/i18n/missing-language';
import { CatalogProductStatus } from '@data-access/interfaces/catalog-product.interface';
import { Params } from '@data-access/interfaces/core.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { injectCatalogProductsQuery } from '@data-access/queries/product.queries';
import { NotificationService } from '@data-access/services/notification.service';
import { ProductDraftService } from '@data-access/services/product-draft.service';
import { ProductBulkAction, ProductService } from '@data-access/services/product.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { MissingLanguageNotice } from '@shared/ui/missing-language-notice/missing-language-notice';
import { Table } from '@shared/ui/table/table';

import { ProductBulkPopup } from './bulk/product-bulk-popup';
import { ProductSalePopup, SaleClosed, SalePick } from './bulk/product-sale-popup';

import type { ProductBulkResult, ProductBulkRow } from '@saha-textile/contracts';

interface ProductTableRow {
	id: string;
	slug: string;
	/** The name cell: the name, and a "Draft of changes" chip when you have one. */
	name: string;
	title: string;
	sku: string;
	sale_price: number;
	product_thumbnail: { original_url: string } | null;
	stock: string;
	status: CatalogProductStatus;
	variantCount: number;
	/** The Status switch: on for live only (brief § 5). */
	status_switch: '1' | '0';
	status_label: string;
	status_class: string;
	status_locked: boolean;
}

/** The bulk buttons' action names, and the API action each one runs. */
const BULK: Readonly<Record<string, ProductBulkAction>> = {
	bulk_go_live: 'go-live',
	bulk_take_off: 'take-off',
	bulk_discontinue: 'discontinue',
	bulk_duplicate: 'duplicate',
	bulk_delete: 'delete',
};

const escapeHtml = (text: string | null | undefined): string =>
	(text ?? '').replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

@Component({
	selector: 'app-product',
	templateUrl: './product.html',
	styleUrls: ['./product.scss'],
	imports: [MissingLanguageNotice, PageWrapper, HasPermissionDirective, RouterModule, Table, TranslocoModule],
})
export class Product {
	private router = inject(Router);
	private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
	private products = inject(ProductService);
	private drafts = inject(ProductDraftService);
	private notifier = inject(NotificationService);
	private transloco = inject(TranslocoService);
	private modals = inject(NgbModal);

	private readonly table = viewChild(Table);
	private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

	private readonly params = signal<Params>({});
	/** Opened from Settings › Languages: only live products still missing one language's text. */
	readonly missing = injectMissingLanguage('products');
	readonly productsQuery = injectCatalogProductsQuery(() => ({
		search: typeof this.params()['search'] === 'string' ? this.params()['search'] : undefined,
		page: Number(this.params()['page']) || 1,
		pageSize: Number(this.params()['paginate']) || 15,
		missing: this.missing.code(),
	}));
	/** Products you have a draft of changes for: the "Draft of changes" chip in the list (brief 7f). */
	readonly drafted = signal<ReadonlySet<string>>(new Set());

	readonly tableConfig = signal<ITableConfig<ProductTableRow>>({
		columns: [
			{ title: 'No.', dataField: 'no', type: 'no' },
			{
				title: 'image',
				dataField: 'product_thumbnail',
				class: 'tbl-image',
				type: 'image',
				placeholder: 'assets/images/product.png',
			},
			{ title: 'name', dataField: 'name', sortable: true, sort_direction: 'desc' },
			{ title: 'sku', dataField: 'sku', sortable: true, sort_direction: 'desc' },
			{
				title: 'price',
				dataField: 'sale_price',
				type: 'price',
				sortable: true,
				sort_direction: 'desc',
			},
			{ title: 'stock', dataField: 'stock' },
			// Approve and Store came from the marketplace template; removed on the owner's say-so (Q3 = B).
			{
				title: 'status',
				dataField: 'status_switch',
				type: 'switch',
				labelField: 'status_label',
				labelClassField: 'status_class',
				lockField: 'status_locked',
			},
		],
		rowActions: [
			{
				label: 'edit',
				actionToPerform: 'edit',
				icon: 'ri-pencil-line',
				permission: 'product.edit',
			},
			{
				label: 'go_live',
				actionToPerform: 'go_live',
				icon: 'ri-rocket-line',
				permission: 'product.edit',
			},
			{
				label: 'delete',
				actionToPerform: 'remove',
				icon: 'ri-delete-bin-line',
				permission: 'product.destroy',
			},
		],
		bulkActions: [
			{
				label: 'go_live',
				actionToPerform: 'bulk_go_live',
				icon: 'ri-rocket-line',
				permission: 'product.edit',
				direct: true,
			},
			{
				label: 'take_off_shop',
				actionToPerform: 'bulk_take_off',
				icon: 'ri-eye-off-line',
				permission: 'product.edit',
				direct: true,
			},
			{
				label: 'put_on_sale',
				actionToPerform: 'bulk_sale',
				icon: 'ri-percent-line',
				permission: 'event.edit',
				direct: true,
			},
			{
				label: 'discontinue',
				actionToPerform: 'bulk_discontinue',
				icon: 'ri-forbid-line',
				permission: 'product.edit',
				direct: true,
			},
			{
				label: 'duplicate',
				actionToPerform: 'bulk_duplicate',
				icon: 'ri-file-copy-line',
				permission: 'product.create',
				direct: true,
				more: true,
			},
			{
				label: 'delete',
				actionToPerform: 'bulk_delete',
				icon: 'ri-delete-bin-line',
				permission: 'product.destroy',
				direct: true,
				more: true,
				danger: true,
			},
		],
		pickView: (row) => ({
			title: row.title,
			image: row.product_thumbnail?.original_url ?? null,
			detail: [
				row.sku,
				row.variantCount > 1 ? this.transloco.translate('sale_colours', { count: row.variantCount }) : '',
				`₹${row.sale_price.toLocaleString('en-IN')}`,
			]
				.filter(Boolean)
				.join(' · '),
			status: row.status_label,
			statusClass: row.status_class,
		}),
		maxPicks: 200,
		bulkDelete: false,
		data: [],
		total: 0,
	});

	constructor() {
		if (this.isBrowser) this.loadDrafted();
		effect(() => {
			const page = this.productsQuery.data();
			this.lang();
			const drafted = this.drafted();
			const chip = `<span class="fm-chip warn mt-1">${escapeHtml(this.transloco.translate('product_draft_of_changes'))}</span>`;
			const stockStatus = (stock: number) => (stock > 0 ? 'in_stock' : 'out_of_stock');
			const data = (page?.items ?? []).map((row): ProductTableRow => {
				const view = productStatusView(row.status, row.wasLive ?? false);
				return {
					id: row.id,
					slug: row.slug,
					name: `${escapeHtml(row.title)}${drafted.has(row.id) ? `<br>${chip}` : ''}`,
					title: row.title,
					sku: row.sku,
					sale_price: row.sellingFromINR,
					product_thumbnail: row.thumbnailUrl ? { original_url: row.thumbnailUrl } : null,
					stock: `<div class="status-${stockStatus(row.stock)}"><span>${stockStatus(row.stock).replace(/_/g, ' ')}</span></div>`,
					status: row.status,
					variantCount: row.variantCount,
					status_switch: row.status === 'live' ? '1' : '0',
					status_label: view.label,
					status_class: view.pill,
					status_locked: row.status === 'discontinued',
				};
			});
			this.tableConfig.update((config) => ({ ...config, data, total: page?.total ?? 0 }));
		});
	}

	onTableChange(data?: Params) {
		this.params.set({ ...data });
	}

	onActionClicked(action: ITableClickedAction) {
		const name = action.actionToPerform ?? '';
		if (name == 'edit') this.edit(action.data);
		else if (name == 'go_live') this.goLive(action.data);
		else if (name == 'status_switch') this.statusSwitch(action.data, Number(action.value));
		else if (name == 'remove') void this.runBulk('delete', [String(action.data?.id)]);
		else if (name == 'bulk_sale') void this.openSale(action.data);
		else if (BULK[name]) void this.runBulk(BULK[name], (action.data ?? []).map(String));
	}

	edit(data: ProductTableRow) {
		// Save and next on the form walks the rows on screen, in this order.
		const ids = (this.tableConfig().data ?? []).map((row) => String(row.id));
		rememberProductQueue(this.isBrowser ? sessionStorage : null, ids);
		void this.router.navigateByUrl(`/product/edit/${data.id}`);
	}

	/** The same call and the same toast as the product form. */
	goLive(data: ProductTableRow) {
		this.products.goLive(data.id).subscribe((result) => {
			goLiveToast(result, this.notifier, (key) => this.transloco.translate(key));
			if (result.live) void this.productsQuery.refetch();
		});
	}

	/** The row's switch (brief § 5): on is Go Live, off is Take off shop; the table asked first. */
	statusSwitch(data: ProductTableRow, value: number) {
		if (value === 1) {
			this.goLive(data);
			return;
		}
		this.products.bulk('take-off', [data.id], false).subscribe({
			next: (result) => this.report('take-off', result),
			error: () => this.notifier.showError(this.transloco.translate('bulk_failed')),
		});
	}

	/** Asks first with what would happen (a dry run), then acts and reports per product. */
	async runBulk(action: ProductBulkAction, ids: string[]) {
		if (!ids.length) return;
		let plan: ProductBulkResult;
		try {
			plan = await firstValueFrom(this.products.bulk(action, ids, true));
		} catch {
			this.notifier.showError(this.transloco.translate('bulk_failed'));
			return;
		}
		const targets =
			action === 'discontinue'
				? (await firstValueFrom(this.products.getReplacementTargets())).map((target) => ({
						value: target.path,
						label: `${target.label} · ${target.path}`,
					}))
				: undefined;
		const popup = this.modals.open(ProductBulkPopup, {
			centered: true,
			windowClass: 'theme-modal',
			ariaLabelledBy: 'product_bulk_title',
		});
		(popup.componentInstance as ProductBulkPopup).start({
			action,
			plan,
			targets,
			act: (replacementPath) => firstValueFrom(this.products.bulk(action, ids, false, replacementPath)),
		});
		const result = (await popup.result.catch(() => null)) as ProductBulkResult | null;
		if (result) this.report(action, result);
	}

	/** Done and skipped products are unticked; the ones it couldn't do stay ticked, amber, with why. */
	private report(action: ProductBulkAction, result: ProductBulkResult) {
		const word = action.replace(/-/g, '_');
		const done = result.rows.filter((row) => row.outcome === 'done');
		const refused = result.rows.filter((row) => row.outcome === 'refused');
		this.table()?.dropPicks(result.rows.filter((row) => row.outcome !== 'refused').map((row) => row.id));
		this.table()?.markPicks(new Map(refused.map((row) => [row.id, this.why(row)])));
		if (done.length)
			this.notifier.showSuccess(this.transloco.translate(`bulk_report_${word}`, { count: done.length }));
		if (refused.length) {
			this.notifier.showError(this.transloco.translate('bulk_report_refused', { count: refused.length }));
		}
		void this.productsQuery.refetch();
		if (action === 'delete') this.loadDrafted();
	}

	private loadDrafted() {
		this.drafts.list({ scope: 'mine', pageSize: 100 }).subscribe({
			next: (list) =>
				this.drafted.set(
					new Set(
						list.items
							.filter((draft) => draft.kind === 'edit' && draft.productId)
							.map((draft) => draft.productId as string),
					),
				),
			error: () => undefined,
		});
	}

	private why(row: ProductBulkRow): string {
		return row.gaps.length
			? goLiveLabels(row.gaps, (key) => this.transloco.translate(key)).join(', ')
			: this.transloco.translate(`bulk_why_${row.reason ?? 'failed'}`);
	}

	/** Put on sale (brief § 4): the picked products join a sale, or a new draft sale. */
	async openSale(ids: (string | number)[]) {
		const rows = this.table()?.pickedRows<ProductTableRow>(ids) ?? [];
		const picks: SalePick[] = rows.map((row) => ({
			id: String(row.id),
			title: row.title,
			thumbnailUrl: row.product_thumbnail?.original_url ?? null,
		}));
		if (!picks.length) return;
		const popup = this.modals.open(ProductSalePopup, {
			centered: true,
			size: 'lg',
			windowClass: 'theme-modal',
			ariaLabelledBy: 'product_sale_title',
		});
		(popup.componentInstance as ProductSalePopup).start(picks);
		const closed = (await popup.result.catch(() => null)) as SaleClosed | null;
		if (!closed) return;
		const { result, created } = closed;
		const joined = result.rows.filter((row) => row.outcome === 'done');
		const left = result.rows.filter((row) => row.outcome === 'refused');
		this.table()?.dropPicks(joined.map((row) => row.productId));
		this.table()?.markPicks(
			new Map(
				left.map((row) => [
					row.productId,
					this.transloco.translate(`sale_left_out_${row.reason ?? 'bad_rule'}`),
				]),
			),
		);
		if (left.length)
			this.notifier.showError(this.transloco.translate('bulk_report_refused', { count: left.length }));
		if (created && result.eventId) {
			// The new draft sale opens in Events: its name, dates, message and popup are set there.
			this.notifier.showSuccess(this.transloco.translate('sale_draft_made'));
			void this.router.navigateByUrl(`/event/edit/${result.eventId}`);
			return;
		}
		if (joined.length)
			this.notifier.showSuccess(this.transloco.translate('sale_report_added', { count: joined.length }));
		void this.productsQuery.refetch();
	}
}
