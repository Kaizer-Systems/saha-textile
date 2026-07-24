import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { ReviewService } from '@data-access/services/review.service';

export function injectReviewsQuery(params: () => Params) {
	const reviewService = inject(ReviewService);
	return injectQuery(() => ({
		queryKey: ['reviews', params()],
		queryFn: () => firstValueFrom(reviewService.getReviews(params())),
	}));
}
