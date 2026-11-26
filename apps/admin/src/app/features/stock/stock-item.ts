import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { RupeesPipe, ShortDatePipe, ShortDateTimePipe, StockQuantityPipe } from '@core/purchasing/purchasing-format';
import { STOCK_KEYS, StockGateway } from '@core/purchasing/stock.gateway';
import { AuthStore } from '@core/state/auth.store';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Pagination } from '@shared/ui/pagination/pagination';

import { AdjustPopup } from './adjust-popup';

import type { StockVariantDetail } from '@saha-textile/contracts';

type HistoryRow = StockVariantDetail['history'][number];

/** The pill a movement wears on the history (i02): money in green, losses red, holds pending. */
export function movementPill(row: Pick<HistoryRow, 'source' | 'quantityDelta' | 'heldDelta'>): string {
	if (row.source === 'hold' || row.source === 'release') return 'pending';
	if (row.source.startsWith('order') || row.source.startsWith('reservation')) return 'refund';
	if (row.quantityDelta < 0) return 'cancelled';
	if (row.source === 'stock_count' || row.source === 'opening_stock') return 'processing';
	return 'completed';
}

/** Where a movement's document opens, by its type. */
export function documentLink(
	row: Pick<HistoryRow, 'documentType' | 'documentId'> & Partial<Pick<HistoryRow, 'source'>>,
): string[] | null {
	if (!row.documentId) return null;
	switch (row.documentType) {
		case 'stock_adjustment':
			// A write-off or addition has its page (E3); holds and releases have none.
			return row.source === 'manual_adjustment' ? ['/stock/adjustments', row.documentId] : null;
		case 'purchase_entry':
			return ['/purchase-entries', row.documentId];
		case 'purchase_return':
			return ['/purchase-returns', row.documentId];
		case 'stock_count':
			return ['/stock-counts', row.documentId];
		case 'order':
			return ['/order', 'details', row.documentId];
		default:
			return null;
	}
}

/**
 * Stock history of one item (i02) and its cost layers (i03): every movement with the document it
 * came from, who, the change and on hand after. Rows are never edited; corrections are new rows.
 * Cost layers are shown only to people who may see cost (P8): the API leaves them out otherwise.
 */
@Component({
	selector: 'app-stock-item',
	templateUrl: './stock-item.html',
	imports: [
		HasPermissionDirective,
		PageWrapper,
		Pagination,
		RouterModule,
		RupeesPipe,
		ShortDatePipe,
		ShortDateTimePipe,
		StockQuantityPipe,
		TranslocoModule,
	],
})
export class StockItem {
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly gateway = inject(StockGateway);
	private readonly modals = inject(NgbModal);
	private readonly queryClient = inject(QueryClient);
	private readonly auth = inject(AuthStore);

	readonly id = signal(this.route.snapshot.paramMap.get('id') ?? '');
	readonly tab = signal<'movements' | 'layers'>('movements');
	readonly page = signal(1);
	readonly pageSize = 20;
	readonly canSeeCost = computed(() => this.auth.permissions().includes('stock.cost'));
	readonly query = injectQuery(() => ({
		queryKey: [...STOCK_KEYS.stock, 'item', this.id(), this.page()],
		queryFn: () => firstValueFrom(this.gateway.detail(this.id(), this.page(), this.pageSize)),
		enabled: !!this.id(),
	}));
	readonly detail = computed(() => this.query.data() ?? null);
	readonly pill = movementPill;
	readonly link = documentLink;

	async adjust(): Promise<void> {
		const detail = this.detail();
		if (!detail) return;
		const popup = this.modals.open(AdjustPopup, {
			size: 'lg',
			windowClass: 'theme-modal modal-lg',
			ariaLabelledBy: 'adjust_popup_title',
		});
		await (popup.componentInstance as AdjustPopup).start(detail.row);
		if (await popup.result.catch(() => null))
			void this.queryClient.invalidateQueries({ queryKey: STOCK_KEYS.stock });
	}

	receive(): void {
		void this.router.navigate(['/purchase-entries', 'create'], { queryParams: { variant: this.id() } });
	}

	change(row: HistoryRow): string {
		const delta = row.quantityDelta;
		return delta > 0 ? `+${delta}` : String(delta);
	}
}
