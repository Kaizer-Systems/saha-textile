import { Controller, Get, Header, Query, Req, ServiceUnavailableException, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CatalogSearchQuery } from '@saha-textile/contracts';
import type { FastifyRequest } from 'fastify';
import { SearchUnavailableError, type SearchPort } from '@saha-textile/core-domain';
import { Inject } from '@nestjs/common';

import { Public } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SEARCH_PORT } from '../infra/tokens';
import { API_TAGS } from '../openapi-tags';
import { CatalogLocaleInterceptor } from './catalog-locale';
import { CatalogPublicService } from './catalog-public.service';
import { CatalogRateLimit } from './catalog-rate-limit';

@ApiTags(API_TAGS.catalog)
@Controller('catalog/search')
@Public()
@UseInterceptors(CatalogLocaleInterceptor)
export class CatalogSearchController {
	constructor(
		@Inject(SEARCH_PORT) private readonly search: SearchPort,
		private readonly catalog: CatalogPublicService,
		private readonly limits: CatalogRateLimit,
	) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@ApiOperation({ operationId: 'catalogSearch', summary: 'Typeahead and search' })
	async searchProducts(
		@Query(new ZodValidationPipe(CatalogSearchQuery)) query: CatalogSearchQuery,
		@Req() request: FastifyRequest,
	) {
		await this.limits.enforce('catalog_search', { ip: request.ip });
		try {
			const { q, categoryId } = query;
			const page = await this.search.search({ q, ...(categoryId ? { categoryId } : {}), page: 1, pageSize: 24 });
			return {
				items: await this.catalog.cardsForIds(page.items.map((product) => product.id)),
				total: page.total,
			};
		} catch (error) {
			if (error instanceof SearchUnavailableError) {
				throw new ServiceUnavailableException('search_unavailable');
			}
			throw error;
		}
	}
}
