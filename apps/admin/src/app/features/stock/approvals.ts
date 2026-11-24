import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { RupeesPipe, ShortDateTimePipe, StockQuantityPipe, apiProblem } from '@core/purchasing/purchasing-format';
import { STOCK_KEYS, StockGateway } from '@core/purchasing/stock.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { askReason } from '@features/purchasing/shared/popups';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { Pagination } from '@shared/ui/pagination/pagination';

import { countQuantity } from './count-quantity';

import type { AdjustmentRequest, AdjustmentRequestListQuery } from '@saha-textile/contracts';

export type ApprovalTab = AdjustmentRequestListQuery['status'];

/** Nobody approves their own request (P2): the button is hidden and the API refuses it too. */
export const isOwnRequest = (request: Pick<AdjustmentRequest, 'requestedBy'>, me: string | null | undefined): boolean =>
	!!me && request.requestedBy === me;

/**
 * Approvals (i05, i05b): write-offs and count differences from people without Approve write-offs.
 * Approving applies the change at once; rejecting needs a reason, which reaches the requester.
 */
@Component({
	selector: 'app-approvals',
	templateUrl: './approvals.html',
	imports: [PageWrapper, Pagination, RouterModule, RupeesPipe, ShortDateTimePipe, StockQuantityPipe, TranslocoModule],
})
export class Approvals {
	private readonly router = inject(Router);
	private readonly gateway = inject(StockGateway);
	private readonly modals = inject(NgbModal);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly queryClient = inject(QueryClient);
	private readonly auth = inject(AuthStore);

	readonly tab = signal<ApprovalTab>('pending');
	readonly tabs: readonly ApprovalTab[] = ['pending', 'approved', 'rejected'];
	readonly page = signal(1);
	readonly pageSize = 15;
	readonly busy = signal<string | null>(null);
	readonly me = computed(() => this.auth.user()?.id ?? null);
	readonly canSeeCost = computed(() => this.auth.permissions().includes('stock.cost'));
	readonly query = injectQuery(() => ({
		queryKey: [...STOCK_KEYS.approvals, this.tab(), this.page()],
		queryFn: () =>
			firstValueFrom(this.gateway.approvals({ status: this.tab(), page: this.page(), pageSize: this.pageSize })),
	}));
	readonly own = isOwnRequest;

	/** A count's short or over with pieces and metres kept apart. */
	qty(pieces: number, tenths: number): string {
		return countQuantity(this.transloco, pieces, tenths);
	}

	setTab(tab: ApprovalTab): void {
		this.tab.set(tab);
		this.page.set(1);
	}

	private refresh(): void {
		void this.queryClient.invalidateQueries({ queryKey: STOCK_KEYS.approvals });
		void this.queryClient.invalidateQueries({ queryKey: STOCK_KEYS.alerts });
		void this.queryClient.invalidateQueries({ queryKey: STOCK_KEYS.stock });
	}

	async approve(request: AdjustmentRequest): Promise<void> {
		this.busy.set(request.id);
		try {
			await firstValueFrom(this.gateway.approve(request.id));
			this.notifier.showSuccess(this.transloco.translate('request_approved'));
			this.refresh();
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		} finally {
			this.busy.set(null);
		}
	}

	/** A count's differences are reviewed on the count itself (c03). */
	review(request: AdjustmentRequest): void {
		if (request.countId) void this.router.navigate(['/stock-counts', request.countId]);
	}

	async reject(request: AdjustmentRequest): Promise<void> {
		const done = await askReason(this.modals, {
			title: 'reject_title',
			body: 'reject_body',
			params: { who: request.requestedByName ?? '', sku: request.sku ?? request.title },
			label: 'why_not',
			help: 'reject_help',
			confirm: 'reject',
			confirmClass: 'btn-danger',
			act: (reason) => firstValueFrom(this.gateway.reject(request.id, reason)),
		});
		if (done) {
			this.notifier.showSuccess(this.transloco.translate('request_rejected'));
			this.refresh();
		}
	}
}
