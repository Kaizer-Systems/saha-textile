import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { ITaxModel } from '@data-access/interfaces/tax.interface';

import { environment } from '../../../../public/environments/environment';

@Injectable({
	providedIn: 'root',
})
export class TaxService {
	private http = inject(HttpClient);

	getTaxes(payload?: Params): Observable<ITaxModel> {
		return this.http.get<ITaxModel>(`${environment.URL}/tax.json`, { params: payload });
	}
}
