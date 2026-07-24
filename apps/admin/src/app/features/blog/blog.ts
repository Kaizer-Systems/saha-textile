import { Component, effect, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { IBlog } from '@data-access/interfaces/blog.interface';
import { Params } from '@data-access/interfaces/core.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { injectBlogsQuery } from '@data-access/queries/blog.queries';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Table } from '@shared/ui/table/table';

@Component({
	selector: 'app-blog',
	templateUrl: './blog.html',
	styleUrls: ['./blog.scss'],
	imports: [PageWrapper, HasPermissionDirective, RouterModule, Table, TranslocoModule],
})
export class Blog {
	router = inject(Router);

	private readonly params = signal<Params>({});
	readonly blogsQuery = injectBlogsQuery(() => this.params());

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
			{ label: 'Edit', actionToPerform: 'edit', icon: 'ri-pencil-line', permission: 'blog.edit' },
			{
				label: 'Delete',
				actionToPerform: 'delete',
				icon: 'ri-delete-bin-line',
				permission: 'blog.destroy',
			},
		],
		data: [] as IBlog[],
		total: 0,
	};

	constructor() {
		effect(() => {
			const blog = this.blogsQuery.data();
			this.tableConfig.data = blog ? blog.data : [];
			this.tableConfig.total = blog ? blog.total : 0;
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

	edit(data: IBlog) {
		void this.router.navigateByUrl(`/blog/edit/${data.id}`);
	}

	status(_data: IBlog) {
		// Mock: status toggle has no backend yet.
	}

	delete(_data: IBlog) {
		// Mock: delete has no backend yet.
	}

	deleteAll(_ids: number[]) {
		// Mock: bulk delete has no backend yet.
	}
}
