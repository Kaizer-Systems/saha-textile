import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable, map } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';
import { toAccountUser } from '@data-access/adapters/customer-to-account-user';
import { IAccountUser } from '@data-access/interfaces/account.interface';
import { IMeResponse } from '@data-access/interfaces/customer.interface';

/**
 * The signed-in customer, from OUR API.
 *
 * This used to read `assets/data/account.json` — a shipped fixture that answered with the same
 * invented person ("John Doe", a ₹300 balance, 8 orders) whoever was signed in, on every account
 * screen, in the header and at checkout. The session was real; everything the account pages drew
 * around it was not.
 *
 * `/auth/storefront/me` is the same endpoint the session bootstrap already uses, so this adds no
 * new surface — it reads the full customer rather than the narrow session projection, and hands
 * it through one adapter into the shape the ported views expect.
 */
@Injectable({
	providedIn: 'root',
})
export class AccountService {
	private http = inject(HttpClient);

	GetUserDetails(): Observable<IAccountUser> {
		return this.http.get<IMeResponse>(`${runtimeConfig.apiUrl}/auth/storefront/me`).pipe(
			map((response) => {
				if (!response.user) {
					throw new Error('anonymous');
				}
				return toAccountUser(response.user);
			}),
		);
	}
}
