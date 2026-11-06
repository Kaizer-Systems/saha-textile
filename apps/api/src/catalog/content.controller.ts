import { randomUUID } from 'node:crypto';

import { Body, Controller, Delete, Get, Header, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AnswerWrite, FaqEntry, FaqWrite, QuestionWrite } from '@saha-textile/contracts';
import type { FastifyRequest } from 'fastify';

import { Principal } from '../auth/ownership';
import { Audience, Public, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { CatalogRateLimit } from './catalog-rate-limit';
import { ContentService } from './content.service';

@ApiTags(API_TAGS.catalog)
@Controller('catalog/faq')
export class FaqController {
	constructor(private readonly content: ContentService) {}

	@Public()
	@Get()
	@Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
	@ApiOperation({ operationId: 'catalogFaq', summary: 'Live FAQ entries for one page' })
	list(@Query('productId') productId?: string, @Query('categoryId') categoryId?: string) {
		return this.content.publicFaq({ productId, categoryId });
	}
}

@ApiTags(API_TAGS.catalog)
@Audience('admin')
@Controller('admin/catalog/faq')
export class AdminFaqController {
	constructor(private readonly content: ContentService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('faq.index')
	list() {
		return this.content.adminFaq();
	}

	@Delete(':id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('faq.destroy')
	remove(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.content.removeFaq(id, principal?.userId ?? null);
	}

	@Post()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('faq.edit')
	save(
		@Body(new ZodValidationPipe(FaqWrite)) body: FaqWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.content.saveFaq(
			FaqEntry.parse({ ...body, id: body.id ?? `faq_${randomUUID()}` }),
			principal?.userId ?? null,
		);
	}
}

@ApiTags(API_TAGS.catalog)
@Controller('catalog/questions')
export class QuestionsController {
	constructor(
		private readonly content: ContentService,
		private readonly limits: CatalogRateLimit,
	) {}

	@Public()
	@Get()
	@Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
	@ApiOperation({ operationId: 'catalogQuestions', summary: 'Answered questions for one product' })
	list(@Query('productSlug') productSlug = '') {
		return this.content.publicQuestions(productSlug);
	}

	@Public()
	@Post()
	@Header('Cache-Control', 'no-store')
	@ApiOperation({ operationId: 'askProductQuestion', summary: 'Ask a product question' })
	async ask(
		@Body(new ZodValidationPipe(QuestionWrite)) body: QuestionWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Req() request: FastifyRequest,
	) {
		await this.limits.enforce('product_question', {
			identifier: principal?.userId ?? body.askerEmail.toLowerCase(),
			ip: request.ip,
		});
		return this.content.ask(body, principal?.userId ?? null);
	}
}

@ApiTags(API_TAGS.catalog)
@Audience('admin')
@Controller('admin/catalog/questions')
export class AdminQuestionsController {
	constructor(private readonly content: ContentService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('question_and_answer.index')
	list() {
		return this.content.adminQuestions();
	}

	@Post(':id/answer')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('question_and_answer.edit')
	answer(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(AnswerWrite)) body: AnswerWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.content.answer(id, body.answer, principal?.userId ?? null);
	}
}
