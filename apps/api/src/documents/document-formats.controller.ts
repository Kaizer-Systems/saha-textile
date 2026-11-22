import { Body, Controller, Get, Header, HttpCode, Param, Post, Put, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DocumentFormatCreate, DocumentFormatPreview, DocumentFormatWrite } from '@saha-textile/contracts';
import type { FastifyReply } from 'fastify';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { DocumentFormatsService } from './document-formats.service';

/** Settings › Document formats and the format builder (bundle builder brief F01–F05, approved 2026-11-22). */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/document-formats')
export class DocumentFormatsController {
	constructor(private readonly formats: DocumentFormatsService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('setting.index')
	@ApiOperation({
		operationId: 'listDocumentFormats',
		summary: 'Every document with its formats and what it may show',
	})
	list() {
		return this.formats.view();
	}

	@Get(':id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('setting.index')
	@ApiOperation({ operationId: 'getDocumentFormat', summary: 'One format, as the builder opens it' })
	one(@Param('id') id: string) {
		return this.formats.one(id);
	}

	@Post()
	@HttpCode(200)
	@RequirePermissions('setting.edit')
	@ApiOperation({ operationId: 'createDocumentFormat', summary: 'Make new layout: from our format or blank (F04)' })
	create(
		@Body(new ZodValidationPipe(DocumentFormatCreate)) body: DocumentFormatCreate,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.formats.create(body, principal?.userId ?? 'admin');
	}

	@Put(':id')
	@RequirePermissions('setting.edit')
	@ApiOperation({ operationId: 'saveDocumentFormat', summary: 'Save a format after its document’s checks (F05)' })
	save(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(DocumentFormatWrite)) body: DocumentFormatWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.formats.update(id, body, principal?.userId ?? 'admin');
	}

	@Post(':id/duplicate')
	@HttpCode(200)
	@RequirePermissions('setting.edit')
	@ApiOperation({ operationId: 'duplicateDocumentFormat', summary: 'Copy a format, switched off' })
	duplicate(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal) {
		return this.formats.duplicate(id, principal?.userId ?? 'admin');
	}

	@Post(':id/switch-on')
	@HttpCode(200)
	@RequirePermissions('setting.edit')
	@ApiOperation({
		operationId: 'switchDocumentFormatOn',
		summary: 'Use this format; the document’s other one goes off (F02)',
	})
	switchOn(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal) {
		return this.formats.switchOn(id, principal?.userId ?? 'admin');
	}

	@Post(':id/switch-off')
	@HttpCode(200)
	@RequirePermissions('setting.edit')
	@ApiOperation({
		operationId: 'switchDocumentFormatOff',
		summary: 'Always refused with the reason: one active format per document (F03)',
	})
	switchOff(@Param('id') id: string) {
		return this.formats.switchOff(id);
	}

	@Post(':id/preview')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('setting.index')
	@ApiOperation({
		operationId: 'previewDocumentFormat',
		summary: 'The builder’s live preview: unsaved blocks drawn with the example (HTML)',
	})
	async preview(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(DocumentFormatPreview)) body: DocumentFormatPreview,
		@Res() reply: FastifyReply,
	) {
		const html = await this.formats.previewHtml(id, body);
		void reply.header('Content-Type', 'text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html);
	}

	@Get(':id/pdf')
	@RequirePermissions('setting.index')
	@ApiOperation({ operationId: 'documentFormatPdf', summary: 'The saved format with the example, as a PDF' })
	async pdf(@Param('id') id: string, @Res() reply: FastifyReply) {
		this.send(reply, await this.formats.previewPdf(id, null));
	}

	@Post(':id/pdf')
	@HttpCode(200)
	@RequirePermissions('setting.index')
	@ApiOperation({ operationId: 'documentFormatDraftPdf', summary: 'Preview PDF: unsaved blocks with the example' })
	async draftPdf(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(DocumentFormatPreview)) body: DocumentFormatPreview,
		@Res() reply: FastifyReply,
	) {
		this.send(reply, await this.formats.previewPdf(id, body));
	}

	private send(reply: FastifyReply, file: { fileName: string; data: Uint8Array }): void {
		void reply
			.header('Content-Type', 'application/pdf')
			.header('Content-Disposition', `inline; filename="${file.fileName.replace(/[^\w .()-]/g, '')}"`)
			.header('Cache-Control', 'no-store')
			.send(Buffer.from(file.data));
	}
}
