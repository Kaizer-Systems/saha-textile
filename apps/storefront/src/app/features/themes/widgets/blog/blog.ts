import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { CarouselModule, OwlOptions } from 'ngx-owl-carousel-o';

import { injectBlogsQuery } from '@data-access/queries/blog.queries';
import { ShopDatePipe } from '@shared/pipes/shop-date.pipe';

import * as data from '../../../../shared/data/owl-carousel';
import { SkeletonBlog } from '../../../blog/skeleton-blog/skeleton-blog';

@Component({
	selector: 'app-blog',
	templateUrl: './blog.html',
	styleUrls: ['./blog.scss'],
	imports: [CarouselModule, SkeletonBlog, RouterLink, ShopDatePipe, TranslocoModule],
})
export class Blog {
	/** The newest live posts, sticky ones first (brief § 3). */
	private readonly blogsQuery = injectBlogsQuery(() => ({ paginate: 6 }));

	/** Picks posts by id when given; empty shows the newest. */
	readonly blogIds = input<string[]>([]);
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly sliderOption = input<OwlOptions>();

	public skeletonItems = Array.from({ length: 5 }, (_, index) => index);
	public bannerSlider = data.customOptionsItem3;

	// Skeleton only until the first data. A background refetch keeps the cards on screen, and
	// signals here let the server render the real cards rather than the placeholders.
	readonly loading = computed(() => this.blogsQuery.isPending());
	readonly blogs = computed(() => {
		const posts = this.blogsQuery.data()?.data ?? [];
		const ids = this.blogIds() ?? [];
		return ids.length ? posts.filter((blog) => ids.includes(blog.id)) : posts;
	});
}
