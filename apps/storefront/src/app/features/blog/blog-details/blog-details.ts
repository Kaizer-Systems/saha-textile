import { AsyncPipe, DatePipe, NgClass } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';

import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { IBlog } from '@data-access/interfaces/blog.interface';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { IOption } from '@data-access/interfaces/theme-option.interface';
import { BlogState } from '@data-access/states/blog.state';
import { ThemeOptionState } from '@data-access/states/theme-option.state';
import { BlogSidebar } from '../sidebar/sidebar';

@Component({
  selector: 'app-blog-details',
  templateUrl: './blog-details.html',
  styleUrls: ['./blog-details.scss'],
  imports: [Breadcrumb, NgClass, BlogSidebar, AsyncPipe, DatePipe],
})
export class BlogDetails {
  private meta = inject(Meta);
  private route = inject(ActivatedRoute);

  blog$: Observable<IBlog> = inject(Store).select(BlogState.selectedBlog) as Observable<IBlog>;
  themeOption$: Observable<IOption> = inject(Store).select(
    ThemeOptionState.themeOptions,
  ) as Observable<IOption>;

  public breadcrumb: IBreadcrumb = {
    title: 'Product',
    items: [],
  };

  public sidebar: string;

  constructor() {
    this.blog$.subscribe(blog => {
      this.breadcrumb.items = [];
      this.breadcrumb.title = blog.title;
      this.breadcrumb.items.push(
        { label: 'IBlog', active: true },
        { label: blog.title, active: false },
      );
      blog?.meta_title && this.meta.updateTag({ property: 'og:title', content: blog?.meta_title });
      blog?.meta_description &&
        this.meta.updateTag({ property: 'og:description', content: blog?.meta_description });
    });

    // For Demo Purpose only
    this.route.queryParams.subscribe(params => {
      if (params['sidebar']) {
        this.sidebar = params['sidebar'];
      } else {
        // Get Blog Layout
        this.themeOption$.subscribe(theme => {
          this.sidebar = theme?.blog.blog_sidebar_type;
        });
      }
    });
  }
}
