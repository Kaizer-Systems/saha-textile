import { Component, effect, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectMutation, injectQueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { AdminCustomersGateway, type AdminCustomerListParams } from '@core/admin-customers/admin-customers.gateway';
import { Params } from '@data-access/interfaces/core.interface';
import { IBaseRow, ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { injectAdminCustomersQuery } from '@data-access/queries/admin-customers.queries';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Table } from '@shared/ui/table/table';

interface CustomerRow extends IBaseRow {
	id: string;
	name: string;
	email: string;
	phone: string;
	created_at: string | null;
	status: string;
}

/**
 * Storefront customer CRM list (live API).
 *
 * Operators only — separate from `/user/**` operator management (`DEC-ACCOUNT-SEPARATION` D3).
 */
@Component({
	selector: 'app-customer',
	templateUrl: './customer.html',
	styleUrls: ['./customer.scss'],
	imports: [PageWrapper, HasPermissionDirective, RouterModule, Table, TranslocoModule],
})
export class Customer {
	private readonly router = inject(Router);
	private readonly gateway = inject(AdminCustomersGateway);
	private readonly queryClient = injectQueryClient();
	private readonly notificationService = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);

	private readonly params = signal<AdminCustomerListParams>({ page: 1, pageSize: 30 });
	readonly customersQuery = injectAdminCustomersQuery(() => this.params());

	private readonly deleteMutation = injectMutation(() => ({
		mutationFn: (customerId: string) => lastValueFrom(this.gateway.softDelete(customerId)),
		onSuccess: () => {
			void this.queryClient.invalidateQueries({ queryKey: ['admin-customers'] });
			this.notificationService.showSuccess(this.transloco.translate('customer_deleted_successfully'));
		},
	}));

	public tableConfig: ITableConfig<CustomerRow> = {
		columns: [
			{ title: 'name', dataField: 'name', sortable: true, sort_direction: 'desc' },
			{ title: 'email', dataField: 'email' },
			{ title: 'phone', dataField: 'phone' },
			{
				title: 'created_at',
				dataField: 'created_at',
				type: 'date',
				sortable: true,
				sort_direction: 'desc',
			},
			{ title: 'status', dataField: 'status' },
		],
		rowActions: [
			{ label: 'Edit', actionToPerform: 'edit', icon: 'ri-pencil-line', permission: 'customer.update' },
			{
				label: 'Delete',
				actionToPerform: 'delete',
				icon: 'ri-delete-bin-line',
				permission: 'customer.destroy',
			},
		],
		data: [],
		total: 0,
	};

	constructor() {
		effect(() => {
			const response = this.customersQuery.data();
			if (!response) {
				this.tableConfig.data = [];
				this.tableConfig.total = 0;
				return;
			}

			this.tableConfig.data = response.items.map((customer) => ({
				id: customer.id,
				name: customer.displayName || customer.email || customer.id,
				email: customer.email ?? '',
				phone: customer.phone ?? '',
				created_at: customer.createdAt || null,
				status: customer.status,
			}));
			this.tableConfig.total = response.meta.total;
		});
	}

	onTableChange(data?: Params) {
		const next: AdminCustomerListParams = {};
		if (data?.['page'] !== undefined) next.page = Number(data['page']);
		if (data?.['paginate'] !== undefined) next.pageSize = Number(data['paginate']);
		if (typeof data?.['search'] === 'string' && data['search'].trim()) {
			next.q = data['search'].trim();
		}
		this.params.set(next);
	}

	onActionClicked(action: ITableClickedAction) {
		if (action.actionToPerform === 'edit') this.edit(action.data);
		else if (action.actionToPerform === 'delete') this.remove(action.data);
	}

	edit(data: CustomerRow) {
		void this.router.navigateByUrl(`/customer/edit/${data.id}`);
	}

	remove(data: CustomerRow) {
		this.deleteMutation.mutate(String(data.id));
	}
}
