import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { environment } from '../../../../public/environments/environment';
import { Params } from '@data-access/interfaces/core.interface';
import { IPageModel } from '@data-access/interfaces/page.interface';

@Injectable({
	providedIn: 'root',
})
export class PageService {
	private http = inject(HttpClient);

	getPages(payload?: Params): Observable<IPageModel> {
		return this.http.get<IPageModel>(`${environment.URL}/page.json`, { params: payload });
	}
}
