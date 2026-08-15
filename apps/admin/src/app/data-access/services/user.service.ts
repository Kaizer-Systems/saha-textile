import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { IUserModel } from '@data-access/interfaces/user.interface';

import { environment } from '../../../../public/environments/environment';

@Injectable({
	providedIn: 'root',
})
export class MockCustomerService {
	private http = inject(HttpClient);

	getUsers(payload?: Params): Observable<IUserModel> {
		return this.http.get<IUserModel>(`${environment.URL}/user.json`, { params: payload });
	}
}
