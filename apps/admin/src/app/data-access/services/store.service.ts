import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { IStoresModel } from '@data-access/interfaces/store.interface';

import { environment } from '../../../../public/environments/environment';

@Injectable({
	providedIn: 'root',
})
export class StoreService {
	private http = inject(HttpClient);

	getStores(payload?: Params): Observable<IStoresModel> {
		return this.http.get<IStoresModel>(`${environment.URL}/store.json`, { params: payload });
	}
}
