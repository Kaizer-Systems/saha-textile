import { Component, effect, inject, input, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { BLOG_GO_LIVE_WORDS, gapsFromError, goLiveToast } from '@core/catalog/go-live-report';
import { Params } from '@data-access/interfaces/core.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { ITag } from '@data-access/interfaces/tag.interface';
import { injectTagsQuery } from '@data-access/queries/tag.queries';
import { BlogService } from '@data-access/services/blog.service';
import { NotificationService } from '@data-access/services/notification.service';
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
	private blogs = inject(BlogService);
	private queryClient = inject(QueryClient);
	private notifier = inject(NotificationService);
	private transloco = inject(TranslocoService);

	readonly tagType = input<string | null>('product');

	private readonly params = signal<Params>({});
	readonly tagsQuery = injectTagsQuery(() => ({
		...this.params(),
		type: this.tagType() ?? undefined,
	}));

	/** A signal, so the table redraws when an answer arrives after it was first drawn. */
	readonly tableConfig = signal<ITableConfig<ITag>>({
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
			{ label: 'edit', actionToPerform: 'edit', icon: 'ri-pencil-line', permission: 'tag.edit' },
			{
				label: 'delete',
				actionToPerform: 'delete',
				icon: 'ri-delete-bin-line',
				permission: 'tag.destroy',
			},
		],
		data: [],
		total: 0,
	});

	constructor() {
		// Keep the table fed from the TanStack query result (replaces the old
		// NGXS `tag$` subscription).
		effect(() => {
			const tag = this.tagsQuery.data();
			this.tableConfig.update((config) => ({ ...config, data: tag ? tag.data : [], total: tag ? tag.total : 0 }));
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

	/** A blog tag's switch: live needs a name in every language. Theme tags have no backend yet. */
	status(data: Omit<ITag, 'status'> & { status: boolean | number | string }) {
		const tag = data.blog;
		if (this.tagType() !== 'post' || !tag) return;
		const body = {
			name: tag.name,
			description: tag.description,
			slug: tag.slug,
			status: Number(data.status) === 1 ? ('live' as const) : ('draft' as const),
		};
		this.blogs.saveTerm('tags', tag.id, body).subscribe({
			next: () => this.refresh(),
			error: (error: unknown) => {
				goLiveToast(
					{ live: false, gaps: gapsFromError(error) },
					this.notifier,
					(key) => this.transloco.translate(key),
					BLOG_GO_LIVE_WORDS,
				);
				this.refresh();
			},
		});
	}

	delete(data: ITag) {
		if (this.tagType() !== 'post' || !data.blog) return;
		this.blogs.deleteTerm('tags', data.blog.id).subscribe({ next: () => this.refresh() });
	}

	deleteAll(ids: (number | string)[]) {
		if (this.tagType() !== 'post') return;
		for (const id of ids ?? []) this.blogs.deleteTerm('tags', String(id)).subscribe({ next: () => this.refresh() });
	}

	private refresh() {
		void this.queryClient.invalidateQueries({ queryKey: ['tags'] });
	}
}
