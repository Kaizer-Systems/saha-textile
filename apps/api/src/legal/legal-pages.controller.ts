import { Body, Controller, Get, Header, Param, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	type AdminLegalPage,
	LegalPageWrite,
	type PublicLegalPage,
	PublicLegalPageQuery,
} from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { type AuthenticatedPrincipal, Audience, Public, RequirePermissions } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { LegalPagesService } from './legal-pages.service';

/** Admin › Pages (Legal Pages brief): the four legal pages, read with `page.index`, saved with `page.edit`. */
@ApiTags(API_TAGS.blog)
@Audience('admin')
@Controller('admin/pages')
export class AdminLegalPagesController {
	constructor(private readonly pages: LegalPagesService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('page.index')
	@ApiOperation({
		operationId: 'listLegalPages',
		summary: 'The four legal pages with what each language still misses (P1)',
	})
	list(): Promise<AdminLegalPage[]> {
		return this.pages.list();
	}

	@Get(':slug')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('page.index')
	@ApiOperation({ operationId: 'getLegalPage', summary: 'One legal page for its form (P3)' })
	get(@Param('slug') slug: string): Promise<AdminLegalPage> {
		return this.pages.get(slug);
	}

	@Patch(':slug')
	@RequirePermissions('page.edit')
	@ApiOperation({
		operationId: 'saveLegalPage',
		summary:
			'Save a legal page: Title and Content in every shop language; content cleaned; earlier version kept (P6)',
	})
	save(
		@Param('slug') slug: string,
		@Body(new ZodValidationPipe(LegalPageWrite)) body: LegalPageWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<AdminLegalPage> {
		return this.pages.save(principal?.userId ?? null, slug, body);
	}
}

/** The shop reads one language of a legal page on the server (P8, P9). */
@ApiTags(API_TAGS.blog)
@Public()
@Controller('catalog/pages')
export class PublicLegalPagesController {
	constructor(private readonly pages: LegalPagesService) {}

	@Get(':slug')
	@Header('Cache-Control', 'public, max-age=60')
	@ApiOperation({
		operationId: 'getPublicLegalPage',
		summary: 'One legal page in one language, English where it is empty',
	})
	page(
		@Param('slug') slug: string,
		@Query(new ZodValidationPipe(PublicLegalPageQuery)) query: PublicLegalPageQuery,
	): Promise<PublicLegalPage> {
		return this.pages.publicPage(slug, query.locale);
	}
}
