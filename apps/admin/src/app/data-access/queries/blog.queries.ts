import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { BlogService } from '@data-access/services/blog.service';

export function injectBlogsQuery(params: () => Params) {
	const blogService = inject(BlogService);
	return injectQuery(() => ({
		queryKey: ['blogs', params()],
		queryFn: () => firstValueFrom(blogService.getBlogs(params())),
	}));
}
