import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	type AdminBuilderPage,
	type AdminBuilderPageRow,
	type AdminLayoutView,
	type AdminSavedBlockRow,
	type ComingUpResponse,
	type LayoutLockResponse,
	SaveBlockRequest,
	CreateLayoutRequest,
	PageSettings,
	RenameLayoutRequest,
	SaveLayoutDraft,
	type StorefrontPageLayout,
	StorefrontPageLayoutQuery,
} from '@saha-textile/contracts';
import type { FastifyReply } from 'fastify';

import { Principal } from '../auth/ownership';
import { type AuthenticatedPrincipal, Audience, Public, RequirePermissions } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { PageBlocksService } from './page-blocks.service';
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

	@Put('pages/:type/settings')
	@RequirePermissions('theme_option.edit')
	@ApiOperation({
		operationId: 'saveBuilderPageSettings',
		summary: "A page's own settings: search title, description, main heading, share picture (P3)",
	})
	saveSettings(
		@Param('type') type: string,
		@Body(new ZodValidationPipe(PageSettings)) body: PageSettings,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<AdminBuilderPage> {
		return this.builder.saveSettings(principal?.userId ?? null, type, body);
	}

	@Get('coming-up')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('theme_option.index')
	@ApiOperation({
		operationId: 'builderComingUp',
		summary: 'Every scheduled switch still ahead, on every page (SG-17)',
	})
	comingUp(): Promise<ComingUpResponse> {
		return this.builder.comingUp();
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
	layout(
		@Param('id') id: string,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<AdminLayoutView> {
		return this.builder.layoutView(id, principal?.userId ?? null);
	}

	@Post('layouts/:id/lock')
	@HttpCode(200)
	@RequirePermissions('theme_option.edit')
	@ApiOperation({
		operationId: 'lockBuilderLayout',
		summary: 'Take or keep the editing lock (a heartbeat every 30 s; free after 2 minutes without one)',
	})
	lock(
		@Param('id') id: string,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<LayoutLockResponse> {
		return this.builder.lock(principal?.userId ?? null, id);
	}

	@Delete('layouts/:id/lock')
	@HttpCode(204)
	@RequirePermissions('theme_option.edit')
	@ApiOperation({ operationId: 'unlockBuilderLayout', summary: 'Free the editing lock held by the asking admin' })
	unlock(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined): Promise<void> {
		return this.builder.unlock(principal?.userId ?? null, id);
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

/** Saved blocks (Page Builder SG-5, P7): sections kept on their own, reused as copies or linked. */
@ApiTags(API_TAGS.media)
@Audience('admin')
@Controller('admin/page-builder/blocks')
export class AdminPageBlocksController {
	constructor(private readonly blocks: PageBlocksService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('theme_option.index')
	@ApiOperation({ operationId: 'listBuilderBlocks', summary: 'Saved blocks, with how many layouts link each (P7)' })
	list(): Promise<AdminSavedBlockRow[]> {
		return this.blocks.list();
	}

	@Post()
	@RequirePermissions('theme_option.edit')
	@ApiOperation({ operationId: 'createBuilderBlock', summary: 'Save a section as a block (P7)' })
	create(
		@Body(new ZodValidationPipe(SaveBlockRequest)) body: SaveBlockRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<AdminSavedBlockRow> {
		return this.blocks.create(principal?.userId ?? null, body);
	}

	@Put(':id')
	@RequirePermissions('theme_option.edit')
	@ApiOperation({
		operationId: 'updateBuilderBlock',
		summary: 'Change a block; linked layouts take it at their next Go Live',
	})
	update(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(SaveBlockRequest)) body: SaveBlockRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<AdminSavedBlockRow> {
		return this.blocks.update(principal?.userId ?? null, id, body);
	}

	@Delete(':id')
	@HttpCode(204)
	@RequirePermissions('theme_option.edit')
	@ApiOperation({ operationId: 'deleteBuilderBlock', summary: 'Delete a block no layout links (409 block_in_use)' })
	remove(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined): Promise<void> {
		return this.blocks.remove(principal?.userId ?? null, id);
	}
}

/** The longest the shop or an edge may keep a layout answer: prices and stock on the page move within a minute. */
export const LAYOUT_MAX_AGE_SECONDS = 60;

/** Seconds an answer may be kept: until its next change, and never more than a minute. */
export function layoutMaxAge(refreshAt: string | null, now = Date.now()): number {
	const until = refreshAt ? Math.floor((Date.parse(refreshAt) - now) / 1000) : LAYOUT_MAX_AGE_SECONDS;
	return Math.max(0, Math.min(LAYOUT_MAX_AGE_SECONDS, until));
}

/** The shop's server reads a page's live layout (Page Builder, How the shop draws it). */
@ApiTags(API_TAGS.media)
@Public()
@Controller('storefront/pages')
export class StorefrontPageLayoutController {
	constructor(private readonly builder: PageBuilderService) {}

	@Get(':type/layout')
	@ApiOperation({
		operationId: 'storefrontPageLayout',
		summary: "A page's live layout for one language, cached until its next change and at most a minute",
	})
	async layout(
		@Param('type') type: string,
		@Query(new ZodValidationPipe(StorefrontPageLayoutQuery)) query: StorefrontPageLayoutQuery,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<StorefrontPageLayout> {
		const answer = await this.builder.shopLayout(type, query.locale);
		void reply.header('Cache-Control', `public, max-age=${layoutMaxAge(answer.refreshAt)}`);
		return answer;
	}
}
