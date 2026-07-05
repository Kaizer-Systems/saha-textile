import { Component, effect, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';

import { injectTaxesQuery } from '@data-access/queries/tax.queries';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { Table } from '@shared/ui/table/table';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Params } from '@data-access/interfaces/core.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { ITax } from '@data-access/interfaces/tax.interface';

@Component({
	selector: 'app-tax',
	templateUrl: './tax.html',
	styleUrls: ['./tax.scss'],
	imports: [PageWrapper, HasPermissionDirective, RouterModule, Table, TranslateModule],
})
export class Tax {
	router = inject(Router);

	private readonly params = signal<Params>({});
	readonly taxesQuery = injectTaxesQuery(() => this.params());

	public tableConfig: ITableConfig = {
		columns: [
			{ title: 'No.', dataField: 'no', type: 'no' },
			{ title: 'name', dataField: 'name', sortable: true, sort_direction: 'desc' },
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
			{ label: 'Edit', actionToPerform: 'edit', icon: 'ri-pencil-line', permission: 'tax.edit' },
			{
				label: 'Delete',
				actionToPerform: 'delete',
				icon: 'ri-delete-bin-line',
				permission: 'tax.destroy',
			},
		],
		data: [] as ITax[],
		total: 0,
	};

	constructor() {
		effect(() => {
			const tax = this.taxesQuery.data();
			this.tableConfig.data = tax ? tax.data : [];
			this.tableConfig.total = tax ? tax.total : 0;
		});
	}

	onTableChange(data?: Params) {
		this.params.set({ ...data });
	}

	onActionClicked(action: ITableClickedAction) {
		if (action.actionToPerform == 'edit') this.edit(action.data);
		else if (action.actionToPerform == 'status') this.status(action.data);
		else if (action.actionToPerform == 'delete') this.delete(action.data);
		else if (action.actionToPerform == 'deleteAll') this.deleteAll(action.data);
	}

	edit(data: ITax) {
		void this.router.navigateByUrl(`/tax/edit/${data.id}`);
	}

	status(_data: ITax) {
		// Mock: status toggle has no backend yet.
	}

	delete(_data: ITax) {
		// Mock: delete has no backend yet.
	}

	deleteAll(_ids: number[]) {
		// Mock: bulk delete has no backend yet.
	}
}
