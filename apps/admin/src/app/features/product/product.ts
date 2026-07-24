import { Component, effect, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { Params } from '@data-access/interfaces/core.interface';
import { IProduct } from '@data-access/interfaces/product.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { injectProductsQuery } from '@data-access/queries/product.queries';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Table } from '@shared/ui/table/table';

@Component({
	selector: 'app-product',
	templateUrl: './product.html',
	styleUrls: ['./product.scss'],
	imports: [PageWrapper, HasPermissionDirective, RouterModule, Table, TranslocoModule],
})
export class Product {
	private router = inject(Router);

	private readonly params = signal<Params>({});
	readonly productsQuery = injectProductsQuery(() => this.params());

	public tableConfig: ITableConfig = {
		columns: [
			{ title: 'No.', dataField: 'no', type: 'no' },
			{
				title: 'image',
				dataField: 'product_thumbnail',
				class: 'tbl-image',
				type: 'image',
				placeholder: 'assets/images/product.png',
			},
			{ title: 'name', dataField: 'name', sortable: true, sort_direction: 'desc' },
			{ title: 'sku', dataField: 'sku', sortable: true, sort_direction: 'desc' },
			{
				title: 'price',
				dataField: 'sale_price',
				type: 'price',
				sortable: true,
				sort_direction: 'desc',
			},
			{ title: 'stock', dataField: 'stock' },
			{ title: 'store', dataField: 'store_name' },
			{ title: 'approved', dataField: 'is_approved', type: 'switch', canAllow: ['admin'] },
			{ title: 'status', dataField: 'status', type: 'switch' },
		],
		rowActions: [
			{
				label: 'Edit',
				actionToPerform: 'edit',
				icon: 'ri-pencil-line',
				permission: 'product.edit',
			},
			{
				label: 'Delete',
				actionToPerform: 'delete',
				icon: 'ri-delete-bin-line',
				permission: 'product.destroy',
			},
		],
		data: [] as IProduct[],
		total: 0,
	};

	constructor() {
		effect(() => {
			const product = this.productsQuery.data();
			const products = product?.data?.filter((element: IProduct) => {
				element.stock = element.stock_status
					? `<div class="status-${element.stock_status}"><span>${element.stock_status.replace(/_/g, ' ')}</span></div>`
					: '-';
				element.store_name = element?.store ? element?.store?.store_name : '-';
				return element;
			});
			this.tableConfig.data = product ? products : [];
			this.tableConfig.total = product ? product.total : 0;
		});
	}

	onTableChange(data?: Params) {
		this.params.set({ ...data });
	}

	onActionClicked(action: ITableClickedAction) {
		if (action.actionToPerform == 'edit') this.edit(action.data);
		else if (action.actionToPerform == 'is_approved') this.approve(action.data);
		else if (action.actionToPerform == 'status') this.status(action.data);
		else if (action.actionToPerform == 'delete') this.delete(action.data);
		else if (action.actionToPerform == 'deleteAll') this.deleteAll(action.data);
		else if (action.actionToPerform == 'duplicate') this.duplicate(action.data);
	}

	edit(data: IProduct) {
		void this.router.navigateByUrl(`/product/edit/${data.id}`);
	}

	approve(_data: IProduct) {
		// Mock: approve toggle has no backend yet.
	}

	status(_data: IProduct) {
		// Mock: status toggle has no backend yet.
	}

	delete(_data: IProduct) {
		// Mock: delete has no backend yet.
	}

	deleteAll(_ids: number[]) {
		// Mock: bulk delete has no backend yet.
	}

	duplicate(_ids: number[]) {
		// Mock: replicate has no backend yet.
	}
}
