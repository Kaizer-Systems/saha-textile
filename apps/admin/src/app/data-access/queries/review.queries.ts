import { inject } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { ReviewsGateway } from '@core/media/reviews.gateway';
import { Params } from '@data-access/interfaces/core.interface';
import { ReviewService } from '@data-access/services/review.service';

export function injectReviewsQuery(params: () => Params) {
	const reviewService = inject(ReviewService);
	return injectQuery(() => ({
		queryKey: ['reviews', params()],
		queryFn: () => firstValueFrom(reviewService.getReviews(params())),
	}));
}

/** Reviews for moderation, from the API (the dashboard widget still reads the demo feed). */
export function injectModerationReviewsQuery(params: () => Params) {
	const gateway = inject(ReviewsGateway);
	return injectQuery(() => ({
		queryKey: ['moderation-reviews', params()],
		queryFn: () =>
			firstValueFrom(
				gateway.list({
					page: Number(params()['page'] ?? 1),
					pageSize: Number(params()['paginate'] ?? 20),
					status: (params()['status'] as string) || undefined,
				}),
			),
	}));
}
