import { Component, effect, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';

import { injectFaqsQuery } from '@data-access/queries/faq.queries';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { Table } from '@shared/ui/table/table';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Params } from '@data-access/interfaces/core.interface';
import { IFaq } from '@data-access/interfaces/faq.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';

@Component({
	selector: 'app-faq',
	templateUrl: './faq.html',
	styleUrls: ['./faq.scss'],
	imports: [PageWrapper, HasPermissionDirective, RouterModule, Table, TranslateModule],
})
export class Faq {
	router = inject(Router);

	private readonly params = signal<Params>({});
	readonly faqsQuery = injectFaqsQuery(() => this.params());

	public tableConfig: ITableConfig = {
		columns: [
			{ title: 'No.', dataField: 'no', type: 'no' },
			{ title: 'title', dataField: 'title', sortable: true, sort_direction: 'desc' },
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
			{ label: 'Edit', actionToPerform: 'edit', icon: 'ri-pencil-line', permission: 'faq.edit' },
			{
				label: 'Delete',
				actionToPerform: 'delete',
				icon: 'ri-delete-bin-line',
				permission: 'faq.destroy',
			},
		],
		data: [] as IFaq[],
		total: 0,
	};

	constructor() {
		effect(() => {
			const faq = this.faqsQuery.data();
			this.tableConfig.data = faq ? faq.data : [];
			this.tableConfig.total = faq ? faq.total : 0;
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

	edit(data: IFaq) {
		void this.router.navigateByUrl(`/faq/edit/${data.id}`);
	}

	status(_data: IFaq) {
		// Mock: status toggle has no backend yet.
	}

	delete(_data: IFaq) {
		// Mock: delete has no backend yet.
	}

	deleteAll(_ids: number[]) {
		// Mock: bulk delete has no backend yet.
	}
}
