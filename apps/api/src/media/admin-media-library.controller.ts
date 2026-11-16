import {
	Body,
	Controller,
	Delete,
	Get,
	Header,
	HttpCode,
	Param,
	Patch,
	Post,
	Put,
	Query,
	UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	MediaBrowseQuery,
	type MediaBrowseResponse,
	MediaDuplicateQuery,
	type MediaDuplicateAnswer,
	MediaFavouriteWrite,
	MediaFilePresignRequest,
	type MediaFilePresignResponse,
	MediaFileVisibilityWrite,
	MediaFolderCreate,
	type MediaFolderRow,
	type MediaFolderTree,
	MediaMoveRequest,
	type MediaOperationResult,
	MediaRename,
	MediaRestoreRequest,
	MediaSelection,
	type MediaFileAddress,
	type MediaFileDetails,
	MediaFileAddressQuery,
	type MediaMultipartStart,
	type MediaPartUrls,
	MediaPartsQuery,
	MediaPartsRequest,
	type MediaTrashCheck,
	type MediaUploadedParts,
	MediaUploadRef,
	MediaAddVersionsRequest,
	type MediaAddVersionsResult,
	MediaBulkAddVersionsRequest,
	MediaVersionsStatusRequest,
	type MediaVersionsStatus,
	MediaReplaceRequest,
	type MediaReplaceStatus,
	MediaFocalRequest,
	type MediaReplaceUpload,
	EmailPictureDelete,
	EmailPictureQuery,
	type EmailPictureList,
	MediaCleanUpQuery,
	type MediaCleanUpResponse,
	type MediaZip,
	type MediaZipList,
	type MediaZipPlan,
	MediaZipRequest,
} from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { type AuthenticatedPrincipal, Audience, RequirePermissions } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { MediaLibraryService } from './media-library.service';
import { EmailPicturesService } from './email-pictures.service';
import { MediaReplaceService } from './media-replace.service';
import { MediaZipsService } from './media-zips.service';

export const actor = (principal: AuthenticatedPrincipal | undefined): string => {
	if (!principal) throw new UnauthorizedException('Authentication required');
	return principal.userId;
};

/**
 * The Media page as a file manager (media build step 1). Reading needs `attachment.index`; adding
 * folders `attachment.create`; renaming, moving, restoring and stars `attachment.edit`; Trash and
 * delete forever `attachment.destroy`. Every change is audited and listed in Activity.
 */
@ApiTags(API_TAGS.media)
@Audience('admin')
@Controller('admin/media/library')
export class AdminMediaLibraryController {
	constructor(
		private readonly library: MediaLibraryService,
		private readonly replace: MediaReplaceService,
		private readonly emailPicturesService: EmailPicturesService,
		private readonly zipsService: MediaZipsService,
	) {}

	// --- Folder downloads as .zip (media step 5, A30, A30B, A48) ------------------------------------------------

	@Post('zips/plan')
	@HttpCode(200)
	@RequirePermissions('attachment.index')
	@ApiOperation({ operationId: 'planMediaZip', summary: 'What a .zip of these would hold, for the storage check' })
	planZip(@Body(new ZodValidationPipe(MediaSelection)) body: MediaSelection): Promise<MediaZipPlan> {
		return this.zipsService.plan(body);
	}

	@Post('zips')
	@RequirePermissions('attachment.index')
	@ApiOperation({ operationId: 'createMediaZip', summary: 'Start a .zip: the worker writes it, kept 24 hours' })
	createZip(
		@Body(new ZodValidationPipe(MediaZipRequest)) body: MediaZipRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<MediaZip> {
		return this.zipsService.create(actor(principal), body);
	}

	@Get('zips')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('attachment.index')
	@ApiOperation({ operationId: 'listMediaZips', summary: 'Your own .zip files of the last day, newest first' })
	listZips(@Principal() principal: AuthenticatedPrincipal | undefined): Promise<MediaZipList> {
		return this.zipsService.list(actor(principal));
	}

	@Get('zips/:id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('attachment.index')
	@ApiOperation({ operationId: 'getMediaZip', summary: 'One of your .zip files, with its real progress' })
	getZip(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined): Promise<MediaZip> {
		return this.zipsService.get(actor(principal), id);
	}

	@Post('zips/:id/cancel')
	@HttpCode(200)
	@RequirePermissions('attachment.index')
	@ApiOperation({ operationId: 'cancelMediaZip', summary: 'Stop a .zip being made; nothing is kept' })
	cancelZip(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined): Promise<MediaZip> {
		return this.zipsService.cancel(actor(principal), id);
	}

	@Get('zips/:id/link')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('attachment.index')
	@ApiOperation({ operationId: 'mediaZipLink', summary: 'A five-minute link that saves the ready .zip' })
	zipLink(
		@Param('id') id: string,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<MediaFileAddress> {
		return this.zipsService.link(actor(principal), id);
	}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('attachment.index')
	@ApiOperation({
		operationId: 'browseMedia',
		summary: 'A folder, a search, a category, Recent, Favourites or Trash',
	})
	browse(
		@Query(new ZodValidationPipe(MediaBrowseQuery)) query: MediaBrowseQuery,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<MediaBrowseResponse> {
		return this.library.browse(actor(principal), query);
	}

	@Get('tree')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('attachment.index')
	@ApiOperation({ operationId: 'mediaFolderTree', summary: 'Every folder not in Trash, for the folder tree' })
	tree(): Promise<MediaFolderTree> {
		return this.library.tree();
	}

	@Get('activity')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('attachment.index')
	@ApiOperation({ operationId: 'mediaActivity', summary: 'Who did what on the Media page, newest first' })
	activity(@Query('page') page?: string, @Query('entityId') entityId?: string) {
		const id = typeof entityId === 'string' && /^[\w-]{1,80}$/.test(entityId) ? entityId : undefined;
		return this.library.activity(Math.max(1, Number(page) || 1), 50, id);
	}

	@Get('files/:id/details')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('attachment.index')
	@ApiOperation({
		operationId: 'mediaFileDetails',
		summary: 'One file: its facts, where it is used, its versions with their files, and per-photo pictures',
	})
	fileDetails(@Param('id') id: string): Promise<MediaFileDetails> {
		return this.library.details(id);
	}

	@Post('files/:id/versions')
	@RequirePermissions('attachment.edit')
	@ApiOperation({
		operationId: 'addMediaFileVersions',
		summary: 'Reprocess one photo: add versions (a profile and a fill each); made from the original, never twice',
	})
	addVersions(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(MediaAddVersionsRequest)) body: MediaAddVersionsRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<MediaAddVersionsResult> {
		return this.library.addVersions(actor(principal), {
			fileIds: [id],
			versions: body.versions,
			reservationId: body.reservationId,
			many: false,
		});
	}

	@Delete('files/:id/versions/:versionId')
	@HttpCode(204)
	@RequirePermissions('attachment.edit')
	@ApiOperation({
		operationId: 'removeMediaFileVersion',
		summary: 'Remove a version the website does not show, with its files; never the last one',
	})
	removeVersion(
		@Param('id') id: string,
		@Param('versionId') versionId: string,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<void> {
		return this.library.removeVersion(actor(principal), id, versionId);
	}

	@Post('files/:id/replace')
	@RequirePermissions('attachment.edit')
	@ApiOperation({
		operationId: 'startMediaFileReplace',
		summary: 'Replace a photo: the new one is checked against every version, then uploads beside the old one',
	})
	startReplace(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(MediaReplaceRequest)) body: MediaReplaceRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<MediaReplaceUpload> {
		return this.replace.start(actor(principal), id, body);
	}

	@Post('files/:id/replace/finish')
	@HttpCode(200)
	@RequirePermissions('attachment.edit')
	@ApiOperation({
		operationId: 'finishMediaFileReplaceUpload',
		summary: 'The new photo is uploaded: its versions are remade, then it takes the old one’s place everywhere',
	})
	finishReplace(
		@Param('id') id: string,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<MediaReplaceStatus> {
		return this.replace.finish(actor(principal), id);
	}

	@Get('files/:id/replace')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('attachment.index')
	@ApiOperation({ operationId: 'mediaFileReplaceStatus', summary: 'Where a Replace has got, for its three steps' })
	replaceStatus(@Param('id') id: string): Promise<MediaReplaceStatus> {
		return this.replace.status(id);
	}

	@Put('files/:id/focal')
	@RequirePermissions('attachment.edit')
	@ApiOperation({
		operationId: 'setMediaFileFocal',
		summary: 'Set the point every crop keeps; the photo’s Crop versions are remade around it',
	})
	setFocal(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(MediaFocalRequest)) body: MediaFocalRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<MediaReplaceStatus> {
		return this.replace.setFocal(actor(principal), id, body.focal);
	}

	@Delete('files/:id/replace')
	@HttpCode(204)
	@RequirePermissions('attachment.edit')
	@ApiOperation({
		operationId: 'cancelMediaFileReplace',
		summary: 'Stop a Replace still uploading, or clear one that failed; the new photo’s bytes go',
	})
	cancelReplace(@Param('id') id: string): Promise<void> {
		return this.replace.cancel(id);
	}

	@Post('versions')
	@RequirePermissions('attachment.edit')
	@ApiOperation({
		operationId: 'addMediaVersionsToMany',
		summary: 'Add the same versions to many photos; a fill is “As is” where the photo already fits',
	})
	addVersionsToMany(
		@Body(new ZodValidationPipe(MediaBulkAddVersionsRequest)) body: MediaBulkAddVersionsRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<MediaAddVersionsResult> {
		return this.library.addVersions(actor(principal), { ...body, many: true });
	}

	@Post('versions/status')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('attachment.index')
	@ApiOperation({
		operationId: 'mediaVersionsStatus',
		summary: 'How many of these photos still have versions being made, for the tray',
	})
	versionsStatus(
		@Body(new ZodValidationPipe(MediaVersionsStatusRequest)) body: MediaVersionsStatusRequest,
	): Promise<MediaVersionsStatus> {
		return this.library.versionsStatus(body.fileIds);
	}

	@Post('folders')
	@RequirePermissions('attachment.create')
	@ApiOperation({ operationId: 'createMediaFolder', summary: 'A new folder; a taken name gets “(1)”' })
	createFolder(
		@Body(new ZodValidationPipe(MediaFolderCreate)) body: MediaFolderCreate,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<MediaFolderRow> {
		return this.library.createFolder(actor(principal), body);
	}

	@Patch('folders/:id')
	@RequirePermissions('attachment.edit')
	@ApiOperation({ operationId: 'renameMediaFolder', summary: 'Rename a folder; file addresses never change' })
	renameFolder(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(MediaRename)) body: MediaRename,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<MediaOperationResult> {
		return this.library.renameFolder(actor(principal), id, body.name);
	}

	@Patch('files/:id')
	@RequirePermissions('attachment.edit')
	@ApiOperation({ operationId: 'renameMediaFile', summary: 'Rename a file; its extension and website address stay' })
	renameFile(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(MediaRename)) body: MediaRename,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<MediaOperationResult> {
		return this.library.renameFile(actor(principal), id, body.name);
	}

	@Post('move')
	@HttpCode(200)
	@RequirePermissions('attachment.edit')
	@ApiOperation({ operationId: 'moveMedia', summary: 'Move files and folders; never a folder into itself' })
	move(
		@Body(new ZodValidationPipe(MediaMoveRequest)) body: MediaMoveRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<MediaOperationResult> {
		return this.library.move(actor(principal), body);
	}

	@Post('trash')
	@HttpCode(200)
	@RequirePermissions('attachment.destroy')
	@ApiOperation({
		operationId: 'trashMedia',
		summary: 'Move to Trash; images the website uses stay, and are named with where they are used',
	})
	trash(
		@Body(new ZodValidationPipe(MediaSelection)) body: MediaSelection,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<MediaOperationResult> {
		return this.library.trash(actor(principal), body);
	}

	@Post('trash/check')
	@HttpCode(200)
	@RequirePermissions('attachment.destroy')
	@ApiOperation({
		operationId: 'checkMediaTrash',
		summary: 'Before Trash: the chosen images, folders included, that the website uses (nothing moves)',
	})
	checkTrash(@Body(new ZodValidationPipe(MediaSelection)) body: MediaSelection): Promise<MediaTrashCheck> {
		return this.library.checkTrash(body);
	}

	@Post('restore')
	@HttpCode(200)
	@RequirePermissions('attachment.edit')
	@ApiOperation({ operationId: 'restoreMedia', summary: 'Restore from Trash to the old folder, or to My files' })
	restore(
		@Body(new ZodValidationPipe(MediaRestoreRequest)) body: MediaRestoreRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<MediaOperationResult> {
		return this.library.restore(actor(principal), body);
	}

	@Get('clean-up')
	@RequirePermissions('attachment.index')
	@ApiOperation({
		operationId: 'listCleanUp',
		summary: 'Clean up: files not used for 90 days, the largest, the same file twice; never used or backups (A44)',
	})
	cleanUp(
		@Query(new ZodValidationPipe(MediaCleanUpQuery)) query: MediaCleanUpQuery,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<MediaCleanUpResponse> {
		return this.library.cleanUp(actor(principal), query);
	}

	@Get('email-pictures')
	@RequirePermissions('attachment.index')
	@ApiOperation({
		operationId: 'listEmailPictures',
		summary: 'Clean up › Email pictures: email pictures whose photo was deleted or replaced, kept for good (A50)',
	})
	emailPictures(
		@Query(new ZodValidationPipe(EmailPictureQuery)) query: EmailPictureQuery,
	): Promise<EmailPictureList> {
		return this.emailPicturesService.list(query);
	}

	@Post('email-pictures/delete')
	@HttpCode(200)
	@RequirePermissions('attachment.destroy')
	@ApiOperation({
		operationId: 'deleteEmailPictures',
		summary: 'Delete chosen email pictures for good, after the warning that old order emails lose them (A51)',
	})
	deleteEmailPictures(
		@Principal() principal: AuthenticatedPrincipal,
		@Body(new ZodValidationPipe(EmailPictureDelete)) body: EmailPictureDelete,
	): Promise<{ deleted: number; bytes: number }> {
		return this.emailPicturesService.remove(principal.userId, body.keys);
	}

	@Post('delete-forever')
	@HttpCode(200)
	@RequirePermissions('attachment.destroy')
	@ApiOperation({ operationId: 'deleteMediaForever', summary: 'Delete for good what is in Trash (audited)' })
	deleteForever(
		@Body(new ZodValidationPipe(MediaSelection)) body: MediaSelection,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<MediaOperationResult> {
		return this.library.deleteForever(actor(principal), body);
	}

	@Post('undo/:undoId')
	@HttpCode(200)
	@RequirePermissions('attachment.edit')
	@ApiOperation({ operationId: 'undoMedia', summary: 'Undo your last move, rename or Trash, once' })
	undo(
		@Param('undoId') undoId: string,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<MediaOperationResult> {
		return this.library.undo(actor(principal), undoId);
	}

	@Put('favourites')
	@RequirePermissions('attachment.edit')
	@ApiOperation({ operationId: 'starMedia', summary: 'Star or unstar a folder or a file for yourself' })
	async star(
		@Body(new ZodValidationPipe(MediaFavouriteWrite)) body: MediaFavouriteWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<{ starred: boolean }> {
		await this.library.star(actor(principal), body);
		return { starred: body.starred };
	}

	@Post('files/presign')
	@RequirePermissions('attachment.create')
	@ApiOperation({
		operationId: 'presignMediaFile',
		summary:
			'Start an upload: a plain file, or a photo with the versions to make; named in its folder, held against the plan',
	})
	presignFile(
		@Body(new ZodValidationPipe(MediaFilePresignRequest)) body: MediaFilePresignRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<MediaFilePresignResponse> {
		return this.library.presignFile(actor(principal), body);
	}

	@Post('files/:id/cancel')
	@HttpCode(204)
	@RequirePermissions('attachment.create')
	@ApiOperation({
		operationId: 'cancelMediaFileUpload',
		summary: 'Drop your own unfinished upload: its record, any stored bytes and its hold',
	})
	cancelUpload(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(MediaUploadRef)) body: MediaUploadRef,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<void> {
		return this.library.cancelUpload(actor(principal), id, body.uploadId);
	}

	@Get('files/:id/address')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('attachment.index')
	@ApiOperation({
		operationId: 'mediaFileAddress',
		summary: 'Preview or Download: the original from Spaces for five minutes, under its own name',
	})
	fileAddress(
		@Param('id') id: string,
		@Query(new ZodValidationPipe(MediaFileAddressQuery)) query: MediaFileAddressQuery,
	): Promise<MediaFileAddress> {
		return this.library.fileAddress(id, query.as);
	}

	@Post('files/:id/finalize')
	@HttpCode(200)
	@RequirePermissions('attachment.create')
	@ApiOperation({ operationId: 'finalizeMediaFile', summary: 'The plain file is uploaded: it is ready' })
	finalizeFile(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(MediaUploadRef)) body: MediaUploadRef,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<{ assetId: string; state: 'ready' }> {
		return this.library.finalizeFile(actor(principal), id, new Date(), body.uploadId);
	}

	@Post('files/:id/multipart')
	@HttpCode(200)
	@RequirePermissions('attachment.create')
	@ApiOperation({ operationId: 'startMediaMultipart', summary: 'Start a big upload in parts (S11)' })
	startMultipart(
		@Param('id') id: string,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<MediaMultipartStart> {
		return this.library.startMultipart(actor(principal), id);
	}

	@Post('files/:id/parts')
	@HttpCode(200)
	@RequirePermissions('attachment.create')
	@ApiOperation({ operationId: 'mediaPartUrls', summary: 'Signed addresses for the next parts of a big upload' })
	partUrls(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(MediaPartsRequest)) body: MediaPartsRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<MediaPartUrls> {
		return this.library.partUrls(actor(principal), id, body);
	}

	@Get('files/:id/parts')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('attachment.create')
	@ApiOperation({ operationId: 'mediaUploadedParts', summary: 'The parts of a big upload already in Spaces' })
	uploadedParts(
		@Param('id') id: string,
		@Query(new ZodValidationPipe(MediaPartsQuery)) query: MediaPartsQuery,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<MediaUploadedParts> {
		return this.library.uploadedParts(actor(principal), id, query.uploadId);
	}

	@Put('files/:id/visibility')
	@RequirePermissions('attachment.edit')
	@ApiOperation({
		operationId: 'setMediaFileVisibility',
		summary: 'Public gives a plain file a permanent address; private takes it away',
	})
	setVisibility(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(MediaFileVisibilityWrite)) body: MediaFileVisibilityWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<MediaOperationResult> {
		return this.library.setFileVisibility(actor(principal), id, body.visibility);
	}

	@Post('duplicates')
	@HttpCode(200)
	@RequirePermissions('attachment.create')
	@ApiOperation({
		operationId: 'mediaDuplicates',
		summary: 'Before an upload: the same bytes in Media, or the same name',
	})
	duplicates(
		@Body(new ZodValidationPipe(MediaDuplicateQuery)) body: MediaDuplicateQuery,
	): Promise<MediaDuplicateAnswer> {
		return this.library.duplicates(body);
	}
}
