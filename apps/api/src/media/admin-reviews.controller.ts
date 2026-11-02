import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	AdminReviewListQuery,
	type AdminReviewListResponse,
	type Review,
	ReviewModerationRequest,
} from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { type AuthenticatedPrincipal, Audience, RequirePermissions } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { ReviewsService } from './reviews.service';

/** Review moderation. Approving publishes the photos; rejecting deletes them. */
@ApiTags(API_TAGS.reviews)
@Audience('admin')
@Controller('admin/reviews')
export class AdminReviewsController {
	constructor(private readonly reviews: ReviewsService) {}

	@Get()
	@RequirePermissions('review.index')
	@ApiOperation({ operationId: 'listReviews', summary: 'Reviews with photo previews (signed while private)' })
	list(
		@Query(new ZodValidationPipe(AdminReviewListQuery)) query: AdminReviewListQuery,
	): Promise<AdminReviewListResponse> {
		return this.reviews.adminList(query);
	}

	@Post(':reviewId/moderation')
	@HttpCode(200)
	@RequirePermissions('review.edit')
	@ApiOperation({ operationId: 'moderateReview', summary: 'Approve or reject a review and its photos' })
	moderate(
		@Principal() principal: AuthenticatedPrincipal,
		@Param('reviewId') reviewId: string,
		@Body(new ZodValidationPipe(ReviewModerationRequest)) body: ReviewModerationRequest,
	): Promise<Review> {
		return this.reviews.moderate(principal.userId, reviewId, body);
	}
}
