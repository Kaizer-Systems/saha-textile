import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';

import {
  NgbAccordionBody,
  NgbAccordionButton,
  NgbAccordionCollapse,
  NgbAccordionDirective,
  NgbAccordionHeader,
  NgbAccordionItem,
  NgbAccordionToggle,
  NgbCollapse,
} from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { GetRecentBlogAction } from '@data-access/actions/blog.action';
import { GetTagsAction } from '@data-access/actions/tag.action';
import { IBlog } from '@data-access/interfaces/blog.interface';
import { ICategoryModel } from '@data-access/interfaces/category.interface';
import { ITagModel } from '@data-access/interfaces/tag.interface';
import { BlogService } from '@data-access/services/blog.service';
import { BlogState } from '@data-access/states/blog.state';
import { CategoryState } from '@data-access/states/category.state';
import { TagState } from '@data-access/states/tag.state';
import { SkeletonBlog } from '../skeleton-blog/skeleton-blog';
import { BlogCategory } from './blog-category/blog-category';
import { BlogTag } from './blog-tag/blog-tag';
import { RecentPost } from './recent-post/recent-post';

@Component({
  selector: 'app-blog-sidebar',
  templateUrl: './sidebar.html',
  styleUrls: ['./sidebar.scss'],
  imports: [
    SkeletonBlog,
    NgbAccordionDirective,
    NgbAccordionItem,
    NgbAccordionHeader,
    NgbAccordionToggle,
    NgbAccordionButton,
    NgbCollapse,
    NgbAccordionCollapse,
    NgbAccordionBody,
    RecentPost,
    BlogCategory,
    BlogTag,
    AsyncPipe,
    TranslateModule,
  ],
})
export class BlogSidebar {
  blogService = inject(BlogService);
  private store = inject(Store);

  resentBlog$: Observable<IBlog[]> = inject(Store).select(BlogState.resentBlog) as Observable<
    IBlog[]
  >;
  tag$: Observable<ITagModel> = inject(Store).select(TagState.tag) as Observable<ITagModel>;
  category$: Observable<ICategoryModel> = inject(Store).select(
    CategoryState.category,
  ) as Observable<ICategoryModel>;

  constructor() {
    this.store.dispatch(new GetTagsAction({ status: 1, type: 'post' }));
    this.store.dispatch(new GetRecentBlogAction({ status: 1, type: 'post', paginate: 5 }));
  }
}
