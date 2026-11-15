import { Module } from '@nestjs/common';

import { AdminContentController } from './admin-content.controller';
import { AdminMediaController } from './admin-media.controller';
import { AdminReviewsController } from './admin-reviews.controller';
import { BrandService } from './brand.service';
import { ContentBlocksService } from './content-blocks.service';
import { MediaService } from './media.service';
import { ReviewsService } from './reviews.service';
import {
	CatalogReviewsController,
	StorefrontMediaController,
	StorefrontReviewsController,
} from './storefront-media.controller';
import { YouTubeService } from './youtube.service';
import { AdminMediaLibraryController } from './admin-media-library.controller';
import { MediaLibraryService } from './media-library.service';

/** Media pipeline HTTP surface (owner log § Media). The worker composes the same use cases. */
@Module({
	controllers: [
		AdminMediaLibraryController,
		AdminMediaController,
		AdminContentController,
		AdminReviewsController,
		StorefrontMediaController,
		StorefrontReviewsController,
		CatalogReviewsController,
	],
	providers: [MediaLibraryService, MediaService, ContentBlocksService, YouTubeService, ReviewsService, BrandService],
})
export class MediaModule {}
