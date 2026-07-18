import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { ICompareModel } from '@data-access/interfaces/compare.interface';

import { environment } from '../../../../public/environments/environment';

@Injectable({
	providedIn: 'root',
})
export class CompareService {
	private http = inject(HttpClient);

	public skeletonLoader: boolean = false;

	getCompareItems(): Observable<ICompareModel> {
		return this.http.get<ICompareModel>(`${environment.URL}/compare.json`);
	}
}
