import { Component, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { Params } from '@data-access/interfaces/core.interface';
import { IOrderStatus } from '@data-access/interfaces/order-status.interface';
import { ITableConfig } from '@data-access/interfaces/table.interface';
import { injectOrderStatusQuery } from '@data-access/queries/order-status.queries';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { Table } from '@shared/ui/table/table';

@Component({
	selector: 'app-order-status',
	templateUrl: './order-status.html',
	styleUrls: ['./order-status.scss'],
	imports: [PageWrapper, Table],
})
export class OrderStatus {
	private router = inject(Router);

	private readonly params = signal<Params>({});
	readonly orderStatusQuery = injectOrderStatusQuery(() => this.params());

	public tableConfig: ITableConfig = {
		columns: [
			{ title: 'No.', dataField: 'no', type: 'no' },
			{ title: 'name', dataField: 'name' },
			{ title: 'sequence', dataField: 'sequence', sortable: true, sort_direction: 'asc' },
			{
				title: 'created_at',
				dataField: 'created_at',
				type: 'date',
				sortable: true,
				sort_direction: 'desc',
			},
			{ title: 'status', dataField: 'status', type: 'switch' },
		],
		rowActions: [
			{ label: 'Edit', actionToPerform: 'edit', icon: 'ri-pencil-line' },
			{ label: 'Delete', actionToPerform: 'delete', icon: 'ri-delete-bin-line' },
		],
		data: [] as IOrderStatus[],
		total: 0,
	};

	constructor() {
		effect(() => {
			const orderStatus = this.orderStatusQuery.data();
			this.tableConfig.data = orderStatus ? orderStatus.data : [];
			this.tableConfig.total = orderStatus ? orderStatus.total : 0;
		});
	}

	onTableChange(data?: Params) {
		this.params.set({ ...data });
	}
}
