import { signal } from '@angular/core';

import blogFixture from '../../../../../storefront/public/assets/data/blog.json';
import type { IBlog, IBlogModel } from '../../../../../storefront/src/app/data-access/interfaces/blog.interface';

const blogs = structuredClone(blogFixture.data.slice(0, 3)) as unknown as IBlog[];
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
