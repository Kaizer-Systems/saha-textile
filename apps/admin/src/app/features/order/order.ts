import { Component, effect, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { Params } from '@data-access/interfaces/core.interface';
import { IOrder } from '@data-access/interfaces/order.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { injectOrdersQuery } from '@data-access/queries/order.queries';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Table } from '@shared/ui/table/table';

@Component({
	selector: 'app-order',
	templateUrl: './order.html',
	styleUrls: ['./order.scss'],
	imports: [PageWrapper, HasPermissionDirective, RouterModule, Table, TranslocoModule],
})
export class Order {
	private router = inject(Router);

	private readonly params = signal<Params>({});
	readonly ordersQuery = injectOrdersQuery(() => this.params());

	public tableConfig: ITableConfig = {
		columns: [
			{ title: 'No.', dataField: 'no', type: 'no' },
			{ title: 'order_number', dataField: 'order_id' },
			{
				title: 'order_date',
				dataField: 'created_at',
				type: 'date',
				sortable: true,
				sort_direction: 'desc',
			},
			{ title: 'customer_name', dataField: 'consumer_name' },
			{ title: 'total_amount', dataField: 'total', type: 'price' },
			{ title: 'payment_status', dataField: 'order_payment_status' },
			{ title: 'payment_method', dataField: 'payment_mode' },
		],
		rowActions: [{ label: 'View', actionToPerform: 'view', icon: 'ri-eye-line', permission: 'order.edit' }],
		data: [],
		total: 0,
	};

	constructor() {
		effect(() => {
			const order = this.ordersQuery.data();
			const orders = order?.data?.filter((element: IOrder) => {
				element.order_id = `<span class="fw-bolder">#${element.order_number}</span>`;
				element.order_payment_status = element.payment_status
					? `<div class="status-${element.payment_status.toLowerCase()}"><span>${element.payment_status.replace(/_/g, ' ')}</span></div>`
					: '-';
				element.payment_mode = element.payment_method
					? `<div class="payment-mode"><span>${element.payment_method.replace(/_/g, ' ').toUpperCase()}</span></div>`
					: '-';
				element.consumer_name = `<span class="text-capitalize">${element.consumer.name}</span>`;
				return element;
			});
			this.tableConfig.data = order ? orders : [];
			this.tableConfig.total = order ? order.total : 0;
		});
	}

	onTableChange(data?: Params) {
		this.params.set({ ...data });
	}

	onActionClicked(action: ITableClickedAction) {
		if (action.actionToPerform == 'view') this.view(action.data);
	}

	view(data: IOrder) {
		void this.router.navigateByUrl(`/order/details/${data.order_number}`);
	}
}
