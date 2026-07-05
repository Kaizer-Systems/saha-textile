import { Component, effect, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';

import { injectAttributesQuery } from '@data-access/queries/attribute.queries';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { Table } from '@shared/ui/table/table';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { IAttribute } from '@data-access/interfaces/attribute.interface';
import { Params } from '@data-access/interfaces/core.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';

@Component({
	selector: 'app-attribute',
	templateUrl: './attribute.html',
	styleUrls: ['./attribute.scss'],
	imports: [PageWrapper, HasPermissionDirective, RouterModule, Table, TranslateModule],
})
export class Attribute {
	router = inject(Router);

	private readonly params = signal<Params>({});
	readonly attributesQuery = injectAttributesQuery(() => this.params());

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
		],
		rowActions: [
			{
				label: 'Edit',
				actionToPerform: 'edit',
				icon: 'ri-pencil-line',
				permission: 'attribute.edit',
			},
			{
				label: 'Delete',
				actionToPerform: 'delete',
				icon: 'ri-delete-bin-line',
				permission: 'attribute.destroy',
			},
		],
		data: [] as IAttribute[],
		total: 0,
	};

	constructor() {
		effect(() => {
			const attribute = this.attributesQuery.data();
			this.tableConfig.data = attribute ? attribute.data : [];
			this.tableConfig.total = attribute ? attribute.total : 0;
		});
	}

	onTableChange(data?: Params) {
		this.params.set({ ...data });
	}

	onActionClicked(action: ITableClickedAction) {
		if (action.actionToPerform == 'edit') this.edit(action.data);
		else if (action.actionToPerform == 'delete') this.delete(action.data);
		else if (action.actionToPerform == 'deleteAll') this.deleteAll(action.data);
	}

	edit(data: IAttribute) {
		void this.router.navigateByUrl(`/attribute/edit/${data.id}`);
	}

	delete(_data: IAttribute) {
		// Mock: delete has no backend yet.
	}

	deleteAll(_ids: number[]) {
		// Mock: bulk delete has no backend yet.
	}
}
