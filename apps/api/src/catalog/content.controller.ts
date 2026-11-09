import { randomUUID } from 'node:crypto';

import { Body, Controller, Delete, Get, Header, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminQuestionListQuery, AnswerWrite, FaqEntry, FaqWrite, QuestionWrite } from '@saha-textile/contracts';
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
	@ApiOperation({ operationId: 'adminListFaq', summary: 'Every FAQ entry, any status' })
	list() {
		return this.content.adminFaq();
	}

	@Delete(':id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('faq.destroy')
	@ApiOperation({ operationId: 'adminRemoveFaq', summary: 'Delete one FAQ entry' })
	remove(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.content.removeFaq(id, principal?.userId ?? null);
	}

	@Post()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('faq.edit')
	@ApiOperation({ operationId: 'adminSaveFaq', summary: 'Create or update one FAQ entry' })
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
	@ApiOperation({ operationId: 'adminListQuestions', summary: 'Product questions, filtered and paged' })
	list(@Query(new ZodValidationPipe(AdminQuestionListQuery)) query: AdminQuestionListQuery) {
		return this.content.adminQuestions(query);
	}

	@Post(':id/reject')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('question_and_answer.edit')
	@ApiOperation({ operationId: 'adminRejectQuestion', summary: 'Reject a product question' })
	reject(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.content.reject(id, principal?.userId ?? null);
	}

	@Delete(':id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('question_and_answer.destroy')
	@ApiOperation({ operationId: 'adminRemoveQuestion', summary: 'Delete a product question' })
	remove(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.content.removeQuestion(id, principal?.userId ?? null);
	}

	@Post(':id/answer')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('question_and_answer.edit')
	@ApiOperation({ operationId: 'adminAnswerQuestion', summary: 'Answer a product question and publish it' })
	answer(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(AnswerWrite)) body: AnswerWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.content.answer(id, body.answer, principal?.userId ?? null);
	}
}
