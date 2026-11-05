import { DatePipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { CarouselModule, OwlOptions } from 'ngx-owl-carousel-o';

import { injectBlogsQuery } from '@data-access/queries/blog.queries';

import * as data from '../../../../shared/data/owl-carousel';
import { SkeletonBlog } from '../../../blog/skeleton-blog/skeleton-blog';

@Component({
	selector: 'app-blog',
	templateUrl: './blog.html',
	styleUrls: ['./blog.scss'],
	imports: [CarouselModule, SkeletonBlog, RouterLink, DatePipe, TranslocoModule],
})
export class Blog {
	private readonly blogsQuery = injectBlogsQuery(() => ({ status: 1 }));

	readonly blogIds = input<number[]>([]);
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly sliderOption = input<OwlOptions>();

	public skeletonItems = Array.from({ length: 5 }, (_, index) => index);
	public bannerSlider = data.customOptionsItem3;

	// Skeleton only until the first data. A background refetch keeps the cards on screen, and
	// signals here let the server render the real cards rather than the placeholders.
	readonly loading = computed(() => this.blogsQuery.isPending());
	readonly blogs = computed(() =>
		(this.blogsQuery.data()?.data ?? []).filter((blog) => this.blogIds()?.includes(blog?.id!)),
	);
}
