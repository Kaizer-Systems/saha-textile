import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { IBlogModel } from '@data-access/interfaces/blog.interface';
import { Params } from '@data-access/interfaces/core.interface';

import { environment } from '../../../../public/environments/environment';

@Injectable({
	providedIn: 'root',
})
export class BlogService {
	private http = inject(HttpClient);

	getBlogs(payload?: Params): Observable<IBlogModel> {
		return this.http.get<IBlogModel>(`${environment.URL}/blog.json`, { params: payload });
	}
}
