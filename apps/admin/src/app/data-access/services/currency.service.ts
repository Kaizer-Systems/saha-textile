import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { environment } from '../../../../public/environments/environment';
import { Params } from '@data-access/interfaces/core.interface';
import { ICurrencyModel } from '@data-access/interfaces/currency.interface';

@Injectable({
	providedIn: 'root',
})
export class CurrencyService {
	private http = inject(HttpClient);

	getCurrencies(payload?: Params): Observable<ICurrencyModel> {
		return this.http.get<ICurrencyModel>(`${environment.URL}/currency.json`, { params: payload });
	}
}
