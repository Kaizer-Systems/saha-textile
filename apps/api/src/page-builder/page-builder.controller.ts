import { Body, Controller, Get, Header, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	type AdminBuilderPage,
	type AdminBuilderPageRow,
	type AdminLayoutView,
	CreateLayoutRequest,
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
