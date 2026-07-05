import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { environment } from '../../../../public/environments/environment';
import { Params } from '@data-access/interfaces/core.interface';
import { IReviewModel } from '@data-access/interfaces/review.interface';

@Injectable({
	providedIn: 'root',
})
export class ReviewService {
	private http = inject(HttpClient);

	getReviews(payload?: Params): Observable<IReviewModel> {
		return this.http.get<IReviewModel>(`${environment.URL}/review.json`, { params: payload });
	}
}
