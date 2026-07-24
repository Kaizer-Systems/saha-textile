import { Component, effect, signal } from '@angular/core';

import { Params } from '@data-access/interfaces/core.interface';
import { IReview } from '@data-access/interfaces/review.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { injectReviewsQuery } from '@data-access/queries/review.queries';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { Table } from '@shared/ui/table/table';

@Component({
	selector: 'app-review',
	templateUrl: './review.html',
	styleUrls: ['./review.scss'],
	imports: [PageWrapper, Table],
})
export class Review {
	private readonly params = signal<Params>({});
	readonly reviewsQuery = injectReviewsQuery(() => this.params());

	public tableConfig: ITableConfig = {
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
			{
				title: 'rating',
				dataField: 'rating',
				type: 'rating',
				sortable: true,
				sort_direction: 'desc',
			},
			{
				title: 'created_at',
				dataField: 'created_at',
				type: 'date',
				sortable: true,
				sort_direction: 'desc',
			},
		],
		rowActions: [
			{
				label: 'Delete',
				actionToPerform: 'delete',
				icon: 'ri-delete-bin-line',
				permission: 'review.destroy',
			},
		],
		data: [] as IReview[],
		total: 0,
	};

	constructor() {
		effect(() => {
			const review = this.reviewsQuery.data();
			const reviews = review?.data?.filter((element: IReview) => {
				element.product_review_image = element?.product?.product_thumbnail;
				element.consumer_name = element?.consumer?.name;
				element.product_name = element?.product?.name;
				return element;
			});
			this.tableConfig.data = review ? reviews : [];
			this.tableConfig.total = review ? review.total : 0;
		});
	}

	onTableChange(data?: Params) {
		this.params.set({ ...data });
	}

	onActionClicked(action: ITableClickedAction) {
		if (action.actionToPerform == 'delete') this.delete(action.data);
		else if (action.actionToPerform == 'deleteAll') this.deleteAll(action.data);
	}

	delete(_data: IReview) {
		// Mock: delete has no backend yet.
	}

	deleteAll(_ids: number[]) {
		// Mock: bulk delete has no backend yet.
	}
}
