import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { environment } from '../../../../public/environments/environment';

import type { PublicStoreLocation } from '@data-access/interfaces/store-location.interface';

/**
 * The shop's stores for Contact Us. A catalogue read, so the locale interceptor names the page
 * language and the API answers in it, hours already grouped.
 */
@Injectable({ providedIn: 'root' })
export class StoreLocationService {
	private http = inject(HttpClient);

	getStores(): Observable<PublicStoreLocation[]> {
		return this.http.get<PublicStoreLocation[]>(`${environment.apiUrl}/catalog/store-locations`);
	}
}
