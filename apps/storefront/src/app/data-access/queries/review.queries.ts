import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { ReviewService } from '@data-access/services/review.service';

/**
 * TanStack Query for a product's reviews (replaces NGXS ReviewState.review +
 * GetReviewAction). Keyed on the product id (reactive to the product input);
 * disabled until an id is present. SendReviewAction / UpdateReviewAction were
 * no-op mocks — dropped (no backend yet).
 */
export function injectReviewQuery(productId: () => number | string | undefined) {
	const reviewService = inject(ReviewService);
	return injectQuery(() => ({
		queryKey: ['reviews', productId()],
		queryFn: () => firstValueFrom(reviewService.getReview({ product_id: productId() })),
		enabled: !!productId(),
	}));
}
