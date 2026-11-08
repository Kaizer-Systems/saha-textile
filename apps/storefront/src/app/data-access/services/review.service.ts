import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { IMyProductReview, IProductReviews, IReviewEdit } from '@data-access/interfaces/product-review.interface';

import { environment } from '../../../../public/environments/environment';

/**
 * Product reviews from the API. The public list holds approved reviews only; `mine` and `update`
 * are the signed-in customer's own, and the API takes the customer from the session cookie.
 */
@Injectable({
	providedIn: 'root',
})
export class ReviewService {
	private http = inject(HttpClient);

	getReviews(productSlug: string, page = 1): Observable<IProductReviews> {
		return this.http.get<IProductReviews>(`${environment.apiUrl}/catalog/reviews`, {
			params: { productSlug, page, pageSize: 10 },
		});
	}

	mine(productId: string): Observable<IMyProductReview> {
		return this.http.get<IMyProductReview>(`${environment.apiUrl}/storefront/reviews/mine`, {
			params: { productId },
			withCredentials: true,
		});
	}

	update(reviewId: string, body: IReviewEdit): Observable<{ id: string; status: string }> {
		return this.http.patch<{ id: string; status: string }>(
			`${environment.apiUrl}/storefront/reviews/${encodeURIComponent(reviewId)}`,
			body,
			{
				withCredentials: true,
			},
		);
	}
}
