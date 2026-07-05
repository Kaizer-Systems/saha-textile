import { Component, effect, inject, signal, viewChild } from '@angular/core';

import { injectRefundsQuery } from '@data-access/queries/refund.queries';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { PayoutModal } from '@shared/ui/modal/payout-modal/payout-modal';
import { Table } from '@shared/ui/table/table';
import { Params } from '@data-access/interfaces/core.interface';
import { IRefund } from '@data-access/interfaces/refund.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';

@Component({
	selector: 'app-refund',
	templateUrl: './refund.html',
	styleUrls: ['./refund.scss'],
	imports: [PageWrapper, Table, PayoutModal],
})
export class Refund {
	private readonly params = signal<Params>({});
	readonly refundsQuery = injectRefundsQuery(() => this.params());

	readonly PayoutModal = viewChild<PayoutModal>('payoutModal');

	public tableConfig: ITableConfig = {
		columns: [
			{ title: 'No.', dataField: 'no', type: 'no' },
			{ title: 'order_number', dataField: 'order_id' },
			{
				title: 'consumer_name',
				dataField: 'consumer_name',
				sortable: true,
				sort_direction: 'desc',
			},
			{ title: 'status', dataField: 'refund_status' },
			{
				title: 'created_at',
				dataField: 'created_at',
				type: 'date',
				sortable: true,
				sort_direction: 'desc',
			},
		],
		rowActions: [{ label: 'View', actionToPerform: 'view', icon: 'ri-eye-line' }],
		data: [] as IRefund[],
		total: 0,
	};

	constructor() {
		effect(() => {
			const refund = this.refundsQuery.data();
			const refunds = refund?.data?.filter((element: IRefund) => {
				element.consumer_name = element?.user?.name;
				element.order_id = `<span class="fw-bolder">#${element?.order?.order_number}</span>`;
				element.refund_status = element.status
					? `<div class="status-${element.status}"><span>${element.status.replace(/_/g, ' ')}</span></div>`
					: '-';
				return element;
			});
			this.tableConfig.data = refund ? refunds : [];
			this.tableConfig.total = refund ? refund.total : 0;
		});
	}

	onActionClicked(action: ITableClickedAction) {
		if (action.actionToPerform == 'view') void this.PayoutModal().openModal(action.data);
	}

	onTableChange(data?: Params) {
		this.params.set({ ...data });
	}

	approved(_event: { data: IRefund; status?: string }): void {
		// Mock: refund status update has no backend yet.
	}
}
