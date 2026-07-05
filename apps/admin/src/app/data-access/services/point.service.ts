import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { environment } from '../../../../public/environments/environment';
import { Params } from '@data-access/interfaces/core.interface';
import { IPoint } from '@data-access/interfaces/point.interface';

@Injectable({
	providedIn: 'root',
})
export class PointService {
	private http = inject(HttpClient);

	getUserTransaction(payload?: Params): Observable<IPoint> {
		return this.http.get<IPoint>(`${environment.URL}/point.json`, { params: payload });
	}
}
