import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import { CarouselModule, OwlOptions } from 'ngx-owl-carousel-o';
import { Observable } from 'rxjs';

import { IBlog, IBlogModel } from '@data-access/interfaces/blog.interface';
import { injectBlogsQuery } from '@data-access/queries/blog.queries';
import { BlogService } from '@data-access/services/blog.service';

import * as data from '../../../../shared/data/owl-carousel';
import { SkeletonBlog } from '../../../blog/skeleton-blog/skeleton-blog';

@Component({
	selector: 'app-blog',
	templateUrl: './blog.html',
	styleUrls: ['./blog.scss'],
	imports: [CarouselModule, SkeletonBlog, RouterLink, DatePipe],
})
export class Blog {
	blogService = inject(BlogService);

	private readonly blogsQuery = injectBlogsQuery(() => ({ status: 1 }));
	blog$: Observable<IBlogModel | undefined> = toObservable(computed(() => this.blogsQuery.data()));

	readonly blogIds = input<number[]>([]);
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly sliderOption = input<OwlOptions>();

	public blogs: IBlog[] = [];
	public skeletonItems = Array.from({ length: 5 }, (_, index) => index);
	public bannerSlider = data.customOptionsItem3;

	constructor() {
		// Mirror the query's fetch state onto the shared skeleton flag (was toggled
		// by the theme page's now-removed GetBlogsAction dispatch).
		effect(() => (this.blogService.skeletonLoader = this.blogsQuery.isFetching()));
	}

	ngOnChanges() {
		if (Array.isArray(this.blogIds())) {
			this.blog$.subscribe((blogs) => {
				this.blogs = (blogs?.data ?? []).filter((blog) => this.blogIds()?.includes(blog?.id!));
			});
		}
	}
}
