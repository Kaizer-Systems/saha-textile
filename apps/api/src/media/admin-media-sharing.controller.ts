import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	ShareLinkCreate,
	ShareLinkUpdate,
	type ShareLinkView,
	type ShareLinksResponse,
	StorageCheckRequest,
	type StorageCheckAnswer,
	StorageSettingsWrite,
	type StorageSummary,
} from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { type AuthenticatedPrincipal, Audience, RequirePermissions } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { actor } from './admin-media-library.controller';
import { MediaSharingService } from './media-sharing.service';
import { MediaStorageService } from './media-storage.service';

/**
 * The Media page's share links (R4-5) and storage box (R4-7). Links are made and changed with
 * `attachment.edit`; the storage check runs before uploads (`attachment.create`); only a super
 * admin changes who may use on-demand storage (checked in the service).
 */
@ApiTags(API_TAGS.media)
@Audience('admin')
@Controller('admin/media/library')
export class AdminMediaSharingController {
	constructor(
		private readonly sharing: MediaSharingService,
		private readonly storage: MediaStorageService,
	) {}

	@Get('files/:id/links')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('attachment.index')
	@ApiOperation({ operationId: 'mediaShareLinks', summary: 'A file’s share links and its public address' })
	links(@Param('id') id: string): Promise<ShareLinksResponse> {
		return this.sharing.list(id);
	}

	@Post('files/:id/links')
	@RequirePermissions('attachment.edit')
	@ApiOperation({
		operationId: 'createMediaShareLink',
		summary: 'Make a link: 1 hour to never, anyone or admins only, optional password; the code shows once',
	})
	createLink(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(ShareLinkCreate)) body: ShareLinkCreate,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<ShareLinkView> {
		return this.sharing.create(actor(principal), id, body);
	}

	@Patch('links/:linkId')
	@RequirePermissions('attachment.edit')
	@ApiOperation({ operationId: 'updateMediaShareLink', summary: 'Stop a link for good, or give it a new end' })
	updateLink(
		@Param('linkId') linkId: string,
		@Body(new ZodValidationPipe(ShareLinkUpdate)) body: ShareLinkUpdate,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<ShareLinkView> {
		return this.sharing.update(actor(principal), linkId, body);
	}

	@Get('storage')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('attachment.index')
	@ApiOperation({ operationId: 'mediaStorage', summary: 'The storage bar and its details' })
	summary(@Principal() principal: AuthenticatedPrincipal | undefined): Promise<StorageSummary> {
		return this.storage.summary(actor(principal));
	}

	@Post('storage/check')
	@HttpCode(200)
	@RequirePermissions('attachment.create')
	@ApiOperation({
		operationId: 'checkMediaStorage',
		summary: 'Before an operation that adds stored data: go (and hold the bytes), ask, or refuse',
	})
	check(
		@Body(new ZodValidationPipe(StorageCheckRequest)) body: StorageCheckRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<StorageCheckAnswer> {
		return this.storage.check(actor(principal), body);
	}

	@Delete('storage/holds/:holdId')
	@HttpCode(204)
	@RequirePermissions('attachment.create')
	@ApiOperation({ operationId: 'releaseMediaStorageHold', summary: 'End your own storage hold early' })
	async release(
		@Param('holdId') holdId: string,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<void> {
		await this.storage.releaseOwn(actor(principal), holdId);
	}

	@Put('storage/settings')
	@RequirePermissions('attachment.edit')
	@ApiOperation({
		operationId: 'saveMediaStorageSettings',
		summary: 'Super admins only: whether other admins may use on-demand storage',
	})
	saveSettings(
		@Body(new ZodValidationPipe(StorageSettingsWrite)) body: StorageSettingsWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<{ othersMayUseOnDemand: boolean }> {
		return this.storage.saveSettings(actor(principal), body);
	}
}
