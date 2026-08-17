import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable, map } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';
import { toAccountUser } from '@data-access/adapters/customer-to-account-user';
import { IAccountUser } from '@data-access/interfaces/account.interface';
import { ICustomer, ICustomerAddress } from '@data-access/interfaces/customer.interface';

/**
 * The signed-in customer's own saved addresses.
 *
 * Every route is under `storefront/account/…` and carries NO customer id — the server takes the
 * owner from the session. That is why these are separate from the operator routes under
 * `admin/customers/:customerId/addresses` rather than the same endpoints with a permission
 * check: a self-service caller must not be able to name another account at all.
 *
 * Each call answers the whole updated customer, so the store replaces its view from the
 * server's rather than patching a local copy and hoping the two agree.
 */
@Injectable({
	providedIn: 'root',
})
export class AccountAddressService {
	private http = inject(HttpClient);

	private url(path = ''): string {
		return `${runtimeConfig.apiUrl}/storefront/account/addresses${path}`;
	}

	create(address: Omit<ICustomerAddress, 'id'>): Observable<IAccountUser> {
		return this.http.post<ICustomer>(this.url(), address).pipe(map(toAccountUser));
	}

	update(addressId: string, address: Partial<Omit<ICustomerAddress, 'id'>>): Observable<IAccountUser> {
		return this.http.patch<ICustomer>(this.url(`/${addressId}`), address).pipe(map(toAccountUser));
	}

	remove(addressId: string): Observable<IAccountUser> {
		return this.http.delete<ICustomer>(this.url(`/${addressId}`)).pipe(map(toAccountUser));
	}

	/**
	 * Changes the display name — and only that.
	 *
	 * Email and phone are login credentials; moving one needs proof and a verification round trip
	 * rather than a patch field, so the API refuses them here.
	 */
	updateProfile(displayName: string): Observable<IAccountUser> {
		return this.http
			.patch<ICustomer>(`${runtimeConfig.apiUrl}/storefront/account/profile`, { displayName })
			.pipe(map(toAccountUser));
	}
}
