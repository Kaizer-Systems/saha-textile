import { Component, effect, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';

import { injectCouponsQuery } from '@data-access/queries/coupon.queries';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { Table } from '@shared/ui/table/table';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Params } from '@data-access/interfaces/core.interface';
import { ICoupon } from '@data-access/interfaces/coupon.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';

@Component({
	selector: 'app-coupon',
	templateUrl: './coupon.html',
	styleUrls: ['./coupon.scss'],
	imports: [PageWrapper, HasPermissionDirective, RouterModule, Table, TranslateModule],
})
export class Coupon {
	router = inject(Router);

	private readonly params = signal<Params>({});
	readonly couponsQuery = injectCouponsQuery(() => this.params());

	public tableConfig: ITableConfig = {
		columns: [
			{ title: 'No.', dataField: 'no', type: 'no' },
			{ title: 'code', dataField: 'code', sortable: true, sort_direction: 'desc' },
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
			{ label: 'Edit', actionToPerform: 'edit', icon: 'ri-pencil-line', permission: 'coupon.edit' },
			{
				label: 'Delete',
				actionToPerform: 'delete',
				icon: 'ri-delete-bin-line',
				permission: 'coupon.destroy',
			},
		],
		data: [] as ICoupon[],
		total: 0,
	};

	constructor() {
		effect(() => {
			const coupon = this.couponsQuery.data();
			this.tableConfig.data = coupon ? coupon.data : [];
			this.tableConfig.total = coupon ? coupon.total : 0;
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

	edit(data: ICoupon) {
		void this.router.navigateByUrl(`/coupon/edit/${data.id}`);
	}

	status(_data: ICoupon) {
		// Mock: status toggle has no backend yet.
	}

	delete(_data: ICoupon) {
		// Mock: delete has no backend yet.
	}

	deleteAll(_ids: number[]) {
		// Mock: bulk delete has no backend yet.
	}
}
