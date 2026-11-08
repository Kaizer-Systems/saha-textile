import { Component, effect, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { BLOG_GO_LIVE_WORDS, goLiveToast } from '@core/catalog/go-live-report';
import { IBlog } from '@data-access/interfaces/blog.interface';
import { Params } from '@data-access/interfaces/core.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { injectBlogsQuery } from '@data-access/queries/blog.queries';
import { BlogService } from '@data-access/services/blog.service';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Table } from '@shared/ui/table/table';

import type { GoLiveResult } from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

@Component({
	selector: 'app-blog',
	templateUrl: './blog.html',
	styleUrls: ['./blog.scss'],
	imports: [PageWrapper, HasPermissionDirective, RouterModule, Table, TranslocoModule],
})
export class Blog {
	router = inject(Router);
	private blogs = inject(BlogService);
	private notifier = inject(NotificationService);
	private transloco = inject(TranslocoService);
	private queryClient = inject(QueryClient);

	private readonly params = signal<Params>({});
	readonly blogsQuery = injectBlogsQuery(() => this.params());

	/** A signal, so the table redraws when an answer arrives after it was first drawn. */
	readonly tableConfig = signal<ITableConfig<IBlog>>({
		columns: [
			{ title: 'No.', dataField: 'no', type: 'no' },
			{
				title: 'image',
				dataField: 'blog_thumbnail',
				class: 'tbl-image',
				type: 'image',
				placeholder: 'assets/images/product.png',
			},
			{ title: 'title', dataField: 'title', sortable: true, sort_direction: 'desc' },
			{ title: 'publish_date', dataField: 'published_at', type: 'date', date_format: 'dd MMM yyyy' },
			{ title: 'status', dataField: 'status', type: 'switch' },
		],
		rowActions: [
			{ label: 'Edit', actionToPerform: 'edit', icon: 'ri-pencil-line', permission: 'blog.edit' },
			{ label: 'Go Live', actionToPerform: 'go_live', icon: 'ri-rocket-line', permission: 'blog.edit' },
			{
				label: 'Delete',
				actionToPerform: 'delete',
				icon: 'ri-delete-bin-line',
				permission: 'blog.destroy',
			},
		],
		data: [],
		total: 0,
	});

	constructor() {
		effect(() => {
			const blog = this.blogsQuery.data();
			this.tableConfig.update((config) => ({
				...config,
				data: blog ? blog.data : [],
				total: blog ? blog.total : 0,
			}));
		});
	}

	onTableChange(data?: Params) {
		this.params.set({ ...data });
	}

	onActionClicked(action: ITableClickedAction) {
		if (action.actionToPerform == 'edit') this.edit(action.data);
		else if (action.actionToPerform == 'go_live') this.goLive(action.data);
		else if (action.actionToPerform == 'status') this.status(action.data);
		else if (action.actionToPerform == 'delete') this.delete(action.data);
		else if (action.actionToPerform == 'deleteAll') this.deleteAll(action.data);
	}

	edit(data: IBlog) {
		void this.router.navigateByUrl(`/blog/edit/${data.id}`);
	}

	/** The same call and the same toast as the post form. */
	goLive(data: IBlog) {
		this.report(this.blogs.goLive(data.id));
	}

	/** The switch: on is Go Live (refused with the gaps when a language is missing), off takes the post down. */
	status(data: Omit<IBlog, 'status'> & { status: number | string }) {
		if (Number(data.status) === 1) this.report(this.blogs.setStatus(data.id, 'live'));
		else
			this.blogs.setStatus(data.id, 'draft').subscribe({
				next: () => {
					this.notifier.showSuccess(this.transloco.translate('blog_taken_down'));
					this.refresh();
				},
				error: () => this.refresh(),
			});
	}

	delete(data: IBlog) {
		this.blogs.deletePost(data.id).subscribe({
			next: () => {
				this.notifier.showSuccess(this.transloco.translate('blog_deleted'));
				this.refresh();
			},
			error: () => this.notifier.showError(this.transloco.translate('blog_rejected')),
		});
	}

	deleteAll(ids: string[]) {
		for (const id of ids ?? []) this.blogs.deletePost(String(id)).subscribe({ next: () => this.refresh() });
	}

	private report(call: Observable<GoLiveResult>) {
		call.subscribe((result) => {
			goLiveToast(result, this.notifier, (key) => this.transloco.translate(key), BLOG_GO_LIVE_WORDS);
			this.refresh();
		});
	}

	private refresh() {
		void this.queryClient.invalidateQueries({ queryKey: ['blogs'] });
	}
}
