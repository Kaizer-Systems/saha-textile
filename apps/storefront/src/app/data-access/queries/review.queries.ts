import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { ReviewService } from '@data-access/services/review.service';

/** A product's approved reviews and rating summary, keyed on the product slug. */
export function injectReviewQuery(productSlug: () => string | undefined) {
	const reviewService = inject(ReviewService);
	return injectQuery(() => ({
		queryKey: ['reviews', productSlug()],
		queryFn: () => firstValueFrom(reviewService.getReviews(productSlug() ?? '')),
		enabled: !!productSlug(),
	}));
}

/**
 * What the signed-in customer can do on this product: review, wait for delivery, or edit.
 * Browser-only and never cached across people: it is keyed on the product and only runs
 * once a session is known.
 */
export function injectMyReviewQuery(productId: () => string | undefined, signedIn: () => boolean) {
	const reviewService = inject(ReviewService);
	return injectQuery(() => ({
		queryKey: ['my-review', productId()],
		queryFn: () => firstValueFrom(reviewService.mine(productId() ?? '')),
		enabled: !!productId() && signedIn(),
		staleTime: 0,
	}));
}
