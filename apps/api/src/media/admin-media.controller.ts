import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	MediaAssetTextUpdate,
	type MediaLibraryItem,
	MediaLibraryQuery,
	type MediaLibraryResponse,
	MediaPresignRequest,
	type MediaPresignResponse,
	type MediaRoleDefinition,
	MediaRoleUpdate,
	type MediaUploadStatus,
} from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { type AuthenticatedPrincipal, Audience, RequirePermissions } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { MediaService } from './media.service';

/** The admin media library (owner log § Media). Operators only. */
@ApiTags(API_TAGS.media)
@Audience('admin')
@Controller('admin/media')
export class AdminMediaController {
	constructor(private readonly media: MediaService) {}

	@Get()
	@RequirePermissions('attachment.index')
	@ApiOperation({
		operationId: 'listMedia',
		summary: 'Media library page with previews, usage counts and stale roles',
	})
	list(@Query(new ZodValidationPipe(MediaLibraryQuery)) query: MediaLibraryQuery): Promise<MediaLibraryResponse> {
		return this.media.library(query);
	}

	@Get('roles')
	@RequirePermissions('attachment.index')
	@ApiOperation({ operationId: 'listMediaRoles', summary: 'The image size ladder' })
	roles(): Promise<MediaRoleDefinition[]> {
		return this.media.listRoles();
	}

	@Put('roles/:key')
	@RequirePermissions('setting.edit')
	@ApiOperation({ operationId: 'updateMediaRole', summary: 'Edit a role; changed widths mark old derivatives stale' })
	updateRole(
		@Principal() principal: AuthenticatedPrincipal,
		@Param('key') key: string,
		@Body(new ZodValidationPipe(MediaRoleUpdate)) body: MediaRoleUpdate,
	): Promise<MediaRoleDefinition> {
		return this.media.updateRole(principal.userId, key, body);
	}

	@Post('presign')
	@RequirePermissions('attachment.create')
	@ApiOperation({
		operationId: 'presignMedia',
		summary: 'Start an upload: policy check, then a presigned PUT for the private original',
	})
	presign(
		@Principal() principal: AuthenticatedPrincipal,
		@Body(new ZodValidationPipe(MediaPresignRequest)) body: MediaPresignRequest,
	): Promise<MediaPresignResponse> {
		return this.media.presign({ type: 'admin', id: principal.userId }, body);
	}

	@Post(':assetId/finalize')
	@HttpCode(200)
	@RequirePermissions('attachment.create')
	@ApiOperation({ operationId: 'finalizeMedia', summary: 'The upload finished; queue processing' })
	finalize(
		@Principal() principal: AuthenticatedPrincipal,
		@Param('assetId') assetId: string,
	): Promise<MediaUploadStatus> {
		return this.media.finalize({ type: 'admin', id: principal.userId }, assetId);
	}

	@Get(':assetId/status')
	@RequirePermissions('attachment.index')
	@ApiOperation({ operationId: 'mediaStatus', summary: 'Processing state of an upload' })
	status(
		@Principal() principal: AuthenticatedPrincipal,
		@Param('assetId') assetId: string,
	): Promise<MediaUploadStatus> {
		return this.media.status({ type: 'admin', id: principal.userId }, assetId);
	}

	@Get(':assetId')
	@RequirePermissions('attachment.index')
	@ApiOperation({ operationId: 'getMedia', summary: 'One library item' })
	get(@Param('assetId') assetId: string): Promise<MediaLibraryItem> {
		return this.media.get(assetId);
	}

	@Patch(':assetId')
	@RequirePermissions('attachment.edit')
	@ApiOperation({
		operationId: 'updateMediaText',
		summary: 'Edit slug, alt, title and caption; a new slug queues a reprocess',
	})
	updateText(
		@Principal() principal: AuthenticatedPrincipal,
		@Param('assetId') assetId: string,
		@Body(new ZodValidationPipe(MediaAssetTextUpdate)) body: MediaAssetTextUpdate,
	): Promise<MediaLibraryItem> {
		return this.media.updateText(principal.userId, assetId, body);
	}

	@Post(':assetId/reprocess')
	@HttpCode(200)
	@RequirePermissions('attachment.edit')
	@ApiOperation({ operationId: 'reprocessMedia', summary: 'Regenerate every role from the retained original' })
	reprocess(
		@Principal() principal: AuthenticatedPrincipal,
		@Param('assetId') assetId: string,
	): Promise<MediaLibraryItem> {
		return this.media.reprocess(principal.userId, assetId);
	}

	@Delete(':assetId')
	@HttpCode(204)
	@RequirePermissions('attachment.destroy')
	@ApiOperation({
		operationId: 'deleteMedia',
		summary: 'Soft-delete an unused image; GC removes files after 30 days',
	})
	remove(@Principal() principal: AuthenticatedPrincipal, @Param('assetId') assetId: string): Promise<void> {
		return this.media.remove(principal.userId, assetId);
	}
}
