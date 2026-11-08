import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { ACTIVE_LOCALE } from '@core/i18n/active-locale';
import { IBlog, IBlogModel } from '@data-access/interfaces/blog.interface';
import { Params } from '@data-access/interfaces/core.interface';
import { BlogService } from '@data-access/services/blog.service';

const STALE_MS = 60 * 1000;

/** Live posts, sticky first then newest. The language is in the key. */
export function injectBlogsQuery(params: () => Params) {
	const blogService = inject(BlogService);
	const locale = inject(ACTIVE_LOCALE);
	return injectQuery(() => ({
		queryKey: ['blogs', locale, params()],
		queryFn: () => firstValueFrom(blogService.getBlogs(params())),
		staleTime: STALE_MS,
	}));
}

/** The newest posts for the sidebar, as a list. */
export function injectRecentBlogsQuery(params: () => Params) {
	const blogService = inject(BlogService);
	const locale = inject(ACTIVE_LOCALE);
	return injectQuery(() => ({
		queryKey: ['blogs', locale, 'recent', params()],
		queryFn: () => firstValueFrom(blogService.getBlogs(params())),
		select: (res: IBlogModel): IBlog[] => res.data,
		staleTime: STALE_MS,
	}));
}

/** One post by its address. A post that is not live answers 404, which the page shows as not found. */
export function injectBlogBySlugQuery(slug: () => string | undefined) {
	const blogService = inject(BlogService);
	const locale = inject(ACTIVE_LOCALE);
	return injectQuery(() => ({
		queryKey: ['blogs', locale, 'post', slug()],
		queryFn: () => firstValueFrom(blogService.getBlog(slug() as string)),
		enabled: !!slug(),
		staleTime: STALE_MS,
	}));
}

/** Live blog categories or tags that hold a live post, with their counts. */
export function injectBlogTermsQuery(kind: 'categories' | 'tags') {
	const blogService = inject(BlogService);
	const locale = inject(ACTIVE_LOCALE);
	return injectQuery(() => ({
		queryKey: ['blogs', locale, kind],
		queryFn: () => firstValueFrom(blogService.getTerms(kind)),
		staleTime: STALE_MS,
	}));
}
