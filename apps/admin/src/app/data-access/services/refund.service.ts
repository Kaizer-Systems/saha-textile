import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { IRefundModel } from '@data-access/interfaces/refund.interface';

import { environment } from '../../../../public/environments/environment';

@Injectable({
	providedIn: 'root',
})
export class RefundService {
	private http = inject(HttpClient);

	getRefunds(payload?: Params): Observable<IRefundModel> {
		return this.http.get<IRefundModel>(`${environment.URL}/refund.json`, { params: payload });
	}
}
