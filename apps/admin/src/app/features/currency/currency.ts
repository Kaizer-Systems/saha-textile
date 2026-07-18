import { Component, effect, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { Params } from '@data-access/interfaces/core.interface';
import { ICurrency } from '@data-access/interfaces/currency.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { injectCurrenciesQuery } from '@data-access/queries/currency.queries';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Table } from '@shared/ui/table/table';

@Component({
	selector: 'app-currency',
	templateUrl: './currency.html',
	styleUrls: ['./currency.scss'],
	imports: [PageWrapper, HasPermissionDirective, RouterModule, Table, TranslocoModule],
})
export class Currency {
	router = inject(Router);

	private readonly params = signal<Params>({});
	readonly currenciesQuery = injectCurrenciesQuery(() => this.params());

	public tableConfig: ITableConfig = {
		columns: [
			{ title: 'No.', dataField: 'no', type: 'no' },
			{ title: 'code', dataField: 'code', sortable: true, sort_direction: 'desc' },
			{ title: 'symbol', dataField: 'symbol' },
			{ title: 'exchange_rate', dataField: 'exchange_rate' },
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
			{
				label: 'Edit',
				actionToPerform: 'edit',
				icon: 'ri-pencil-line',
				permission: 'currency.edit',
			},
			{
				label: 'Delete',
				actionToPerform: 'delete',
				icon: 'ri-delete-bin-line',
				permission: 'currency.destroy',
			},
		],
		data: [] as ICurrency[],
		total: 0,
	};

	constructor() {
		effect(() => {
			const currency = this.currenciesQuery.data();
			this.tableConfig.data = currency ? currency.data : [];
			this.tableConfig.total = currency ? currency.total : 0;
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

	edit(data: ICurrency) {
		void this.router.navigateByUrl(`/currency/edit/${data.id}`);
	}

	status(_data: ICurrency) {
		// Mock: status toggle has no backend yet.
	}

	delete(_data: ICurrency) {
		// Mock: delete has no backend yet.
	}

	deleteAll(_ids: number[]) {
		// Mock: bulk delete has no backend yet.
	}
}
