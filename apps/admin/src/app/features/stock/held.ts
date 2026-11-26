import { Component, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { ShortDatePipe, StockQuantityPipe } from '@core/purchasing/purchasing-format';
import { STOCK_KEYS, StockGateway } from '@core/purchasing/stock.gateway';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Pagination } from '@shared/ui/pagination/pagination';

import { AdjustPopup, HOLD_REASONS } from './adjust-popup';

import type { HoldReason, StockHold, StockListRow } from '@saha-textile/contracts';

/** The pill a hold wears (i06): waiting on someone else is pending, our own use is in progress. */
export const holdPill = (reason: HoldReason): string =>
	reason === 'waiting_for_supplier' || reason === 'quality_check' ? 'pending' : 'processing';

/** Enough of a stock row for the adjust popup, from the hold itself. */
export function rowFromHold(hold: StockHold): StockListRow {
	return {
		productId: hold.productId,
		variantId: hold.variantId,
		sku: hold.sku,
		title: hold.title,
		optionsLabel: hold.optionsLabel,
		imageUrl: hold.imageUrl,
		categoryName: null,
		soldBy: hold.soldBy,
		onHand: 0,
		held: hold.quantity,
		inOrders: 0,
		freeToSell: 0,
		lowStockLevel: null,
		status: 'in_stock',
		valueAtCostINR: null,
		lastReceivedOn: null,
		oldestPieceDays: null,
	};
}

/**
 * Held stock (i06): pieces on hand and in the stock value but not for sale. Release needs no
 * approval; write-off follows the approval rule; Return to supplier opens a purchase return. A hold
 * older than the reminder setting turns yellow.
 */
@Component({
	selector: 'app-held',
	templateUrl: './held.html',
	imports: [
		HasPermissionDirective,
		PageWrapper,
		Pagination,
		RouterModule,
		ShortDatePipe,
		StockQuantityPipe,
		TranslocoModule,
	],
})
export class Held {
	private readonly router = inject(Router);
	private readonly gateway = inject(StockGateway);
	private readonly modals = inject(NgbModal);
	private readonly queryClient = inject(QueryClient);

	readonly reasons = HOLD_REASONS;
	readonly reason = signal<HoldReason | null>(null);
	readonly page = signal(1);
	readonly pageSize = 15;
	readonly query = injectQuery(() => ({
		queryKey: [...STOCK_KEYS.held, this.reason(), this.page()],
		queryFn: () =>
			firstValueFrom(
				this.gateway.held({
					...(this.reason() ? { reason: this.reason() as HoldReason } : {}),
					page: this.page(),
					pageSize: this.pageSize,
				}),
			),
	}));
	readonly pill = holdPill;

	setReason(reason: HoldReason | null): void {
		this.reason.set(reason);
		this.page.set(1);
	}

	async act(hold: StockHold, action: 'release' | 'remove'): Promise<void> {
		const popup = this.modals.open(AdjustPopup, {
			size: 'lg',
			windowClass: 'theme-modal modal-lg',
			ariaLabelledBy: 'adjust_popup_title',
		});
		await (popup.componentInstance as AdjustPopup).start(rowFromHold(hold), { action, holdId: hold.id });
		if (await popup.result.catch(() => null))
			void this.queryClient.invalidateQueries({ queryKey: STOCK_KEYS.stock });
	}

	/** Return to supplier: a purchase return for these pieces, from the entry they came on. */
	returnToSupplier(hold: StockHold): void {
		void this.router.navigate(['/purchase-returns', 'create'], {
			queryParams: { hold: hold.id, sku: hold.sku, reason: 'quality_after_accepting' },
		});
	}
}
