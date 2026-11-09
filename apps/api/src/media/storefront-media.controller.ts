import {
	Body,
	Controller,
	Get,
	Header,
	HttpCode,
	Param,
	Patch,
	Post,
	Query,
	UnauthorizedException,
	UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	type MediaPresignResponse,
	type MediaUploadRules,
	type MediaUploadStatus,
	type MyProductReview,
	MyProductReviewQuery,
	ProductReviewsQuery,
	type ProductReviewsResponse,
	type Review,
	ReviewPhotoPresignRequest,
	ReviewSubmitRequest,
	ReviewUpdateRequest,
	StorefrontBannersQuery,
	type StorefrontBannersResponse,
	type StorefrontBrand,
	YouTubeRailQuery,
	type YouTubeRailResponse,
	type YouTubeVideosResponse,
} from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { type AuthenticatedPrincipal, Audience, Public } from '../auth/session.guard';
import { CatalogLocaleInterceptor } from '../catalog/catalog-locale';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { BrandService } from './brand.service';
import { ContentBlocksService } from './content-blocks.service';
import { MediaService } from './media.service';
import { ReviewsService } from './reviews.service';
import { YouTubeService } from './youtube.service';

/** Public reads: banners, the YouTube rail, and the upload rules a client validates against. */
@ApiTags(API_TAGS.media)
@Controller()
export class StorefrontMediaController {
	constructor(
		private readonly media: MediaService,
		private readonly blocks: ContentBlocksService,
		private readonly youtube: YouTubeService,
		private readonly brand: BrandService,
	) {}

	@Get('storefront/brand')
	@Public()
	@ApiOperation({ operationId: 'storefrontBrand', summary: "The shop's name, logo, seal and icons" })
	brandKit(): Promise<StorefrontBrand> {
		return this.brand.storefront();
	}

	@Get('media/upload-rules')
	@Public()
	@ApiOperation({ operationId: 'mediaUploadRules', summary: 'Size, type and count limits for uploads' })
	rules(): MediaUploadRules {
		return this.media.uploadRules();
	}

	@Get('storefront/banners')
	@Public()
	@ApiOperation({ operationId: 'storefrontBanners', summary: "A page's live banners, resolved for the locale" })
	banners(
		@Query(new ZodValidationPipe(StorefrontBannersQuery)) query: StorefrontBannersQuery,
	): Promise<StorefrontBannersResponse> {
		return this.blocks.storefront(query);
	}

	@Get('storefront/youtube/rail')
	@Public()
	@ApiOperation({ operationId: 'youtubeRail', summary: 'Cached latest channel videos for a placement' })
	rail(@Query(new ZodValidationPipe(YouTubeRailQuery)) query: YouTubeRailQuery): Promise<YouTubeRailResponse> {
		return this.youtube.rail(query.placement);
	}

	@Get('storefront/youtube/videos')
	@Public()
	@ApiOperation({ operationId: 'youtubeVideos', summary: "The channel's cached videos and Shorts for /videos" })
	videos(): Promise<YouTubeVideosResponse> {
		return this.youtube.videos();
	}
}

/**
 * A customer's own review photos and reviews. No customer id appears in any route: the owner
 * is the session principal, so one shopper cannot address another's upload.
 */
@ApiTags(API_TAGS.reviews)
@Audience('storefront')
@Controller('storefront/reviews')
export class StorefrontReviewsController {
	constructor(
		private readonly media: MediaService,
		private readonly reviews: ReviewsService,
	) {}

	private ownerId(principal: AuthenticatedPrincipal | undefined): string {
		if (!principal) throw new UnauthorizedException('Authentication required');
		return principal.userId;
	}

	@Post('photos/presign')
	@ApiOperation({ operationId: 'presignReviewPhoto', summary: 'Start a review photo upload (verified buyers only)' })
	presign(
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Body(new ZodValidationPipe(ReviewPhotoPresignRequest)) body: ReviewPhotoPresignRequest,
	): Promise<MediaPresignResponse> {
		return this.reviews.presignPhoto(this.ownerId(principal), body);
	}

	@Post('photos/:assetId/finalize')
	@HttpCode(200)
	@ApiOperation({ operationId: 'finalizeReviewPhoto', summary: 'The photo upload finished; queue processing' })
	finalize(
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Param('assetId') assetId: string,
	): Promise<MediaUploadStatus> {
		return this.media.finalize({ type: 'customer', id: this.ownerId(principal) }, assetId);
	}

	@Get('photos/:assetId/status')
	@ApiOperation({ operationId: 'reviewPhotoStatus', summary: 'Processing state of a review photo' })
	status(
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Param('assetId') assetId: string,
	): Promise<MediaUploadStatus> {
		return this.media.status({ type: 'customer', id: this.ownerId(principal) }, assetId);
	}

	@Get('mine')
	@Header('Cache-Control', 'private, no-store')
	@UseInterceptors(CatalogLocaleInterceptor)
	@ApiOperation({
		operationId: 'myProductReview',
		summary: 'Whether you can review this product, are waiting for delivery, or your review',
	})
	mine(
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Query(new ZodValidationPipe(MyProductReviewQuery)) query: MyProductReviewQuery,
	): Promise<MyProductReview> {
		return this.reviews.mine(this.ownerId(principal), query.productId);
	}

	@Patch(':reviewId')
	@ApiOperation({ operationId: 'updateReview', summary: 'Edit your review; it waits for approval again' })
	update(
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Param('reviewId') reviewId: string,
		@Body(new ZodValidationPipe(ReviewUpdateRequest)) body: ReviewUpdateRequest,
	): Promise<Review> {
		return this.reviews.update(this.ownerId(principal), reviewId, body);
	}

	@Post()
	@ApiOperation({
		operationId: 'submitReview',
		summary: 'Submit a review with up to five photos; held for moderation',
	})
	submit(
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Body(new ZodValidationPipe(ReviewSubmitRequest)) body: ReviewSubmitRequest,
	): Promise<Review> {
		return this.reviews.submit(this.ownerId(principal), body);
	}
}

/** Approved reviews, public. Pending and rejected reviews never appear here. */
@ApiTags(API_TAGS.reviews)
@Controller('catalog/reviews')
@UseInterceptors(CatalogLocaleInterceptor)
export class CatalogReviewsController {
	constructor(private readonly reviews: ReviewsService) {}

	@Get()
	@Public()
	@Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
	@ApiOperation({ operationId: 'catalogReviews', summary: "A product's approved reviews and rating summary" })
	list(
		@Query(new ZodValidationPipe(ProductReviewsQuery)) query: ProductReviewsQuery,
	): Promise<ProductReviewsResponse> {
		return this.reviews.publicList(query);
	}
}
