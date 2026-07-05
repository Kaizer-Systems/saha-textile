import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { GetBlogsAction } from '@data-access/actions/blog.action';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { NoData } from '@shared/ui/no-data/no-data';
import { Pagination } from '@shared/ui/pagination/pagination';
import { IBlogModel } from '@data-access/interfaces/blog.interface';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { IOption } from '@data-access/interfaces/theme-option.interface';
import { SummaryPipe } from '@shared/pipes/summary.pipe';
import { BlogService } from '@data-access/services/blog.service';
import { BlogState } from '@data-access/states/blog.state';
import { ThemeOptionState } from '@data-access/states/theme-option.state';
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
  private store = inject(Store);
  private route = inject(ActivatedRoute);
  blogService = inject(BlogService);

  blog$: Observable<IBlogModel> = inject(Store).select(BlogState.blog) as Observable<IBlogModel>;
  themeOption$: Observable<IOption> = inject(Store).select(
    ThemeOptionState.themeOptions,
  ) as Observable<IOption>;

  public breadcrumb: IBreadcrumb = {
    title: 'Blogs',
    items: [],
  };

  public filter = {
    page: 1, // Current page number
    paginate: 50, // Display per page,
    status: 1,
    category: '',
    tag: '',
  };

  public totalItems: number = 0;
  public skeletonItems = Array.from({ length: 9 }, (_, index) => index);

  public style: string;
  public sidebar: string = 'left_sidebar';

  constructor() {
    this.route.queryParams.subscribe(params => {
      this.filter.category = params['category'] ? params['category'] : '';
      this.filter.tag = params['tag'] ? params['tag'] : '';

      this.breadcrumb.items = [];
      this.breadcrumb.title = this.filter.category
        ? `Blogs: ${this.filter.category.replaceAll('-', ' ')}`
        : this.filter.tag
          ? `Blogs: ${this.filter.tag.replaceAll('-', ' ')}`
          : 'Blogs';
      this.breadcrumb.items.push({ label: 'Blogs', active: true });

      this.store.dispatch(new GetBlogsAction(this.filter));

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
    this.blog$.subscribe(blog => (this.totalItems = blog?.total));
  }

  setPaginate(data: number) {
    this.filter.page = data;
    this.store.dispatch(new GetBlogsAction(this.filter));
  }
}
