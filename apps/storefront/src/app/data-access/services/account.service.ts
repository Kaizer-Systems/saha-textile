import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { IAccountUser } from '@data-access/interfaces/account.interface';

import { environment } from '../../../../public/environments/environment';

@Injectable({
	providedIn: 'root',
})
export class AccountService {
	private http = inject(HttpClient);

	GetUserDetails(): Observable<IAccountUser> {
		return this.http.get<IAccountUser>(`${environment.URL}/account.json`);
	}
}
