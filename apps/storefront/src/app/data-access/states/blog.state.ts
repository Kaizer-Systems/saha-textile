import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

import { Action, Selector, State, StateContext } from '@ngxs/store';
import { tap } from 'rxjs';

import { GetBlogsAction, GetBlogBySlugAction, GetRecentBlogAction } from '@data-access/actions/blog.action';
import { IBlog } from '@data-access/interfaces/blog.interface';
import { BlogService } from '../services/blog.service';

export class BlogStateModel {
  blog = {
    data: [] as IBlog[],
    total: 0,
  };
  selectedBlog: IBlog | null;
  recentBlog: IBlog[] | [];
}

@State<BlogStateModel>({
  name: 'blog',
  defaults: {
    blog: {
      data: [],
      total: 0,
    },
    selectedBlog: null,
    recentBlog: [],
  },
})
@Injectable()
export class BlogState {
  private router = inject(Router);
  private blogService = inject(BlogService);

  @Selector()
  static blog(state: BlogStateModel) {
    return state.blog;
  }

  @Selector()
  static selectedBlog(state: BlogStateModel) {
    return state.selectedBlog;
  }

  @Selector()
  static resentBlog(state: BlogStateModel) {
    return state.recentBlog;
  }

  @Action(GetBlogsAction)
  getBlogs(ctx: StateContext<BlogStateModel>, action: GetBlogsAction) {
    this.blogService.skeletonLoader = true;
    return this.blogService.getBlogs(action.payload).pipe(
      tap({
        next: result => {
          ctx.patchState({
            blog: {
              data: result.data,
              total: result?.total ? result?.total : result.data ? result.data.length : 0,
            },
          });
        },
        complete: () => {
          this.blogService.skeletonLoader = false;
        },
        error: err => {
          throw new Error(err?.error?.message);
        },
      }),
    );
  }

  @Action(GetBlogBySlugAction)
  getBlogBySlug(ctx: StateContext<BlogStateModel>, { slug }: GetBlogBySlugAction) {
    return this.blogService.getBlogs().pipe(
      tap({
        next: results => {
          const result = results.data.find(blog => blog.slug == slug);
          if (result) {
            const state = ctx.getState();
            ctx.patchState({
              ...state,
              selectedBlog: result,
            });
          }
        },
        error: err => {
          void this.router.navigate(['/404']);
          throw new Error(err?.error?.message);
        },
      }),
    );
  }

  @Action(GetRecentBlogAction)
  getRecentBlogs(ctx: StateContext<BlogStateModel>, action: GetRecentBlogAction) {
    return this.blogService.getBlogs(action.payload).pipe(
      tap({
        next: result => {
          ctx.patchState({
            recentBlog: result.data,
          });
        },
        error: err => {
          throw new Error(err?.error?.message);
        },
      }),
    );
  }
}
