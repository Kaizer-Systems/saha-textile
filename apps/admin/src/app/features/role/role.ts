import { Component, effect, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';

import { injectRolesQuery } from '@data-access/queries/role.queries';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { Table } from '@shared/ui/table/table';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Params } from '@data-access/interfaces/core.interface';
import { IRole } from '@data-access/interfaces/role.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';

@Component({
	selector: 'app-role',
	templateUrl: './role.html',
	styleUrls: ['./role.scss'],
	imports: [PageWrapper, HasPermissionDirective, RouterModule, Table, TranslateModule],
})
export class Role {
	private router = inject(Router);

	private readonly params = signal<Params>({});
	readonly rolesQuery = injectRolesQuery(() => this.params());

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
			{ label: 'Edit', actionToPerform: 'edit', icon: 'ri-pencil-line', permission: 'role.edit' },
			{
				label: 'Delete',
				actionToPerform: 'delete',
				icon: 'ri-delete-bin-line',
				permission: 'role.destroy',
			},
		],
		data: [] as IRole[],
		total: 0,
	};

	constructor() {
		effect(() => {
			const role = this.rolesQuery.data();
			this.tableConfig.data = role ? role.data : [];
			this.tableConfig.total = role ? role.total : 0;
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

	edit(data: IRole) {
		void this.router.navigateByUrl(`/role/edit/${data.id}`);
	}

	delete(_data: IRole) {
		// Mock: delete has no backend yet.
	}

	deleteAll(_ids: number[]) {
		// Mock: bulk delete has no backend yet.
	}
}
