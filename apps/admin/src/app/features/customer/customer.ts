import { Component, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService, translateSignal } from '@jsverse/transloco';
import { injectMutation, injectQueryClient } from '@tanstack/angular-query-experimental';
import { Select2, type Select2Data, type Select2UpdateEvent } from 'ng-select2-component';
import { lastValueFrom } from 'rxjs';

import { AdminCustomersGateway, type AdminCustomerListParams } from '@core/admin-customers/admin-customers.gateway';
import { Params } from '@data-access/interfaces/core.interface';
import { IBaseRow, ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { type AdminCustomerListView, injectAdminCustomersQuery } from '@data-access/queries/admin-customers.queries';
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
 * Operators only — separate from `/admin-user/**` operator management (`DEC-ACCOUNT-SEPARATION` D3).
 *
 * The header filter switches to the recycle bin (`DEC-CUSTOMER-SOFT-DELETE-OPS`) for holders of
 * `customer.restore`. One row-action list serves both views: the shared table shows Edit and
 * Delete on live rows and only the `deletedRows` Restore action on deleted ones.
 */
@Component({
	selector: 'app-customer',
	templateUrl: './customer.html',
	styleUrls: ['./customer.scss'],
	imports: [PageWrapper, HasPermissionDirective, RouterModule, Select2, Table, TranslocoModule],
})
export class Customer {
	private readonly router = inject(Router);
	private readonly gateway = inject(AdminCustomersGateway);
	private readonly queryClient = injectQueryClient();
	private readonly notificationService = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);

	private readonly params = signal<AdminCustomerListParams>({ page: 1, pageSize: 30 });
	readonly view = signal<AdminCustomerListView>('live');
	readonly customersQuery = injectAdminCustomersQuery(
		() => this.params(),
		() => this.view(),
	);

	// Signals, not one-off `translate` calls: select2 renders labels as text, so they must follow
	// the dictionary as it loads and as the operator switches language.
	private readonly liveLabel = translateSignal('live_customers');
	private readonly deletedLabel = translateSignal('deleted');
	readonly viewOptions = computed<Select2Data>(() => [
		{ value: 'live', label: this.liveLabel() },
		{ value: 'deleted', label: this.deletedLabel() },
	]);

	private readonly deleteMutation = injectMutation(() => ({
		mutationFn: (customerId: string) => lastValueFrom(this.gateway.softDelete(customerId)),
		onSuccess: () => {
			void this.queryClient.invalidateQueries({ queryKey: ['admin-customers'] });
			this.notificationService.showSuccess(this.transloco.translate('customer_deleted_successfully'));
		},
	}));

	// A refusal (email or phone now held by another customer) is shown by the global error
	// interceptor with the server's own reason, so only success is handled here.
	private readonly restoreMutation = injectMutation(() => ({
		mutationFn: (customerId: string) => lastValueFrom(this.gateway.restore(customerId)),
		onSuccess: () => {
			void this.queryClient.invalidateQueries({ queryKey: ['admin-customers'] });
			this.notificationService.showSuccess(this.transloco.translate('customer_restored'));
		},
	}));

	private readonly baseConfig: ITableConfig<CustomerRow> = {
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
			{
				label: 'Restore',
				actionToPerform: 'restore',
				icon: 'ri-arrow-go-back-line',
				permission: 'customer.restore',
				deletedRows: true,
				confirm: true,
			},
		],
		data: [],
		total: 0,
	};

	readonly tableConfig = signal<ITableConfig<CustomerRow>>(this.baseConfig);

	constructor() {
		effect(() => {
			const response = this.customersQuery.data();
			const data = (response?.items ?? []).map((customer): CustomerRow => ({
				id: customer.id,
				name: customer.displayName || customer.email || customer.id,
				email: customer.email ?? '',
				phone: customer.phone ?? '',
				created_at: customer.createdAt || null,
				status: customer.status,
			}));
			// A signal, not a field write: in this zoneless app a plain field set from an effect does
			// not schedule a render, so a delete (or a restore, or a view switch) left the old rows
			// on screen after the refetch. Same fix as the reviews page.
			this.tableConfig.set({ ...this.baseConfig, data, total: response?.meta.total ?? 0 });
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

	onViewChange(event: Select2UpdateEvent) {
		const next: AdminCustomerListView = event.value === 'deleted' ? 'deleted' : 'live';
		if (next === this.view()) return;
		this.view.set(next);
		// A different population starts on its first page; search and page size carry over.
		this.params.update(({ q, pageSize }) => ({ page: 1, pageSize, ...(q ? { q } : {}) }));
	}

	onActionClicked(action: ITableClickedAction) {
		if (action.actionToPerform === 'edit') this.edit(action.data);
		else if (action.actionToPerform === 'delete') this.remove(action.data);
		else if (action.actionToPerform === 'restore') this.restoreMutation.mutate(String(action.data.id));
	}

	edit(data: CustomerRow) {
		// A deleted customer has no edit screen (the API answers 404); restore comes first.
		if (data.status === 'deleted') return;
		void this.router.navigateByUrl(`/customer/edit/${data.id}`);
	}

	remove(data: CustomerRow) {
		this.deleteMutation.mutate(String(data.id));
	}
}
