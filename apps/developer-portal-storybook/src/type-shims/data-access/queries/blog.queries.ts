import { signal } from '@angular/core';

import type {
	ApiBlogTerm,
	IBlog,
	IBlogModel,
} from '../../../../../storefront/src/app/data-access/interfaces/blog.interface';
import { blogPosts } from '../../../fixtures/storefront-blog';

const blogs = structuredClone(blogPosts);
const blogPage: IBlogModel = {
	data: blogs,
	total: blogs.length,
};

const idleQuery = {
	isFetching: signal(false),
	isPending: signal(false),
};

export function injectBlogsQuery() {
	return {
		...idleQuery,
		data: signal<IBlogModel | undefined>(blogPage),
	};
}

export function injectRecentBlogsQuery() {
	return {
		...idleQuery,
		data: signal<IBlog[] | undefined>(blogs),
	};
}

export function injectBlogBySlugQuery() {
	return {
		...idleQuery,
		data: signal<IBlog | undefined>(blogs[0]),
	};
}

export function injectBlogTermsQuery(kind: 'categories' | 'tags') {
	const terms: ApiBlogTerm[] =
		kind === 'categories'
			? [
					{ slug: 'saree-guides', name: 'Saree guides', count: 2 },
					{ slug: 'weddings-and-festivals', name: 'Weddings and festivals', count: 1 },
				]
			: [{ slug: 'banarasi', name: 'Banarasi', count: 1 }];
	return {
		...idleQuery,
		data: signal<ApiBlogTerm[] | undefined>(terms),
	};
}
