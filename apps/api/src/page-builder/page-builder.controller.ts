import { Body, Controller, Get, Header, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	type AdminBuilderPage,
	type AdminBuilderPageRow,
	type AdminLayoutView,
	CreateLayoutRequest,
	RenameLayoutRequest,
	SaveLayoutDraft,
} from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { type AuthenticatedPrincipal, Audience, RequirePermissions } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { PageBuilderService } from './page-builder.service';

/**
 * Store Front › Page Builder (brief PG-1, PG-2, B). Read with Store Front access (`theme_option.index`); drafts are
 * saved with `theme_option.edit`. Go Live and schedules come with their own permission in the Go Live step (Q10).
 */
@ApiTags(API_TAGS.media)
@Audience('admin')
@Controller('admin/page-builder')
export class AdminPageBuilderController {
	constructor(private readonly builder: PageBuilderService) {}

	@Get('pages')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('theme_option.index')
	@ApiOperation({
		operationId: 'listBuilderPages',
		summary: 'The pages the builder arranges, with what shows now (P1)',
	})
	pages(): Promise<AdminBuilderPageRow[]> {
		return this.builder.pages();
	}

	@Get('pages/:type')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('theme_option.index')
	@ApiOperation({
		operationId: 'getBuilderPage',
		summary: 'One page: its schedule and layouts with their status (A1)',
	})
	page(@Param('type') type: string): Promise<AdminBuilderPage> {
		return this.builder.page(type);
	}

	@Post('pages/:type/layouts')
	@RequirePermissions('theme_option.edit')
	@ApiOperation({ operationId: 'createBuilderLayout', summary: 'New layout: blank or a copy of another (A2)' })
	create(
		@Param('type') type: string,
		@Body(new ZodValidationPipe(CreateLayoutRequest)) body: CreateLayoutRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<AdminLayoutView> {
		return this.builder.createLayout(principal?.userId ?? null, type, body);
	}

	@Get('layouts/:id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('theme_option.index')
	@ApiOperation({
		operationId: 'getBuilderLayout',
		summary: 'A layout open in the builder, with what holds its Go Live',
	})
	layout(@Param('id') id: string): Promise<AdminLayoutView> {
		return this.builder.layoutView(id);
	}

	@Put('layouts/:id/draft')
	@RequirePermissions('theme_option.edit')
	@ApiOperation({
		operationId: 'saveBuilderDraft',
		summary: 'Save the draft; refused (409 layout_moved_on) over a newer revision',
	})
	saveDraft(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(SaveLayoutDraft)) body: SaveLayoutDraft,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<AdminLayoutView> {
		return this.builder.saveDraft(principal?.userId ?? null, id, body);
	}

	@Patch('layouts/:id')
	@RequirePermissions('theme_option.edit')
	@ApiOperation({ operationId: 'renameBuilderLayout', summary: 'Rename a layout (the name is seen by admins only)' })
	rename(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(RenameLayoutRequest)) body: RenameLayoutRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<AdminLayoutView> {
		return this.builder.rename(principal?.userId ?? null, id, body);
	}
}
