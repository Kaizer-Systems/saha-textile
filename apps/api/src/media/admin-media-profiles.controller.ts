import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { MediaProfileListItem } from '@saha-textile/contracts';

import { Audience, RequirePermissions } from '../auth/session.guard';
import { API_TAGS } from '../openapi-tags';
import { MediaProfilesService } from './media-profiles.service';

/** Settings › Image profiles (media build step 2). Editing arrives with the Settings screens (step 2c). */
@ApiTags(API_TAGS.media)
@Audience('admin')
@Controller('admin/media/profiles')
export class AdminMediaProfilesController {
	constructor(private readonly profiles: MediaProfilesService) {}

	@Get()
	@RequirePermissions('attachment.index')
	@ApiOperation({
		operationId: 'listMediaProfiles',
		summary: 'Image profiles, built-in first, each with how many photos hold a version of it',
	})
	list(): Promise<MediaProfileListItem[]> {
		return this.profiles.list();
	}
}
