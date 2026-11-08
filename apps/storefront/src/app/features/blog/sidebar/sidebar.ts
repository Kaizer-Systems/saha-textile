import { AsyncPipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { TranslocoModule } from '@jsverse/transloco';
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
import { Observable } from 'rxjs';

import { ApiBlogTerm, IBlog } from '@data-access/interfaces/blog.interface';
import { injectBlogTermsQuery, injectRecentBlogsQuery } from '@data-access/queries/blog.queries';
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
		TranslocoModule,
	],
})
export class BlogSidebar {
	blogService = inject(BlogService);

	/** The five newest posts (brief § 1, item 9). */
	private readonly recentBlogsQuery = injectRecentBlogsQuery(() => ({ paginate: 5 }));
	resentBlog$: Observable<IBlog[]> = toObservable(computed(() => this.recentBlogsQuery.data() ?? []));
	private readonly tagsQuery = injectBlogTermsQuery('tags');
	tag$: Observable<ApiBlogTerm[]> = toObservable(computed(() => this.tagsQuery.data() ?? []));
	private readonly categoriesQuery = injectBlogTermsQuery('categories');
	category$: Observable<ApiBlogTerm[]> = toObservable(computed(() => this.categoriesQuery.data() ?? []));
}
