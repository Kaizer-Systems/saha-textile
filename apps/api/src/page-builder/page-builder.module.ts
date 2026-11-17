import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PageBlocksService } from './page-blocks.service';
import {
	AdminPageBlocksController,
	AdminPageBuilderController,
	StorefrontPageLayoutController,
} from './page-builder.controller';
import { PageBuilderService } from './page-builder.service';

/** Page Builder (brief revision 2, every recommendation accepted 2026-11-17): pages, layouts, drafts. */
@Module({
	imports: [AuthModule],
	controllers: [AdminPageBuilderController, AdminPageBlocksController, StorefrontPageLayoutController],
	providers: [PageBuilderService, PageBlocksService],
})
export class PageBuilderModule {}
