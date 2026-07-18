import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { IFaqModel } from '@data-access/interfaces/faq.interface';

import { environment } from '../../../../public/environments/environment';

@Injectable({
	providedIn: 'root',
})
export class FaqService {
	private http = inject(HttpClient);

	getFaqs(payload?: Params): Observable<IFaqModel> {
		return this.http.get<IFaqModel>(`${environment.URL}/faq.json`, { params: payload });
	}
}
