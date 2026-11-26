import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PageBlocksService } from './page-blocks.service';
import { PageGoLiveService } from './page-go-live.service';
import { PagePreviewService } from './page-preview.service';
import {
	AdminPageBlocksController,
	AdminPageBuilderController,
	AdminPageGoLiveController,
	AdminPagePreviewController,
	AdminBundlePreviewController,
	StorefrontPageLayoutController,
	StorefrontPreviewController,
} from './page-builder.controller';
import { PageBuilderService } from './page-builder.service';

/** Page Builder (brief revision 2, every recommendation accepted 2026-11-17): pages, layouts, drafts. */
@Module({
	imports: [AuthModule],
	controllers: [
		AdminPageBuilderController,
		AdminPageBlocksController,
		AdminPageGoLiveController,
		AdminPagePreviewController,
		AdminBundlePreviewController,
		StorefrontPageLayoutController,
		StorefrontPreviewController,
	],
	providers: [PageBuilderService, PageBlocksService, PagePreviewService, PageGoLiveService],
	exports: [PageGoLiveService],
})
export class PageBuilderModule {}
