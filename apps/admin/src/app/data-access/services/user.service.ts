import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { environment } from '../../../../public/environments/environment';
import { Params } from '@data-access/interfaces/core.interface';
import { IUserModel } from '@data-access/interfaces/user.interface';

@Injectable({
	providedIn: 'root',
})
export class UserService {
	private http = inject(HttpClient);

	getUsers(payload?: Params): Observable<IUserModel> {
		return this.http.get<IUserModel>(`${environment.URL}/user.json`, { params: payload });
	}
}
