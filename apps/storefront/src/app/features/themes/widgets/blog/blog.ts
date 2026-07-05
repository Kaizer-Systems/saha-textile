import { DatePipe } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Store } from '@ngxs/store';
import { CarouselModule, OwlOptions } from 'ngx-owl-carousel-o';
import { Observable } from 'rxjs';

import * as data from '../../../../shared/data/owl-carousel';
import { IBlog, IBlogModel } from '@data-access/interfaces/blog.interface';
import { BlogService } from '@data-access/services/blog.service';
import { BlogState } from '@data-access/states/blog.state';
import { SkeletonBlog } from '../../../blog/skeleton-blog/skeleton-blog';

@Component({
  selector: 'app-blog',
  templateUrl: './blog.html',
  styleUrls: ['./blog.scss'],
  imports: [CarouselModule, SkeletonBlog, RouterLink, DatePipe],
})
export class Blog {
  blogService = inject(BlogService);

  blog$: Observable<IBlogModel> = inject(Store).select(BlogState.blog) as Observable<IBlogModel>;

  readonly blogIds = input<number[]>([]);
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly sliderOption = input<OwlOptions>();

  public blogs: IBlog[] = [];
  public skeletonItems = Array.from({ length: 5 }, (_, index) => index);
  public bannerSlider = data.customOptionsItem3;

  ngOnChanges() {
    if (Array.isArray(this.blogIds())) {
      this.blog$.subscribe(blogs => {
        this.blogs = blogs.data.filter(blog => this.blogIds()?.includes(blog?.id!));
      });
    }
  }
}
