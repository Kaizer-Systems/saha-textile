import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { IBlog, IBlogModel } from '@data-access/interfaces/blog.interface';
import { BlogService } from '@data-access/services/blog.service';

/**
 * Blog list (replaces NGXS BlogState.blog + GetBlogsAction). Keyed on filter
 * params. The mock endpoint ignores params, so callers that need a subset (e.g.
 * the theme widget's blogIds) still filter client-side.
 */
export function injectBlogsQuery(params: () => Params) {
  const blogService = inject(BlogService);
  return injectQuery(() => ({
    queryKey: ['blogs', params()],
    queryFn: () => firstValueFrom(blogService.getBlogs(params())),
    staleTime: Infinity,
  }));
}

/**
 * Recent posts (replaces BlogState.resentBlog + GetRecentBlogAction). Selects
 * the data array so consumers get IBlog[] directly.
 */
export function injectRecentBlogsQuery(params: () => Params) {
  const blogService = inject(BlogService);
  return injectQuery(() => ({
    queryKey: ['blogs', 'recent', params()],
    queryFn: () => firstValueFrom(blogService.getBlogs(params())),
    select: (res: IBlogModel): IBlog[] => res.data,
    staleTime: Infinity,
  }));
}

/**
 * A single blog by slug (replaces GetBlogBySlugAction + selectedBlog, and the
 * old BlogResolver). Mock data has no by-slug endpoint, so fetch the list and
 * select the match.
 */
export function injectBlogBySlugQuery(slug: () => string | undefined) {
  const blogService = inject(BlogService);
  return injectQuery(() => ({
    queryKey: ['blogs', 'all'],
    queryFn: () => firstValueFrom(blogService.getBlogs()),
    select: (res: IBlogModel): IBlog | undefined => res.data.find(blog => blog.slug == slug()),
    enabled: !!slug(),
    staleTime: Infinity,
  }));
}
