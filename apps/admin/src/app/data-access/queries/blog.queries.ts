import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { BlogService } from '@data-access/services/blog.service';

/**
 * Blog posts for the admin table and pickers, any status, newest first with sticky ones on top.
 * `enabled` lets a caller skip the request when the person may not read posts.
 */
export function injectBlogsQuery(params: () => Params, enabled: () => boolean = () => true) {
	const blogService = inject(BlogService);
	return injectQuery(() => ({
		queryKey: ['blogs', params()],
		enabled: enabled(),
		queryFn: () => firstValueFrom(blogService.getBlogs(params())),
	}));
}

/** One post with every language, for the form. */
export function injectBlogPostQuery(id: () => string | undefined) {
	const blogService = inject(BlogService);
	return injectQuery(() => ({
		queryKey: ['blog', id()],
		enabled: !!id(),
		queryFn: () => firstValueFrom(blogService.getPost(id() as string)),
	}));
}
