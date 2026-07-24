import { Component, effect, inject, input, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { Params } from '@data-access/interfaces/core.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { ITag } from '@data-access/interfaces/tag.interface';
import { injectTagsQuery } from '@data-access/queries/tag.queries';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Table } from '@shared/ui/table/table';

@Component({
	selector: 'app-tag',
	templateUrl: './tag.html',
	styleUrls: ['./tag.scss'],
	imports: [PageWrapper, HasPermissionDirective, RouterModule, Table, TranslocoModule],
})
export class Tag {
	router = inject(Router);

	readonly tagType = input<string | null>('product');

	private readonly params = signal<Params>({});
	readonly tagsQuery = injectTagsQuery(() => ({
		...this.params(),
		type: this.tagType() ?? undefined,
	}));

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
			{ title: 'status', dataField: 'status', type: 'switch' },
		],
		rowActions: [
			{ label: 'Edit', actionToPerform: 'edit', icon: 'ri-pencil-line', permission: 'tag.edit' },
			{
				label: 'Delete',
				actionToPerform: 'delete',
				icon: 'ri-delete-bin-line',
				permission: 'tag.destroy',
			},
		],
		data: [] as ITag[],
		total: 0,
	};

	constructor() {
		// Keep the table fed from the TanStack query result (replaces the old
		// NGXS `tag$` subscription).
		effect(() => {
			const tag = this.tagsQuery.data();
			this.tableConfig.data = tag ? tag.data : [];
			this.tableConfig.total = tag ? tag.total : 0;
		});
	}

	onTableChange(data?: Params) {
		// Updating the params signal auto-refetches the query (params are in its key).
		this.params.set({ ...data });
	}

	onActionClicked(action: ITableClickedAction) {
		if (action.actionToPerform == 'edit') this.edit(action.data);
		else if (action.actionToPerform == 'status') this.status(action.data);
		else if (action.actionToPerform == 'delete') this.delete(action.data);
		else if (action.actionToPerform == 'deleteAll') this.deleteAll(action.data);
	}

	edit(data: ITag) {
		if (this.tagType() == 'post') void this.router.navigateByUrl(`/blog/tag/edit/${data.id}`);
		else void this.router.navigateByUrl(`/tag/edit/${data.id}`);
	}

	status(_data: ITag) {
		// Mock: status toggle has no backend yet (was a no-op NGXS action).
	}

	delete(_data: ITag) {
		// Mock: delete has no backend yet (was a no-op NGXS action).
	}

	deleteAll(_ids: number[]) {
		// Mock: bulk delete has no backend yet (was a no-op NGXS action).
	}
}
