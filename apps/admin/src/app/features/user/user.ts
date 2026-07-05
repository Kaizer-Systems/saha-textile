import { Component, effect, inject, signal, viewChild } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';

import { injectUsersQuery } from '@data-access/queries/user.queries';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { ImportCsvModal } from '@shared/ui/modal/import-csv-modal/import-csv-modal';
import { Table } from '@shared/ui/table/table';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Params } from '@data-access/interfaces/core.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { IUser } from '@data-access/interfaces/user.interface';

@Component({
	selector: 'app-user',
	templateUrl: './user.html',
	styleUrls: ['./user.scss'],
	imports: [PageWrapper, HasPermissionDirective, RouterModule, Table, ImportCsvModal, TranslateModule],
})
export class User {
	router = inject(Router);

	private readonly params = signal<Params>({});
	readonly usersQuery = injectUsersQuery(() => this.params());

	readonly CSVModal = viewChild<ImportCsvModal>('csvModal');

	public tableConfig: ITableConfig = {
		columns: [
			{
				title: 'avatar',
				dataField: 'profile_image',
				class: 'tbl-image rounded-circle',
				type: 'image',
			},
			{ title: 'name', dataField: 'name', sortable: true, sort_direction: 'desc' },
			{ title: 'email', dataField: 'email' },
			{ title: 'role', dataField: 'role_name' },
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
			{ label: 'Edit', actionToPerform: 'edit', icon: 'ri-pencil-line', permission: 'user.edit' },
			{
				label: 'Delete',
				actionToPerform: 'delete',
				icon: 'ri-delete-bin-line',
				permission: 'user.destroy',
			},
		],
		data: [] as IUser[],
		total: 0,
	};

	constructor() {
		effect(() => {
			const user = this.usersQuery.data();
			const users = user?.data?.filter((element) => {
				element.role_name = element?.role?.name!;
				return element;
			});
			this.tableConfig.data = user ? users : [];
			this.tableConfig.total = user ? user.total : 0;
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

	edit(data: IUser) {
		void this.router.navigateByUrl(`/user/edit/${data.id}`);
	}

	status(_data: IUser) {
		// Mock: status toggle has no backend yet.
	}

	delete(_data: IUser) {
		// Mock: delete has no backend yet.
	}

	deleteAll(_ids: number[]) {
		// Mock: bulk delete has no backend yet.
	}

	export() {
		// Mock: export has no backend yet.
	}
}
