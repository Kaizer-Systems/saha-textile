import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { IWallet } from '@data-access/interfaces/wallet.interface';

import { environment } from '../../../../public/environments/environment';

@Injectable({
	providedIn: 'root',
})
export class CustomerLedgerService {
	private http = inject(HttpClient);

	getUserTransaction(payload?: Params): Observable<IWallet> {
		return this.http.get<IWallet>(`${environment.URL}/wallet.json`, { params: payload });
	}
}
