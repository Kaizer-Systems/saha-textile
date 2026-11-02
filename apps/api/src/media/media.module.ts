import { Module } from '@nestjs/common';

import { AdminContentController } from './admin-content.controller';
import { AdminMediaController } from './admin-media.controller';
import { AdminReviewsController } from './admin-reviews.controller';
import { ContentBlocksService } from './content-blocks.service';
import { MediaService } from './media.service';
import { ReviewsService } from './reviews.service';
import { StorefrontMediaController, StorefrontReviewsController } from './storefront-media.controller';
import { YouTubeService } from './youtube.service';

/** Media pipeline HTTP surface (owner log § Media). The worker composes the same use cases. */
@Module({
	controllers: [
		AdminMediaController,
		AdminContentController,
		AdminReviewsController,
		StorefrontMediaController,
		StorefrontReviewsController,
	],
	providers: [MediaService, ContentBlocksService, YouTubeService, ReviewsService],
})
export class MediaModule {}
