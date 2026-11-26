import { AsyncPipe } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { Observable } from 'rxjs';

import { LocaleSeo } from '@core/i18n/locale-seo';
import { SiteConfigStore } from '@core/state/site-config.store';
import { IBlogModel } from '@data-access/interfaces/blog.interface';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { Params } from '@data-access/interfaces/core.interface';
import { ISiteConfig } from '@data-access/interfaces/site-config.interface';
import { injectBlogTermsQuery, injectBlogsQuery } from '@data-access/queries/blog.queries';
import { BlogService } from '@data-access/services/blog.service';
import { ShopDatePipe } from '@shared/pipes/shop-date.pipe';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { NoData } from '@shared/ui/no-data/no-data';
import { Pagination } from '@shared/ui/pagination/pagination';

import { BlogSidebar } from './sidebar/sidebar';
import { SkeletonBlog } from './skeleton-blog/skeleton-blog';

const PAGE_SIZE = 10;

/**
 * The blog list: the theme's "Blog list" layout with the left sidebar (owner log § blog). The grid
 * layouts were removed with their menu links, so the layout is fixed rather than read from the
 * address or the theme file.
 */
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
		ShopDatePipe,
		TranslocoModule,
	],
})
export class Blog {
	private route = inject(ActivatedRoute);
	private transloco = inject(TranslocoService);
	private seo = inject(LocaleSeo);
	private readonly blogsLabel = this.transloco.translate('blogs');
	blogService = inject(BlogService);

	public filter = signal<Params>({
		page: 1,
		paginate: PAGE_SIZE,
		category: '',
		tag: '',
	});

	private readonly blogsQuery = injectBlogsQuery(() => this.filter());
	private readonly categoriesQuery = injectBlogTermsQuery('categories');
	private readonly tagsQuery = injectBlogTermsQuery('tags');
	blog$: Observable<IBlogModel | undefined> = toObservable(computed(() => this.blogsQuery.data()));
	siteConfig$: Observable<ISiteConfig> = toObservable(inject(SiteConfigStore).siteConfig) as Observable<ISiteConfig>;

	/** The category or tag being listed, by its name in the page language. */
	private readonly scope = computed(() => {
		const { category, tag } = this.filter();
		const find = (rows: { slug: string; name: string }[] | undefined, slug: unknown) =>
			typeof slug === 'string' && slug
				? (rows?.find((row) => row.slug === slug)?.name ?? slug.replaceAll('-', ' '))
				: '';
		return find(this.categoriesQuery.data(), category) || find(this.tagsQuery.data(), tag);
	});

	readonly breadcrumb = computed<IBreadcrumb>(() => ({
		title: this.scope() ? `${this.blogsLabel}: ${this.scope()}` : this.blogsLabel,
		items: [{ label: this.blogsLabel, active: true }],
		// The list has no visible heading of its own, so the breadcrumb writes a hidden h1.
		hiddenHeading: true,
	}));

	public readonly totalItems = computed(() => this.blogsQuery.data()?.total ?? 0);
	public skeletonItems = Array.from({ length: 4 }, (_, index) => index);

	/** The owner's layout: list view, left sidebar. */
	public readonly style = 'list_view';
	public readonly sidebar = 'left_sidebar';

	constructor() {
		effect(() => (this.blogService.skeletonLoader = this.blogsQuery.isFetching()));

		this.route.queryParams.subscribe((params) => {
			const category = typeof params['category'] === 'string' ? params['category'] : '';
			const tag = typeof params['tag'] === 'string' ? params['tag'] : '';
			this.filter.update((current) => ({ ...current, page: 1, category, tag }));
		});

		effect(() => {
			const scope = this.scope();
			const title = scope ? `${scope} | ${this.blogsLabel}` : this.blogsLabel;
			this.seo.applyDocument({
				title: `${title} | Saha Textile`,
				description: this.transloco.translate('blog_list_description'),
			});
		});

		this.seo.applyJsonLd('blog-crumbs', {
			'@context': 'https://schema.org',
			'@type': 'BreadcrumbList',
			itemListElement: [
				{
					'@type': 'ListItem',
					position: 1,
					name: this.transloco.translate('home'),
					item: this.seo.absoluteUrl('/'),
				},
				{ '@type': 'ListItem', position: 2, name: this.blogsLabel, item: this.seo.absoluteUrl('/blogs') },
			],
		});
		inject(DestroyRef).onDestroy(() => this.seo.removeJsonLd('blog-crumbs'));
	}

	setPaginate(data: number) {
		this.filter.update((current) => ({ ...current, page: data }));
	}
}
