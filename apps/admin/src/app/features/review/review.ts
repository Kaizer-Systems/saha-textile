import { Component, TemplateRef, effect, inject, signal, viewChild } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { type AdminReviewRow, ReviewsGateway, type ReviewPhoto } from '@core/media/reviews.gateway';
import { Params } from '@data-access/interfaces/core.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { injectModerationReviewsQuery } from '@data-access/queries/review.queries';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { Button } from '@shared/ui/button/button';
import { Table } from '@shared/ui/table/table';

/** One table row: the API row flattened into the theme table's column fields. */
interface ReviewTableRow {
	id: string;
	product_review_image: { original_url: string } | null;
	consumer_name: string;
	product_name: string;
	rating: number;
	status: string;
	photo_count: number;
	created_at?: string;
	source: AdminReviewRow;
}

/**
 * Review moderation (owner log § Reviews, § Media → Review photos; approved wireframe 4).
 * The theme table, its image column showing the first photo, Approve and Reject row actions,
 * and a Photos action that opens every photo in the theme modal. Pending photos are shown
 * through short-lived signed links; approving publishes them, rejecting deletes them.
 */
@Component({
	selector: 'app-review',
	templateUrl: './review.html',
	styleUrls: ['./review.scss'],
	imports: [PageWrapper, Table, Button, TranslocoModule],
})
export class Review {
	private readonly gateway = inject(ReviewsGateway);
	private readonly modals = inject(NgbModal);
	private readonly queryClient = inject(QueryClient);
	private readonly notifications = inject(NotificationService);

	private readonly params = signal<Params>({});
	readonly reviewsQuery = injectModerationReviewsQuery(() => this.params());
	readonly photosTemplate = viewChild.required<TemplateRef<unknown>>('photosModal');
	readonly openPhotos = signal<ReviewPhoto[]>([]);

	private readonly baseConfig: ITableConfig = {
		columns: [
			{ title: 'No.', dataField: 'no', type: 'no' },
			{
				title: 'image',
				dataField: 'product_review_image',
				class: 'tbl-image',
				type: 'image',
				placeholder: 'assets/images/product.png',
			},
			{ title: 'consumer_name', dataField: 'consumer_name' },
			{ title: 'product_name', dataField: 'product_name' },
			{ title: 'rating', dataField: 'rating', type: 'rating' },
			{ title: 'status', dataField: 'status' },
			{ title: 'photos', dataField: 'photo_count' },
			{ title: 'created_at', dataField: 'created_at', type: 'date' },
		],
		rowActions: [
			{ label: 'Photos', actionToPerform: 'photos', icon: 'ri-image-line', permission: 'review.index' },
			{ label: 'Approve', actionToPerform: 'approve', icon: 'ri-check-line', permission: 'review.edit' },
			{ label: 'Reject', actionToPerform: 'reject', icon: 'ri-close-circle-line', permission: 'review.edit' },
		],
		data: [] as ReviewTableRow[],
		total: 0,
	};

	readonly tableConfig = signal<ITableConfig>(this.baseConfig);

	constructor() {
		effect(() => {
			const page = this.reviewsQuery.data();
			const data = (page?.items ?? []).map((row): ReviewTableRow => ({
				id: row.review.id,
				product_review_image: row.photos[0]?.thumbUrl ? { original_url: row.photos[0].thumbUrl } : null,
				consumer_name: row.customerName ?? row.review.userId,
				product_name: row.productName ?? row.review.productId,
				rating: row.review.rating,
				status: row.review.status,
				photo_count: row.photos.length,
				created_at: row.review.createdAt,
				source: row,
			}));
			// A signal, not a field write: in this zoneless app a plain field set from an effect
			// does not schedule a render, so the table kept showing the previous page.
			this.tableConfig.set({ ...this.baseConfig, data, total: page?.total ?? 0 });
		});
	}

	onTableChange(data?: Params) {
		this.params.set({ ...data });
	}

	async onActionClicked(action: ITableClickedAction) {
		const row = action.data as ReviewTableRow;
		if (action.actionToPerform === 'photos') {
			this.openPhotos.set(row.source.photos);
			this.modals.open(this.photosTemplate(), { centered: true, windowClass: 'theme-modal modal-lg' });
			return;
		}
		if (action.actionToPerform !== 'approve' && action.actionToPerform !== 'reject') return;
		try {
			await firstValueFrom(this.gateway.moderate(row.id, action.actionToPerform));
			this.notifications.showSuccess(
				action.actionToPerform === 'approve' ? 'Review approved.' : 'Review rejected.',
			);
			await this.queryClient.invalidateQueries({ queryKey: ['moderation-reviews'] });
		} catch {
			this.notifications.showError('The review could not be moderated.');
		}
	}
}
