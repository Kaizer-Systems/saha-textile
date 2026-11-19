import { Component, effect, inject, signal, viewChild } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { type Observable, catchError, concatMap, from, map, of, toArray } from 'rxjs';

import { BLOG_GO_LIVE_WORDS, goLiveLabels, goLiveToast } from '@core/catalog/go-live-report';
import { injectMissingLanguage } from '@core/i18n/missing-language';
import { IBlog } from '@data-access/interfaces/blog.interface';
import { Params } from '@data-access/interfaces/core.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { injectBlogsQuery } from '@data-access/queries/blog.queries';
import { BlogService } from '@data-access/services/blog.service';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { MissingLanguageNotice } from '@shared/ui/missing-language-notice/missing-language-notice';
import { Table } from '@shared/ui/table/table';

import type { GoLiveResult } from '@saha-textile/contracts';

@Component({
	selector: 'app-blog',
	templateUrl: './blog.html',
	styleUrls: ['./blog.scss'],
	imports: [MissingLanguageNotice, PageWrapper, HasPermissionDirective, RouterModule, Table, TranslocoModule],
})
export class Blog {
	router = inject(Router);
	private blogs = inject(BlogService);
	private notifier = inject(NotificationService);
	private transloco = inject(TranslocoService);
	private queryClient = inject(QueryClient);

	private readonly params = signal<Params>({});
	/** Opened from Settings › Languages: only items still missing one language's text. */
	readonly missing = injectMissingLanguage('blog_posts');
	readonly blogsQuery = injectBlogsQuery(() => ({ ...this.params(), missing: this.missing.code() }));
	private readonly table = viewChild(Table);

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
			{ label: 'edit', actionToPerform: 'edit', icon: 'ri-pencil-line', permission: 'blog.edit' },
			{ label: 'go_live', actionToPerform: 'go_live', icon: 'ri-rocket-line', permission: 'blog.edit' },
			{
				label: 'delete',
				actionToPerform: 'delete',
				icon: 'ri-delete-bin-line',
				permission: 'blog.destroy',
			},
		],
		bulkActions: [
			{ label: 'go_live', actionToPerform: 'bulk_go_live', icon: 'ri-rocket-line', permission: 'blog.edit' },
			{
				label: 'take_off_shop',
				actionToPerform: 'bulk_take_down',
				icon: 'ri-eye-off-line',
				permission: 'blog.edit',
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
		else if (action.actionToPerform == 'bulk_go_live') this.bulkGoLive(action.data);
		else if (action.actionToPerform == 'bulk_take_down') this.bulkTakeDown(action.data);
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

	/**
	 * Go Live for every ticked post, one after another, through the same check as the form. Live posts
	 * are left as they are. One note counts the posts now live; each post that cannot go live gets
	 * its own note naming what it lacks.
	 */
	bulkGoLive(ids: (string | number)[]) {
		const rows = this.ticked(ids);
		from(rows)
			.pipe(
				concatMap((row) =>
					row.status === '1'
						? of({ row, result: { live: true, gaps: [] } as GoLiveResult })
						: this.blogs.goLive(row.id).pipe(
								map((result) => ({ row, result })),
								catchError(() => of({ row, result: null })),
							),
				),
				toArray(),
			)
			.subscribe((outcomes) => {
				const translate = (key: string) => this.transloco.translate(key);
				const live = outcomes.filter((outcome) => outcome.result?.live).length;
				if (live) this.notifier.showSuccess(this.transloco.translate('blog_bulk_live', { count: live }));
				for (const { row, result } of outcomes) {
					if (result?.live) continue;
					const reason = result
						? goLiveLabels(result.gaps, translate, BLOG_GO_LIVE_WORDS).join(', ')
						: translate('blog_rejected');
					this.notifier.showError(`${row.title}: ${reason}`);
				}
				this.finishBulk();
			});
	}

	/** Takes every ticked live post off the shop; drafts are left as they are. */
	bulkTakeDown(ids: (string | number)[]) {
		const live = this.ticked(ids).filter((row) => row.status === '1');
		from(live)
			.pipe(
				concatMap((row) =>
					this.blogs.setStatus(row.id, 'draft').pipe(
						map(() => true),
						catchError(() => of(false)),
					),
				),
				toArray(),
			)
			.subscribe((done) => {
				const count = done.filter(Boolean).length;
				if (count) this.notifier.showSuccess(this.transloco.translate('blog_bulk_taken_down', { count }));
				if (count < done.length) this.notifier.showError(this.transloco.translate('blog_rejected'));
				this.finishBulk();
			});
	}

	/** The ticked rows on any page, as last seen (the page's own rows first), in the order given. */
	private ticked(ids: (string | number)[]): IBlog[] {
		const rows = new Map(
			[...(this.table()?.pickedRows<IBlog>() ?? []), ...(this.tableConfig().data ?? [])].map((row) => [
				String(row.id),
				row,
			]),
		);
		return (ids ?? []).map((id) => rows.get(String(id))).filter((row): row is IBlog => !!row);
	}

	private finishBulk() {
		this.table()?.clearPicks();
		this.refresh();
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
