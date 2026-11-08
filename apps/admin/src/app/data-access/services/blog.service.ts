import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable, map } from 'rxjs';

import { IBlog, IBlogModel } from '@data-access/interfaces/blog.interface';
import { Params } from '@data-access/interfaces/core.interface';

import { environment } from '../../../../public/environments/environment';

import type {
	AdminBlogListResponse,
	AdminBlogPostRow,
	BlogCategory,
	BlogCategoryWrite,
	BlogPostWrite,
	BlogStatus,
	BlogTag,
	BlogTagWrite,
	GoLiveResult,
} from '@saha-textile/contracts';

export type BlogTermKind = 'categories' | 'tags';

/** A post row as the table draws it: the English title, the cover and a live switch. */
export function toBlog(row: AdminBlogPostRow): IBlog {
	return {
		id: row.post.id,
		title: row.post.title['en'] ?? row.post.slug,
		slug: row.post.slug,
		status: row.post.status === 'live' ? 1 : 0,
		blog_thumbnail: row.cover?.url ? { original_url: row.cover.url } : null,
		published_at: row.post.publishedAt,
		created_at: row.post.createdAt,
		row,
	};
}

/** The admin blog API: posts, and the blog's own categories and tags. */
@Injectable({
	providedIn: 'root',
})
export class BlogService {
	private http = inject(HttpClient);
	private base = (path = '') => `${environment.apiUrl}/admin/blog${path}`;

	getBlogs(payload?: Params): Observable<IBlogModel> {
		const params: Record<string, string> = {
			page: String(Number(payload?.['page']) || 1),
			pageSize: String(Math.min(Number(payload?.['paginate']) || 20, 100)),
		};
		const search = payload?.['search'];
		if (typeof search === 'string' && search.trim()) params['search'] = search.trim();
		return this.http
			.get<AdminBlogListResponse>(this.base('/posts'), { params })
			.pipe(map((page) => ({ data: page.items.map(toBlog), total: page.total }) as IBlogModel));
	}

	getPost(id: string): Observable<AdminBlogPostRow> {
		return this.http.get<AdminBlogPostRow>(this.base(`/posts/${encodeURIComponent(id)}`));
	}

	savePost(id: string | null, body: BlogPostWrite): Observable<AdminBlogPostRow> {
		const path = id ? `/posts/${encodeURIComponent(id)}` : '/posts';
		return this.http.post<AdminBlogPostRow>(this.base(path), body);
	}

	goLive(id: string): Observable<GoLiveResult> {
		return this.http.post<GoLiveResult>(this.base(`/posts/${encodeURIComponent(id)}/go-live`), {});
	}

	setStatus(id: string, status: BlogStatus): Observable<GoLiveResult> {
		return this.http.post<GoLiveResult>(this.base(`/posts/${encodeURIComponent(id)}/status`), { status });
	}

	deletePost(id: string): Observable<void> {
		return this.http.delete<void>(this.base(`/posts/${encodeURIComponent(id)}`));
	}

	getTerms(kind: 'categories'): Observable<BlogCategory[]>;
	getTerms(kind: 'tags'): Observable<BlogTag[]>;
	getTerms(kind: BlogTermKind): Observable<BlogCategory[] | BlogTag[]> {
		return this.http.get<BlogCategory[] | BlogTag[]>(this.base(`/${kind}`));
	}

	saveTerm(
		kind: BlogTermKind,
		id: string | null,
		body: BlogCategoryWrite | BlogTagWrite,
	): Observable<{ id: string }> {
		const path = id ? `/${kind}/${encodeURIComponent(id)}` : `/${kind}`;
		return this.http.post<{ id: string }>(this.base(path), body);
	}

	deleteTerm(kind: BlogTermKind, id: string): Observable<void> {
		return this.http.delete<void>(this.base(`/${kind}/${encodeURIComponent(id)}`));
	}
}
