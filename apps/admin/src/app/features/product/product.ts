import { Component, effect, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { Params } from '@data-access/interfaces/core.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { injectCatalogProductsQuery } from '@data-access/queries/product.queries';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Table } from '@shared/ui/table/table';

interface ProductTableRow {
	id: string;
	slug: string;
	name: string;
	sku: string;
	sale_price: number;
	product_thumbnail: { original_url: string } | null;
	stock: string;
	store_name: string;
	status: number;
}

@Component({
	selector: 'app-product',
	templateUrl: './product.html',
	styleUrls: ['./product.scss'],
	imports: [PageWrapper, HasPermissionDirective, RouterModule, Table, TranslocoModule],
})
export class Product {
	private router = inject(Router);

	private readonly params = signal<Params>({});
	readonly productsQuery = injectCatalogProductsQuery(() => ({
		search: typeof this.params()['search'] === 'string' ? this.params()['search'] : undefined,
		page: Number(this.params()['page']) || 1,
		pageSize: Number(this.params()['paginate']) || 15,
	}));

	readonly tableConfig = signal<ITableConfig<ProductTableRow>>({
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
		data: [],
		total: 0,
	});

	constructor() {
		effect(() => {
			const page = this.productsQuery.data();
			const stockStatus = (stock: number) => (stock > 0 ? 'in_stock' : 'out_of_stock');
			const data = (page?.items ?? []).map((row): ProductTableRow => ({
				id: row.id,
				slug: row.slug,
				name: row.title,
				sku: row.sku,
				sale_price: row.sellingFromINR,
				product_thumbnail: row.thumbnailUrl ? { original_url: row.thumbnailUrl } : null,
				stock: `<div class="status-${stockStatus(row.stock)}"><span>${stockStatus(row.stock).replace(/_/g, ' ')}</span></div>`,
				store_name: '-',
				status: row.status === 'live' ? 1 : 0,
			}));
			this.tableConfig.update((config) => ({ ...config, data, total: page?.total ?? 0 }));
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

	edit(data: ProductTableRow) {
		void this.router.navigateByUrl(`/product/edit/${data.id}`);
	}

	approve(_data: ProductTableRow) {
		// Mock: approve toggle has no backend yet.
	}

	status(_data: ProductTableRow) {
		// Mock: status toggle has no backend yet.
	}

	delete(_data: ProductTableRow) {
		// Mock: delete has no backend yet.
	}

	deleteAll(_ids: number[]) {
		// Mock: bulk delete has no backend yet.
	}

	duplicate(_ids: number[]) {
		// Mock: replicate has no backend yet.
	}
}
