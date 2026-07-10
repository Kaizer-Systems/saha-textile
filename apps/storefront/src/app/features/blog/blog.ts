import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';
import { Observable } from 'rxjs';

import { injectBlogsQuery } from '@data-access/queries/blog.queries';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { NoData } from '@shared/ui/no-data/no-data';
import { Pagination } from '@shared/ui/pagination/pagination';
import { Params } from '@data-access/interfaces/core.interface';
import { IBlogModel } from '@data-access/interfaces/blog.interface';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { IOption } from '@data-access/interfaces/theme-option.interface';
import { SummaryPipe } from '@shared/pipes/summary.pipe';
import { BlogService } from '@data-access/services/blog.service';
import { ThemeOptionStore } from '@core/state/theme-option.store';
import { BlogSidebar } from './sidebar/sidebar';
import { SkeletonBlog } from './skeleton-blog/skeleton-blog';

@Component({
  selector: 'app-blogs',
  templateUrl: './blog.html',
  styleUrls: ['./blog.scss'],
  imports: [
    Breadcrumb,
    SkeletonBlog,
    RouterLink,
    Pagination,
    NoData,
    BlogSidebar,
    AsyncPipe,
    DatePipe,
    SummaryPipe,
    TranslateModule,
  ],
})
export class Blog {
  private route = inject(ActivatedRoute);
  blogService = inject(BlogService);

  public filter = signal<Params>({
    page: 1, // Current page number
    paginate: 50, // Display per page,
    status: 1,
    category: '',
    tag: '',
  });

  private readonly blogsQuery = injectBlogsQuery(() => this.filter());
  blog$: Observable<IBlogModel | undefined> = toObservable(
    computed(() => this.blogsQuery.data()),
  );
  themeOption$: Observable<IOption> = toObservable(inject(ThemeOptionStore).themeOptions) as Observable<IOption>;

  public breadcrumb: IBreadcrumb = {
    title: 'Blogs',
    items: [],
  };

  public totalItems: number = 0;
  public skeletonItems = Array.from({ length: 9 }, (_, index) => index);

  public style: string;
  public sidebar: string = 'left_sidebar';

  constructor() {
    // Mirror the query's fetch state onto the shared service flag the template
    // (and skeleton) read, replacing the old getBlogs action's toggling.
    effect(() => (this.blogService.skeletonLoader = this.blogsQuery.isFetching()));

    this.route.queryParams.subscribe(params => {
      const category = params['category'] ? params['category'] : '';
      const tag = params['tag'] ? params['tag'] : '';
      this.filter.update(f => ({ ...f, category, tag }));

      this.breadcrumb.items = [];
      this.breadcrumb.title = category
        ? `Blogs: ${category.replaceAll('-', ' ')}`
        : tag
          ? `Blogs: ${tag.replaceAll('-', ' ')}`
          : 'Blogs';
      this.breadcrumb.items.push({ label: 'Blogs', active: true });

      // For Demo Purpose only
      if (params['style']) {
        this.style = params['style'];
      }

      if (params['sidebar']) {
        this.sidebar = params['sidebar'];
      }

      if (!params['style'] && !params['sidebar']) {
        // Get Blog Layout
        this.themeOption$.subscribe(theme => {
          this.style = theme?.blog?.blog_style;
          this.sidebar = theme?.blog.blog_sidebar_type;
        });
      }
    });
    this.blog$.subscribe(blog => (this.totalItems = blog?.total ?? 0));
  }

  setPaginate(data: number) {
    this.filter.update(f => ({ ...f, page: data }));
  }
}
