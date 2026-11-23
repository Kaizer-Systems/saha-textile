import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { productStatusView } from '@core/catalog/product-status';
import { MenuStore } from '@core/state/menu.store';
import { Params } from '@data-access/interfaces/core.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { NotificationService } from '@data-access/services/notification.service';
import { ProductDraftService } from '@data-access/services/product-draft.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { Table } from '@shared/ui/table/table';
import { searchOf } from '@shared/util/search-of';

import type { ProductDraftRow } from '@saha-textile/contracts';

interface DraftTableRow {
	id: string;
	kind: ProductDraftRow['kind'];
	productId: string | null;
	kind_pill: string;
	thumb: { original_url: string } | null;
	product: string;
	stands: string;
	updatedAt: string;
	saved_by: string;
}

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const pill = (css: string, words: string) => `<div class="${css}"><span>${escapeHtml(words)}</span></div>`;

/**
 * Products › Drafts (brief 7e): both kinds of draft in one list. New product (not created yet) and
 * Changes to an existing product, with what still blocks Save. Mine / Everyone's, the same switch as
 * Media favourites, so someone can finish a colleague's work. Discard asks first and removes the
 * draft only.
 */
@Component({
	selector: 'app-product-drafts',
	templateUrl: './product-drafts.html',
	imports: [PageWrapper, Table, TranslocoModule],
})
export class ProductDrafts {
	private router = inject(Router);
	private drafts = inject(ProductDraftService);
	private transloco = inject(TranslocoService);
	private notifier = inject(NotificationService);
	private menu = inject(MenuStore);
	private queryClient = inject(QueryClient);
	private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
	private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

	readonly who = signal<'mine' | 'everyone'>('mine');
	private readonly params = signal<Params>({});

	readonly draftsQuery = injectQuery(() => ({
		queryKey: ['product-drafts', this.who(), this.params()],
		queryFn: () =>
			firstValueFrom(
				this.drafts.list({
					scope: this.who(),
					search: searchOf(this.params()),
					page: Number(this.params()['page']) || 1,
					pageSize: Number(this.params()['paginate']) || 30,
				}),
			),
		enabled: this.isBrowser,
	}));

	readonly tableConfig = signal<ITableConfig<DraftTableRow>>({
		columns: [
			{ title: 'draft_kind', dataField: 'kind_pill' },
			{
				title: 'image',
				dataField: 'thumb',
				class: 'tbl-image',
				type: 'image',
				placeholder: 'assets/images/product.png',
			},
			{ title: 'product', dataField: 'product' },
			{ title: 'draft_where_it_stands', dataField: 'stands' },
			{ title: 'draft_last_saved_column', dataField: 'updatedAt', type: 'date', date_format: 'd MMM, h:mm a' },
		],
		rowActions: [
			{ label: 'edit', actionToPerform: 'edit', icon: 'ri-pencil-line', permission: 'product.index' },
			{
				label: 'draft_discard',
				actionToPerform: 'delete',
				icon: 'ri-delete-bin-line',
				permission: 'product.index',
			},
		],
		data: [],
		total: 0,
	});

	constructor() {
		effect(() => {
			const list = this.draftsQuery.data();
			this.lang();
			const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
			if (list) this.menu.setBadge('/product/drafts', list.mine);
			const everyone = this.who() === 'everyone';
			const data = (list?.items ?? []).map((row): DraftTableRow => {
				const status = row.productStatus ? productStatusView(row.productStatus, row.productWasLive) : null;
				const name = row.kind === 'edit' ? (row.productTitle ?? row.title) : row.title;
				const stands =
					row.kind === 'new' && !row.title
						? `<span class="help-text">${escapeHtml(t('draft_nothing_yet'))}</span>`
						: row.toFix
							? `<span class="text-danger">${escapeHtml(t('draft_to_fix', { count: row.toFix }))}</span>`
							: row.kind === 'edit'
								? escapeHtml(t('draft_ready_update', { count: row.changedCount }))
								: escapeHtml(t('draft_ready_save'));
				return {
					id: row.id,
					kind: row.kind,
					productId: row.productId,
					kind_pill:
						row.kind === 'new'
							? pill('status-awaiting_for_approval', t('draft_new_product'))
							: pill('status-pending', t('draft_changes')),
					thumb: row.thumbnailUrl ? { original_url: row.thumbnailUrl } : null,
					product: `${name ? escapeHtml(name) : `<span class="help-text">${escapeHtml(t('draft_untitled'))}</span>`}${
						status ? ` ${pill(status.pill, t(status.label))}` : ''
					}${everyone && row.updatedByName ? `<small class="help-text d-block">${escapeHtml(row.updatedByName)}</small>` : ''}`,
					stands,
					updatedAt: row.updatedAt,
					saved_by: row.updatedByName ?? '',
				};
			});
			this.tableConfig.update((config) => ({ ...config, data, total: list?.total ?? 0 }));
		});
	}

	setWho(who: 'mine' | 'everyone') {
		this.who.set(who);
	}

	onTableChange(data?: Params) {
		this.params.set({ ...data });
	}

	onActionClicked(action: ITableClickedAction) {
		if (action.actionToPerform === 'edit') this.open(action.data as DraftTableRow);
		else if (action.actionToPerform === 'delete') void this.discard(action.data as DraftTableRow);
	}

	/** Opens the form exactly as it was left. */
	open(row: DraftTableRow) {
		void this.router.navigateByUrl(
			row.kind === 'edit' && row.productId
				? `/product/edit/${row.productId}?draft=${row.id}`
				: `/product/create?draft=${row.id}`,
		);
	}

	private async discard(row: DraftTableRow) {
		try {
			await firstValueFrom(this.drafts.discard(row.id));
			this.notifier.showSuccess(this.transloco.translate('draft_discarded'));
		} catch {
			this.notifier.showError(this.transloco.translate('draft_not_saved'));
		}
		void this.queryClient.invalidateQueries({ queryKey: ['product-drafts'] });
	}
}
