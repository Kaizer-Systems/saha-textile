import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { PILLS, ShortDatePipe } from '@core/purchasing/purchasing-format';
import { STOCK_KEYS, StockGateway } from '@core/purchasing/stock.gateway';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Pagination } from '@shared/ui/pagination/pagination';

import { CountStart } from './count-start';

import type { StockCount, StockCountListQuery } from '@saha-textile/contracts';

/** Stock counts (c01): counting, to review, waiting for approval, posted. */
@Component({
	selector: 'app-count-list',
	templateUrl: './count-list.html',
	imports: [HasPermissionDirective, PageWrapper, Pagination, RouterModule, ShortDatePipe, TranslocoModule],
})
export class CountList {
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly gateway = inject(StockGateway);
	private readonly modals = inject(NgbModal);
	private readonly queryClient = inject(QueryClient);

	readonly pills = PILLS;
	readonly filter = signal<StockCountListQuery['filter']>('all');
	readonly filters: readonly StockCountListQuery['filter'][] = ['all', 'counting', 'review', 'posted'];
	readonly page = signal(1);
	readonly pageSize = 15;
	readonly query = injectQuery(() => ({
		queryKey: [...STOCK_KEYS.counts, this.filter(), this.page()],
		queryFn: () =>
			firstValueFrom(this.gateway.counts({ filter: this.filter(), page: this.page(), pageSize: this.pageSize })),
	}));
	readonly counts = computed(() => this.query.data()?.counts ?? {});

	constructor() {
		// "Start a stock count" on the all-stock page lands here with the popup open.
		if (this.route.snapshot.queryParamMap.get('start')) setTimeout(() => void this.start());
	}

	setFilter(filter: StockCountListQuery['filter']): void {
		this.filter.set(filter);
		this.page.set(1);
	}

	open(count: StockCount): void {
		void this.router.navigate(['/stock-counts', count.id]);
	}

	async start(): Promise<void> {
		const popup = this.modals.open(CountStart, {
			size: 'lg',
			windowClass: 'theme-modal modal-lg',
			ariaLabelledBy: 'count_start_title',
		});
		const count = (await popup.result.catch(() => null)) as StockCount | null;
		if (!count) return;
		void this.queryClient.invalidateQueries({ queryKey: STOCK_KEYS.counts });
		this.open(count);
	}
}
