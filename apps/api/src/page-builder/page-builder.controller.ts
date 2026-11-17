import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	type AdminBuilderPage,
	type AdminBuilderPageRow,
	type AdminLayoutView,
	type AdminSavedBlockRow,
	type ComingUpResponse,
	type GoLiveResponse,
	type GoLiveView,
	type LayoutHistoryResponse,
	type LayoutLockResponse,
	type PageBuilderAlerts,
	type PageSalesResponse,
	LayoutExport,
	BringBackRequest,
	CancelSwitchRequest,
	GoLiveRequest,
	ReviewRequest,
	SafeModeRequest,
	type PreviewCodeResponse,
	type PreviewExchangeResponse,
	PreviewCodeRequest,
	PreviewExchangeRequest,
	PreviewLayoutQuery,
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
import { PageGoLiveService } from './page-go-live.service';
import { PagePreviewService } from './page-preview.service';
import { PageBuilderService } from './page-builder.service';

/**
 * Store Front › Page Builder (brief PG-1, PG-2, B). Read with Store Front access (`theme_option.index`); drafts are
 * saved with `theme_option.edit`. Go Live, schedules and Put back need `page_builder.go_live` (Q10 A: the owner and
 * super admins); safe mode is for super admins only (SG-15).
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

/** Go Live, schedules, History, Put back, safe mode, Ask for review and the bell (Page Builder build step 7). */
@ApiTags(API_TAGS.media)
@Audience('admin')
@Controller('admin/page-builder')
export class AdminPageGoLiveController {
	constructor(private readonly goLive: PageGoLiveService) {}

	@Get('layouts/:id/go-live')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('theme_option.index')
	@ApiOperation({
		operationId: 'builderGoLiveChecks',
		summary: 'What Go Live would change, its checks and speed budget, and who may go live (E1, P6)',
	})
	checks(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined): Promise<GoLiveView> {
		return this.goLive.view(id, principal?.permissions ?? []);
	}

	@Post('layouts/:id/go-live')
	@HttpCode(200)
	@RequirePermissions('page_builder.go_live')
	@ApiOperation({
		operationId: 'builderGoLive',
		summary:
			'Go live now, at a time, or by itself once pictures are ready (E2, E5); 400 go_live_refused lists what holds it',
	})
	go(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(GoLiveRequest)) body: GoLiveRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<GoLiveResponse> {
		return this.goLive.goLive(principal?.userId ?? null, id, body, principal?.permissions ?? []);
	}

	@Get('layouts/:id/history')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('theme_option.index')
	@ApiOperation({ operationId: 'builderHistory', summary: "A layout's saved revisions, newest first (E3, Q12)" })
	history(@Param('id') id: string): Promise<LayoutHistoryResponse> {
		return this.goLive.history(id);
	}

	@Post('layouts/:id/bring-back')
	@HttpCode(200)
	@RequirePermissions('theme_option.edit')
	@ApiOperation({ operationId: 'builderBringBack', summary: 'A saved revision becomes the draft again (E3)' })
	bringBack(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(BringBackRequest)) body: BringBackRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<AdminLayoutView> {
		return this.goLive.bringBack(principal?.userId ?? null, id, body);
	}

	@Post('layouts/:id/review-request')
	@HttpCode(204)
	@RequirePermissions('theme_option.edit')
	@ApiOperation({ operationId: 'builderAskReview', summary: 'Ask the owner and super admins to review (SG-18)' })
	async askReview(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(ReviewRequest)) body: ReviewRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<void> {
		await this.goLive.askReview(principal?.userId ?? null, id, body.note);
	}

	@Delete('layouts/:id/review-request')
	@HttpCode(204)
	@RequirePermissions('page_builder.go_live')
	@ApiOperation({ operationId: 'builderCloseReview', summary: 'Close a review without going live (SG-18)' })
	async closeReview(
		@Param('id') id: string,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<void> {
		await this.goLive.closeReview(principal?.userId ?? null, id, principal?.permissions ?? []);
	}

	@Post('pages/:type/cancel-switch')
	@HttpCode(200)
	@RequirePermissions('page_builder.go_live')
	@ApiOperation({ operationId: 'builderCancelSwitch', summary: 'Take a switch still to come off the schedule (A1)' })
	cancelSwitch(
		@Param('type') type: string,
		@Body(new ZodValidationPipe(CancelSwitchRequest)) body: CancelSwitchRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<AdminBuilderPage> {
		return this.goLive.cancelSwitch(principal?.userId ?? null, type, body);
	}

	@Delete('pages/:type/waiting/:layoutId')
	@RequirePermissions('page_builder.go_live')
	@ApiOperation({ operationId: 'builderCancelWaiting', summary: 'Take off a Go Live waiting for pictures (E5)' })
	cancelWaiting(
		@Param('type') type: string,
		@Param('layoutId') layoutId: string,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<AdminBuilderPage> {
		return this.goLive.cancelWaiting(principal?.userId ?? null, type, layoutId);
	}

	@Post('pages/:type/put-back')
	@HttpCode(200)
	@RequirePermissions('page_builder.go_live')
	@ApiOperation({ operationId: 'builderPutBack', summary: 'Bring back the layout that showed before (SG-15)' })
	putBack(
		@Param('type') type: string,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<AdminBuilderPage> {
		return this.goLive.putBack(principal?.userId ?? null, type);
	}

	@Put('pages/:type/safe-mode')
	@RequirePermissions('page_builder.go_live')
	@ApiOperation({
		operationId: 'builderSafeMode',
		summary: "Put a page on the shop's fixed code, or back on its layouts; super admins only (SG-15)",
	})
	safeMode(
		@Param('type') type: string,
		@Body(new ZodValidationPipe(SafeModeRequest)) body: SafeModeRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<AdminBuilderPage> {
		return this.goLive.safeMode(principal?.userId ?? null, type, body.on);
	}

	@Get('layouts/:id/export')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('theme_option.index')
	@ApiOperation({ operationId: 'builderExport', summary: 'A layout as a file for another environment (SG-22)' })
	async exportLayout(
		@Param('id') id: string,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<LayoutExport> {
		const file = await this.goLive.export(id);
		const name =
			file.name
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-|-$/g, '') || 'layout';
		reply.header('Content-Disposition', `attachment; filename="${name}.layout.json"`);
		return file;
	}

	@Post('pages/:type/import')
	@RequirePermissions('theme_option.edit')
	@ApiOperation({
		operationId: 'builderImport',
		summary: 'A layout file from another environment becomes a new layout of this page (SG-22)',
	})
	importLayout(
		@Param('type') type: string,
		@Body(new ZodValidationPipe(LayoutExport)) body: LayoutExport,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<AdminLayoutView> {
		return this.goLive.import(principal?.userId ?? null, type, body);
	}

	@Get('pages/:type/sales')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('theme_option.index', 'dashboard.revenue')
	@ApiOperation({ operationId: 'builderSales', summary: 'Paid orders while each layout showed (SG-23)' })
	sales(@Param('type') type: string): Promise<PageSalesResponse> {
		return this.goLive.sales(type);
	}

	@Get('alerts')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('theme_option.index')
	@ApiOperation({
		operationId: 'builderAlerts',
		summary: "The bell's Page Builder lines: reviews asked, nightly check (SG-12, SG-18)",
	})
	alerts(@Principal() principal: AuthenticatedPrincipal | undefined): Promise<PageBuilderAlerts> {
		return this.goLive.alerts(principal?.permissions ?? []);
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

/** Preview (Page Builder step 6, FX-5): a one-time code, swapped by the shop's server for a session. */
@ApiTags(API_TAGS.media)
@Audience('admin')
@Controller('admin/page-builder/layouts')
export class AdminPagePreviewController {
	constructor(private readonly preview: PagePreviewService) {}

	@Post(':id/preview-code')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('theme_option.index')
	@ApiOperation({ operationId: 'builderPreviewCode', summary: 'A code for /__preview, used once within a minute' })
	code(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(PreviewCodeRequest)) body: PreviewCodeRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<PreviewCodeResponse> {
		return this.preview.code(principal?.userId ?? null, id, body.revisionId);
	}
}

/** The shop's server swaps a preview code and reads the draft it opens (never cached). */
@ApiTags(API_TAGS.media)
@Public()
@Controller('storefront/preview')
export class StorefrontPreviewController {
	constructor(private readonly preview: PagePreviewService) {}

	@Post('exchange')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	@ApiOperation({ operationId: 'storefrontPreviewExchange', summary: 'Swap a one-time preview code for a session' })
	exchange(
		@Body(new ZodValidationPipe(PreviewExchangeRequest)) body: PreviewExchangeRequest,
	): Promise<PreviewExchangeResponse> {
		return this.preview.exchange(body.code);
	}

	@Get('layout')
	@Header('Cache-Control', 'no-store')
	@Header('X-Robots-Tag', 'noindex')
	@ApiOperation({
		operationId: 'storefrontPreviewLayout',
		summary: 'A draft as the shop draws it, for a preview session',
	})
	layout(@Query(new ZodValidationPipe(PreviewLayoutQuery)) query: PreviewLayoutQuery): Promise<StorefrontPageLayout> {
		return this.preview.layout(query.token, query.locale);
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
