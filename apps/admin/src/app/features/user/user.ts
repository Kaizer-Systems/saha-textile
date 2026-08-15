import { Component, effect, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { injectMutation, injectQueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { AdminUsersGateway } from '@core/admin-users/admin-users.gateway';
import { Params } from '@data-access/interfaces/core.interface';
import { IBaseRow, ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { injectAdminUsersQuery } from '@data-access/queries/admin-users.queries';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Table } from '@shared/ui/table/table';

interface AdminUserRow extends IBaseRow {
	id: string;
	name: string;
	email: string;
	role_name: string;
	created_at: string | null;
	status: string;
}

/**
 * Back-office operator user-management list (live API).
 *
 * Administers operators only: staff and admin roles via invite provisioning. Customers belong
 * on the future `/admin/customers/**` surface (`DEC-ACCOUNT-SEPARATION` D3).
 */
@Component({
	selector: 'app-user',
	templateUrl: './user.html',
	styleUrls: ['./user.scss'],
	imports: [PageWrapper, HasPermissionDirective, RouterModule, Table, TranslocoModule],
})
export class AdminUsers {
	private readonly router = inject(Router);
	private readonly gateway = inject(AdminUsersGateway);
	private readonly queryClient = injectQueryClient();

	private readonly params = signal<Params>({});
	readonly usersQuery = injectAdminUsersQuery(() => this.params());

	private readonly statusMutation = injectMutation(() => ({
		mutationFn: (vars: { userId: string; status: 'active' | 'disabled' }) =>
			lastValueFrom(this.gateway.setStatus(vars.userId, { status: vars.status })),
		onSuccess: () => {
			void this.queryClient.invalidateQueries({ queryKey: ['admin-users'] });
		},
	}));

	public tableConfig: ITableConfig<AdminUserRow> = {
		columns: [
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
			{ label: 'Edit', actionToPerform: 'edit', icon: 'ri-pencil-line', permission: 'admin_user.update' },
		],
		data: [],
		total: 0,
	};

	constructor() {
		effect(() => {
			const response = this.usersQuery.data();
			if (!response) {
				this.tableConfig.data = [];
				this.tableConfig.total = 0;
				return;
			}

			this.tableConfig.data = response.items.map((user) => ({
				id: user.id,
				name: user.displayName || user.username || user.email || user.id,
				email: user.email ?? '',
				role_name: user.role,
				created_at: user.createdAt || null,
				status: user.status === 'active' ? '1' : '0',
			}));
			this.tableConfig.total = response.meta.total;
		});
	}

	onTableChange(data?: Params) {
		this.params.set({ ...data });
	}

	onActionClicked(action: ITableClickedAction) {
		if (action.actionToPerform === 'edit') this.edit(action.data);
		else if (action.actionToPerform === 'status') this.status(action.data);
	}

	edit(data: AdminUserRow) {
		void this.router.navigateByUrl(`/admin-user/edit/${data.id}`);
	}

	status(data: AdminUserRow) {
		const newStatus: 'active' | 'disabled' = data.status === '1' ? 'disabled' : 'active';
		this.statusMutation.mutate({ userId: String(data.id), status: newStatus });
	}
}
