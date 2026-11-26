import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { Observable } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';
import { PAGE_EXPLAINS_ERRORS } from '@core/shipping/shipping.gateway';

import type { Customer, SavedAddressWrite } from '@saha-textile/contracts';

/**
 * A customer's named addresses, checked against the country rules (brief ad04–ad05; DEC-ADDRESS): the
 * server checks the State list, the PIN code and the phone number before saving. Removing an address
 * still goes through the customer gateway's `deleteAddress`, which needs no check.
 */
@Injectable({ providedIn: 'root' })
export class CustomerAddressBookGateway {
	private readonly http = inject(HttpClient);
	private readonly api = (customerId: string, addressId?: string) =>
		`${runtimeConfig.apiUrl}/admin/customers/${encodeURIComponent(customerId)}/address-book${
			addressId ? `/${encodeURIComponent(addressId)}` : ''
		}`;

	save(customerId: string, addressId: string | null, body: SavedAddressWrite): Observable<Customer> {
		return addressId
			? this.http.put<Customer>(this.api(customerId, addressId), body, PAGE_EXPLAINS_ERRORS)
			: this.http.post<Customer>(this.api(customerId), body, PAGE_EXPLAINS_ERRORS);
	}
}
