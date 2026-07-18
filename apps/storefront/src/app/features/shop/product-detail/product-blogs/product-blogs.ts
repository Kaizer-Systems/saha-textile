import { Component, computed, input } from '@angular/core';

import { IBlog } from '@data-access/interfaces/blog.interface';
import { IProduct } from '@data-access/interfaces/product.interface';
import { injectBlogsQuery } from '@data-access/queries/blog.queries';
import { BlogCarousel } from '@shared/ui/blog-carousel/blog-carousel';

/**
 * PDP data wrapper for the blog rail. Resolves the blogs the admin linked to
 * this product (or its parent product for variation axes) via `related_blog_ids`
 * and hands them to the reusable `app-blog-carousel`. Hidden when none linked.
 */
@Component({
	selector: 'app-product-blogs',
	template: `
		<app-blog-carousel
			[blogs]="blogs()"
			[title]="'from_our_journal'"
		/>
	`,
	imports: [BlogCarousel],
})
export class ProductBlogs {
	readonly product = input<IProduct | undefined>();

	private readonly blogsQuery = injectBlogsQuery(() => ({ status: 1, paginate: 15 }));

	readonly blogs = computed<IBlog[]>(() => {
		const ids = this.product()?.related_blog_ids ?? [];
		if (!ids.length) return [];
		const res = this.blogsQuery.data();
		const list: IBlog[] = Array.isArray(res) ? res : (res?.data ?? []);
		return list.filter((b) => ids.includes(b.id));
	});
}
