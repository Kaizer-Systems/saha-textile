import { Component, effect, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { Params } from '@data-access/interfaces/core.interface';
import { IStores } from '@data-access/interfaces/store.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { injectStoresQuery } from '@data-access/queries/store.queries';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Table } from '@shared/ui/table/table';

@Component({
	selector: 'app-store',
	templateUrl: './stores.html',
	styleUrls: ['./stores.scss'],
	imports: [PageWrapper, HasPermissionDirective, RouterModule, Table, TranslocoModule],
})
export class Stores {
	router = inject(Router);

	private readonly params = signal<Params>({});
	readonly storesQuery = injectStoresQuery(() => this.params());

	public tableConfig: ITableConfig = {
		columns: [
			{
				title: 'Logo',
				dataField: 'store_logo',
				class: 'tbl-logo-image',
				type: 'image',
				key: 'store_name',
			},
			{ title: 'store_name', dataField: 'store_name' },
			{ title: 'name', dataField: 'vendor_name' },
			{
				title: 'created_at',
				dataField: 'created_at',
				type: 'date',
				sortable: true,
				sort_direction: 'desc',
			},
			{ title: 'approved', dataField: 'is_approved', type: 'switch' },
		],
		rowActions: [
			{ label: 'Edit', actionToPerform: 'edit', icon: 'ri-pencil-line', permission: 'store.edit' },
			{
				label: 'Delete',
				actionToPerform: 'delete',
				icon: 'ri-delete-bin-line',
				permission: 'store.destroy',
			},
		],
		data: [] as IStores[],
		total: 0,
	};

	constructor() {
		effect(() => {
			const store = this.storesQuery.data();
			const stores = store?.data?.filter((element: IStores) => {
				element.vendor_name = element.vendor.name;
				return element;
			});
			this.tableConfig.data = stores ? stores : [];
			this.tableConfig.total = store ? store.total : 0;
		});
	}

	onTableChange(data?: Params) {
		this.params.set({ ...data });
	}

	onActionClicked(action: ITableClickedAction) {
		if (action.actionToPerform == 'edit') this.edit(action.data);
		else if (action.actionToPerform == 'is_approved') this.approve(action.data);
		else if (action.actionToPerform == 'delete') this.delete(action.data);
		else if (action.actionToPerform == 'deleteAll') this.deleteAll(action.data);
	}

	edit(data: IStores) {
		void this.router.navigateByUrl(`/store/edit/${data.id}`);
	}

	approve(_data: IStores) {
		// Mock: approve toggle has no backend yet.
	}

	delete(_data: IStores) {
		// Mock: delete has no backend yet.
	}

	deleteAll(_ids: number[]) {
		// Mock: bulk delete has no backend yet.
	}
}
