import {
	Body,
	Controller,
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
	MediaFolderCreate,
	type MediaFolderRow,
	type MediaFolderTree,
	MediaMoveRequest,
	type MediaOperationResult,
	MediaRename,
	MediaRestoreRequest,
	MediaSelection,
} from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { type AuthenticatedPrincipal, Audience, RequirePermissions } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { MediaLibraryService } from './media-library.service';

const actor = (principal: AuthenticatedPrincipal | undefined): string => {
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
	constructor(private readonly library: MediaLibraryService) {}

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
	activity(@Query('page') page?: string) {
		return this.library.activity(Math.max(1, Number(page) || 1), 50);
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
