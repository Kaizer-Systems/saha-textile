import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { IAttributeModel, AttributeValueModel } from '@data-access/interfaces/attribute.interface';
import { Params } from '@data-access/interfaces/core.interface';

import { environment } from '../../../../public/environments/environment';

@Injectable({
	providedIn: 'root',
})
export class AttributeService {
	private http = inject(HttpClient);

	getAttributes(payload?: Params): Observable<IAttributeModel> {
		return this.http.get<IAttributeModel>(`${environment.URL}/attribute.json`, { params: payload });
	}

	getAttributeValues(payload?: Params): Observable<AttributeValueModel> {
		return this.http.get<AttributeValueModel>(`${environment.URL}/attribute-value.json`, {
			params: payload,
		});
	}
}
