import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { ICountry } from '@data-access/interfaces/country.interface';

import { environment } from '../../../../public/environments/environment';

@Injectable({
	providedIn: 'root',
})
export class CountryService {
	private http = inject(HttpClient);

	getCountries(): Observable<ICountry[]> {
		return this.http.get<ICountry[]>(`${environment.URL}/country.json`);
	}
}
