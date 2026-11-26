import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable, map } from 'rxjs';

import {
	ApiBlogList,
	ApiBlogPost,
	ApiBlogTerm,
	IBlog,
	IBlogModel,
	toBlog,
} from '@data-access/interfaces/blog.interface';
import { Params } from '@data-access/interfaces/core.interface';

import { environment } from '../../../../public/environments/environment';

/**
 * The shop's blog from the API. Every call is a catalogue read, so the locale interceptor names
 * the page language; the API answers in it.
 */
@Injectable({
	providedIn: 'root',
})
export class BlogService {
	private http = inject(HttpClient);
	private base = (path: string) => `${environment.apiUrl}/catalog/blog${path}`;

	public skeletonLoader: boolean = false;

	getBlogs(payload: Params = {}): Observable<IBlogModel> {
		const params: Record<string, string> = {
			page: String(Number(payload['page']) || 1),
			pageSize: String(Math.min(Number(payload['paginate']) || 10, 50)),
		};
		for (const key of ['category', 'tag']) {
			const value = payload[key];
			if (typeof value === 'string' && value) params[key] = value;
		}
		return this.http
			.get<ApiBlogList>(this.base('/posts'), { params })
			.pipe(map((page) => ({ data: page.items.map(toBlog), total: page.total }) as IBlogModel));
	}

	getBlog(slug: string): Observable<IBlog> {
		return this.http.get<ApiBlogPost>(this.base(`/posts/${encodeURIComponent(slug)}`)).pipe(map(toBlog));
	}

	getTerms(kind: 'categories' | 'tags'): Observable<ApiBlogTerm[]> {
		return this.http.get<ApiBlogTerm[]>(this.base(`/${kind}`));
	}
}
