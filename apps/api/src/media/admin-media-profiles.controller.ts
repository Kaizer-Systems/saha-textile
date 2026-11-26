import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	type MediaProfile,
	type MediaProfileListItem,
	type MediaProfileRefresh,
	type MediaProfileRefreshStarted,
	MediaProfileUpdate,
	MediaProfileWrite,
} from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { type AuthenticatedPrincipal, Audience, RequirePermissions } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { MediaProfilesService } from './media-profiles.service';
import { MediaReplaceService } from './media-replace.service';

/** Settings › Image profiles (media build step 2, Media brief F01–F03). */
@ApiTags(API_TAGS.media)
@Audience('admin')
@Controller('admin/media/profiles')
export class AdminMediaProfilesController {
	constructor(
		private readonly profiles: MediaProfilesService,
		private readonly replace: MediaReplaceService,
	) {}

	@Get()
	@RequirePermissions('attachment.index')
	@ApiOperation({
		operationId: 'listMediaProfiles',
		summary: 'Image profiles, built-in first, each with how many photos hold a version of it',
	})
	list(): Promise<MediaProfileListItem[]> {
		return this.profiles.list();
	}

	@Get(':key')
	@RequirePermissions('attachment.index')
	@ApiOperation({ operationId: 'getMediaProfile', summary: 'One image profile with its photo count' })
	get(@Param('key') key: string): Promise<MediaProfileListItem> {
		return this.profiles.get(key);
	}

	@Post()
	@RequirePermissions('setting.edit')
	@ApiOperation({ operationId: 'createMediaProfile', summary: 'Add an image profile; its key is made from the name' })
	create(
		@Principal() principal: AuthenticatedPrincipal,
		@Body(new ZodValidationPipe(MediaProfileWrite)) body: MediaProfileWrite,
	): Promise<MediaProfile> {
		return this.profiles.create(principal.userId, body);
	}

	@Put(':key')
	@RequirePermissions('setting.edit')
	@ApiOperation({
		operationId: 'updateMediaProfile',
		summary: 'Edit or switch an image profile on or off; applies to versions made afterwards',
	})
	update(
		@Principal() principal: AuthenticatedPrincipal,
		@Param('key') key: string,
		@Body(new ZodValidationPipe(MediaProfileUpdate)) body: MediaProfileUpdate,
	): Promise<MediaProfile> {
		return this.profiles.update(principal.userId, key, body);
	}

	@Get(':key/refresh')
	@RequirePermissions('setting.edit')
	@ApiOperation({
		operationId: 'previewMediaProfileRefresh',
		summary: 'Photos whose versions of this profile were made with earlier settings, and runs under way (F02)',
	})
	refreshPreview(@Param('key') key: string): Promise<MediaProfileRefresh> {
		return this.replace.refreshPreview(key);
	}

	@Post(':key/refresh')
	@HttpCode(200)
	@RequirePermissions('setting.edit')
	@ApiOperation({
		operationId: 'refreshMediaProfile',
		summary: 'Bring older versions up to date: remake them with today’s settings, old files kept 7 days (F02)',
	})
	refresh(
		@Principal() principal: AuthenticatedPrincipal,
		@Param('key') key: string,
	): Promise<MediaProfileRefreshStarted> {
		return this.replace.refresh(principal.userId, key);
	}

	@Delete(':key')
	@HttpCode(204)
	@RequirePermissions('setting.edit')
	@ApiOperation({
		operationId: 'deleteMediaProfile',
		summary: 'Delete an image profile no photo uses; built-in profiles are never deleted',
	})
	remove(@Principal() principal: AuthenticatedPrincipal, @Param('key') key: string): Promise<void> {
		return this.profiles.remove(principal.userId, key);
	}
}
