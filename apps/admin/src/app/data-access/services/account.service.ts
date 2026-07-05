import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { environment } from '../../../../public/environments/environment';
import { IAccountUser } from '@data-access/interfaces/account.interface';

@Injectable({
	providedIn: 'root',
})
export class AccountService {
	private http = inject(HttpClient);

	getUserDetails(): Observable<IAccountUser> {
		return this.http.get<IAccountUser>(`${environment.URL}/account.json`);
	}
}
