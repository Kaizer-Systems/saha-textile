import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { Observable } from 'rxjs';

import { SiteConfigStore } from '@core/state/site-config.store';
import { IBlogModel } from '@data-access/interfaces/blog.interface';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { Params } from '@data-access/interfaces/core.interface';
import { ISiteConfig } from '@data-access/interfaces/site-config.interface';
import { injectBlogsQuery } from '@data-access/queries/blog.queries';
import { BlogService } from '@data-access/services/blog.service';
import { SummaryPipe } from '@shared/pipes/summary.pipe';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { NoData } from '@shared/ui/no-data/no-data';
import { Pagination } from '@shared/ui/pagination/pagination';

import { BlogSidebar } from './sidebar/sidebar';
import { SkeletonBlog } from './skeleton-blog/skeleton-blog';

@Component({
	selector: 'app-blogs',
	templateUrl: './blog.html',
	styleUrls: ['./blog.scss'],
	imports: [
		Breadcrumb,
		SkeletonBlog,
		RouterLink,
		Pagination,
		NoData,
		BlogSidebar,
		AsyncPipe,
		DatePipe,
		SummaryPipe,
		TranslocoModule,
	],
})
export class Blog {
	private route = inject(ActivatedRoute);
	private transloco = inject(TranslocoService);
	private readonly blogsLabel = this.transloco.translate('blogs');
	blogService = inject(BlogService);

	public filter = signal<Params>({
		page: 1, // Current page number
		paginate: 50, // Display per page,
		status: 1,
		category: '',
		tag: '',
	});

	private readonly blogsQuery = injectBlogsQuery(() => this.filter());
	blog$: Observable<IBlogModel | undefined> = toObservable(computed(() => this.blogsQuery.data()));
	siteConfig$: Observable<ISiteConfig> = toObservable(inject(SiteConfigStore).siteConfig) as Observable<ISiteConfig>;

	public breadcrumb: IBreadcrumb = {
		title: this.blogsLabel,
		items: [],
	};

	/** Derived from the query signal; see `CollectionPaginate.totalItems` for why. */
	public readonly totalItems = computed(() => this.blogsQuery.data()?.total ?? 0);
	public skeletonItems = Array.from({ length: 9 }, (_, index) => index);

	public style: string;
	public sidebar: string = 'left_sidebar';

	constructor() {
		// Mirror the query's fetch state onto the shared service flag the template
		// (and skeleton) read, replacing the old getBlogs action's toggling.
		effect(() => (this.blogService.skeletonLoader = this.blogsQuery.isFetching()));

		this.route.queryParams.subscribe((params) => {
			const category = params['category'] ? params['category'] : '';
			const tag = params['tag'] ? params['tag'] : '';
			this.filter.update((f) => ({ ...f, category, tag }));

			this.breadcrumb.items = [];
			this.breadcrumb.title = category
				? `${this.blogsLabel}: ${category.replaceAll('-', ' ')}`
				: tag
					? `${this.blogsLabel}: ${tag.replaceAll('-', ' ')}`
					: this.blogsLabel;
			this.breadcrumb.items.push({ label: this.blogsLabel, active: true });

			// For Demo Purpose only
			if (params['style']) {
				this.style = params['style'];
			}

			if (params['sidebar']) {
				this.sidebar = params['sidebar'];
			}

			if (!params['style'] && !params['sidebar']) {
				// Get Blog Layout
				this.siteConfig$.subscribe((theme) => {
					this.style = theme?.blog?.blog_style;
					this.sidebar = theme?.blog.blog_sidebar_type;
				});
			}
		});
	}

	setPaginate(data: number) {
		this.filter.update((f) => ({ ...f, page: data }));
	}
}
