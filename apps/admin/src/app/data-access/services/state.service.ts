import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { environment } from '../../../../public/environments/environment';
import { IStates } from '@data-access/interfaces/state.interface';

@Injectable({
	providedIn: 'root',
})
export class StateService {
	private http = inject(HttpClient);

	getStates(): Observable<IStates[]> {
		return this.http.get<IStates[]>(`${environment.URL}/state.json`);
	}
}
