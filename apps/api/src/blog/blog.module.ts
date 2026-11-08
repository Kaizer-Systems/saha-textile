import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AdminBlogController } from './admin-blog.controller';
import { BlogAdminService } from './blog-admin.service';
import { BlogPublicController } from './blog-public.controller';
import { BlogPublicService } from './blog-public.service';

/** The blog (owner log § blog, 2026-11-08): public reads for the shop, writes for the admin. */
@Module({
	imports: [AuthModule],
	controllers: [BlogPublicController, AdminBlogController],
	providers: [BlogPublicService, BlogAdminService],
	exports: [BlogPublicService],
})
export class BlogModule {}
