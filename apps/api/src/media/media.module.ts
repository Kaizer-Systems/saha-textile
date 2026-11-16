import { Module } from '@nestjs/common';

import { AdminContentController } from './admin-content.controller';
import { AdminMediaController } from './admin-media.controller';
import { AdminMediaProfilesController } from './admin-media-profiles.controller';
import { AdminReviewsController } from './admin-reviews.controller';
import { BrandService } from './brand.service';
import { ContentBlocksService } from './content-blocks.service';
import { MediaProfilesService } from './media-profiles.service';
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
import { MediaReplaceService } from './media-replace.service';
import { EmailPicturesService } from './email-pictures.service';
import { MediaSharingService } from './media-sharing.service';
import { MediaStorageService } from './media-storage.service';
import { ShareController } from './share.controller';

/** Media pipeline HTTP surface (owner log § Media). The worker composes the same use cases. */
@Module({
	controllers: [
		AdminMediaLibraryController,
		AdminMediaSharingController,
		AdminMediaProfilesController,
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
		MediaReplaceService,
		EmailPicturesService,
		MediaSharingService,
		MediaStorageService,
		MediaProfilesService,
		MediaService,
		ContentBlocksService,
		YouTubeService,
		ReviewsService,
		BrandService,
	],
})
export class MediaModule {}
