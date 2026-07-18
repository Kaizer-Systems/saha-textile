import { AsyncPipe, DatePipe, NgClass } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Meta } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';

import { Observable } from 'rxjs';

import { SiteConfigStore } from '@core/state/site-config.store';
import { IBlog } from '@data-access/interfaces/blog.interface';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { ISiteConfig } from '@data-access/interfaces/site-config.interface';
import { injectBlogBySlugQuery } from '@data-access/queries/blog.queries';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';

import { BlogSidebar } from '../sidebar/sidebar';

@Component({
	selector: 'app-blog-details',
	templateUrl: './blog-details.html',
	styleUrls: ['./blog-details.scss'],
	imports: [Breadcrumb, NgClass, BlogSidebar, AsyncPipe, DatePipe],
})
export class BlogDetails {
	private meta = inject(Meta);
	private route = inject(ActivatedRoute);

	private readonly slug = signal<string | undefined>(undefined);
	private readonly blogQuery = injectBlogBySlugQuery(() => this.slug());
	blog$: Observable<IBlog | undefined> = toObservable(computed(() => this.blogQuery.data()));
	siteConfig$: Observable<ISiteConfig> = toObservable(inject(SiteConfigStore).siteConfig) as Observable<ISiteConfig>;

	public breadcrumb: IBreadcrumb = {
		title: 'Product',
		items: [],
	};

	public sidebar: string;

	constructor() {
		// Blog looked up by slug via the query (was BlogResolver + selectedBlog).
		this.route.params.subscribe((params) => this.slug.set(params['slug']));

		this.blog$.subscribe((blog) => {
			if (!blog) return;
			this.breadcrumb.items = [];
			this.breadcrumb.title = blog.title;
			this.breadcrumb.items.push({ label: 'IBlog', active: true }, { label: blog.title, active: false });
			blog?.meta_title && this.meta.updateTag({ property: 'og:title', content: blog?.meta_title });
			blog?.meta_description &&
				this.meta.updateTag({ property: 'og:description', content: blog?.meta_description });
		});

		// For Demo Purpose only
		this.route.queryParams.subscribe((params) => {
			if (params['sidebar']) {
				this.sidebar = params['sidebar'];
			} else {
				// Get Blog Layout
				this.siteConfig$.subscribe((theme) => {
					this.sidebar = theme?.blog.blog_sidebar_type;
				});
			}
		});
	}
}
