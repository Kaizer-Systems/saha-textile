import { Component, effect, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { injectMutation, injectQueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { AdminRolesGateway } from '@core/admin-roles/admin-roles.gateway';
import { Params } from '@data-access/interfaces/core.interface';
import { IRole } from '@data-access/interfaces/role.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { injectRolesQuery } from '@data-access/queries/role.queries';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Table } from '@shared/ui/table/table';

@Component({
	selector: 'app-role',
	templateUrl: './role.html',
	styleUrls: ['./role.scss'],
	imports: [PageWrapper, HasPermissionDirective, RouterModule, Table, TranslocoModule],
})
export class Role {
	private readonly router = inject(Router);
	private readonly gateway = inject(AdminRolesGateway);
	private readonly queryClient = injectQueryClient();

	private readonly params = signal<Params>({});
	readonly rolesQuery = injectRolesQuery(() => this.params());

	private readonly deleteMutation = injectMutation(() => ({
		mutationFn: (roleId: string) => lastValueFrom(this.gateway.remove(roleId)),
		onSuccess: () => {
			void this.queryClient.invalidateQueries({ queryKey: ['admin-roles'] });
		},
	}));

	public tableConfig: ITableConfig<IRole> = {
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
			{ label: 'Edit', actionToPerform: 'edit', icon: 'ri-pencil-line', permission: 'role.update' },
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
		if (data.isSystem || data.system_reserve === '1') return;
		void this.router.navigateByUrl(`/role/edit/${data.id}`);
	}

	delete(data: IRole) {
		if (data.isSystem || data.system_reserve === '1') return;
		this.deleteMutation.mutate(String(data.id));
	}

	deleteAll(ids: Array<string | number>) {
		for (const id of ids ?? []) {
			const row = this.tableConfig.data?.find((role) => role.id === id);
			if (row?.isSystem || row?.system_reserve === '1') continue;
			this.deleteMutation.mutate(String(id));
		}
	}
}
