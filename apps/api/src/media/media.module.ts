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
import { AdminMediaSharingController } from './admin-media-sharing.controller';
import { MediaLibraryService } from './media-library.service';
import { MediaSharingService } from './media-sharing.service';
import { MediaStorageService } from './media-storage.service';
import { ShareController } from './share.controller';

/** Media pipeline HTTP surface (owner log § Media). The worker composes the same use cases. */
@Module({
	controllers: [
		AdminMediaLibraryController,
		AdminMediaSharingController,
		ShareController,
		AdminMediaController,
		AdminContentController,
		AdminReviewsController,
		StorefrontMediaController,
		StorefrontReviewsController,
		CatalogReviewsController,
	],
	providers: [
		MediaLibraryService,
		MediaSharingService,
		MediaStorageService,
		MediaService,
		ContentBlocksService,
		YouTubeService,
		ReviewsService,
		BrandService,
	],
})
export class MediaModule {}
