import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { environment } from '../../../../public/environments/environment';
import { IBlogModel } from '@data-access/interfaces/blog.interface';
import { Params } from '@data-access/interfaces/core.interface';

@Injectable({
  providedIn: 'root',
})
export class BlogService {
  private http = inject(HttpClient);

  public skeletonLoader: boolean = false;

  getBlogs(payload?: Params): Observable<IBlogModel> {
    return this.http.get<IBlogModel>(`${environment.URL}/blog.json`, { params: payload });
  }
}
