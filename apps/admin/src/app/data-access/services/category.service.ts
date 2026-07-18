import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { ICategoryModel } from '@data-access/interfaces/category.interface';
import { Params } from '@data-access/interfaces/core.interface';

import { environment } from '../../../../public/environments/environment';

@Injectable({
	providedIn: 'root',
})
export class CategoryService {
	private http = inject(HttpClient);

	getCategories(payload?: Params): Observable<ICategoryModel> {
		return this.http.get<ICategoryModel>(`${environment.URL}/category.json`, { params: payload });
	}
}
