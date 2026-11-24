import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { TRANSFER_KEYS, TransfersGateway } from '@core/transfers/transfers.gateway';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Pagination } from '@shared/ui/pagination/pagination';

import { RequestPopup, type RequestStart } from './request-popup';
import { quantityText } from './transfer-format';

import type { LocationStockQuery, LocationStockView } from '@saha-textile/contracts';

export const STOCK_CHIPS = ['all', 'low', 'out'] as const;
const PAGE_SIZE = 25;

/**
 * Stock › Stock by location (accounts brief N1): each item's stock at each location, the location the header chip is
 * on first and the others to read, what is in transit, and Request stock on each row.
 */
@Component({
	selector: 'app-stock-by-location',
	imports: [PageWrapper, TranslocoModule, FormsModule, Pagination, HasPermissionDirective],
	templateUrl: './stock-by-location.html',
})
export class StockByLocationPage {
	private readonly gateway = inject(TransfersGateway);
	private readonly modals = inject(NgbModal);
	private readonly queries = inject(QueryClient);

	readonly chips = STOCK_CHIPS;
	readonly pageSize = PAGE_SIZE;
	readonly chip = signal<(typeof STOCK_CHIPS)[number]>('all');
	readonly search = signal('');
	readonly page = signal(1);
	readonly query = computed((): Partial<LocationStockQuery> => ({
		chip: this.chip(),
		page: this.page(),
		pageSize: PAGE_SIZE,
		...(this.search().trim() ? { search: this.search().trim() } : {}),
	}));
	readonly view = injectQuery(() => ({
		queryKey: TRANSFER_KEYS.stock(this.query()),
		queryFn: () => firstValueFrom(this.gateway.stock(this.query())),
	}));

	text(quantity: number, soldBy: 'piece' | 'metre'): string {
		return quantityText(quantity, soldBy);
	}

	setChip(chip: (typeof STOCK_CHIPS)[number]): void {
		this.chip.set(chip);
		this.page.set(1);
	}

	find(text: string): void {
		this.search.set(text);
		this.page.set(1);
	}

	/** N2 for one row, or for any item on the page from the header button. */
	async request(item: LocationStockView['items'][number] | null): Promise<void> {
		const view = this.view.data();
		if (!view) return;
		const popup = this.modals.open(RequestPopup, {
			centered: true,
			size: 'lg',
			windowClass: 'theme-modal',
			ariaLabelledBy: 'tr_request_title',
		});
		const start: RequestStart = { view, item };
		(popup.componentInstance as RequestPopup).start(start);
		const sent = await popup.result.catch(() => null);
		if (sent) await this.queries.invalidateQueries({ queryKey: TRANSFER_KEYS.all });
	}
}
