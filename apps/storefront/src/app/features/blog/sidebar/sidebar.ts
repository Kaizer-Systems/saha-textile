import { AsyncPipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

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
import { Observable } from 'rxjs';

import { injectRecentBlogsQuery } from '@data-access/queries/blog.queries';
import { injectCategoriesQuery } from '@data-access/queries/category.queries';
import { injectTagsQuery } from '@data-access/queries/tag.queries';
import { IBlog } from '@data-access/interfaces/blog.interface';
import { ICategoryModel } from '@data-access/interfaces/category.interface';
import { ITagModel } from '@data-access/interfaces/tag.interface';
import { BlogService } from '@data-access/services/blog.service';
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

  private readonly recentBlogsQuery = injectRecentBlogsQuery(() => ({
    status: 1,
    type: 'post',
    paginate: 5,
  }));
  resentBlog$: Observable<IBlog[]> = toObservable(
    computed(() => this.recentBlogsQuery.data() ?? []),
  );
  private readonly tagsQuery = injectTagsQuery(() => ({ status: 1, type: 'post' }));
  tag$: Observable<ITagModel> = toObservable(
    computed(() => this.tagsQuery.data() ?? { data: [], total: 0 }),
  );
  private readonly categoriesQuery = injectCategoriesQuery(() => ({ status: 1 }));
  category$: Observable<ICategoryModel> = toObservable(
    computed(() => this.categoriesQuery.data() ?? { data: [], total: 0 }),
  );
}
