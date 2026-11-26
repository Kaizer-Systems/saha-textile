import {
	Body,
	Controller,
	Get,
	Header,
	HttpCode,
	HttpStatus,
	Inject,
	Post,
	Query,
	Req,
	ServiceUnavailableException,
	UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	CatalogSearchClick,
	CatalogSearchPage,
	CatalogSearchQuery,
	CatalogSearchTrending,
	CatalogSearchTrendingQuery,
} from '@saha-textile/contracts';
import { SearchUnavailableError, type SearchPort } from '@saha-textile/core-domain';
import type { FastifyRequest } from 'fastify';

import { Public } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SEARCH_PORT } from '../infra/tokens';
import { API_TAGS } from '../openapi-tags';
import { CatalogLocaleInterceptor } from './catalog-locale';
import { CatalogPublicService } from './catalog-public.service';
import { CatalogRateLimit } from './catalog-rate-limit';
import { SearchInsightsService } from './search-insights.service';

@ApiTags(API_TAGS.catalog)
@Controller('catalog/search')
@Public()
@UseInterceptors(CatalogLocaleInterceptor)
export class CatalogSearchController {
	constructor(
		@Inject(SEARCH_PORT) private readonly search: SearchPort,
		private readonly catalog: CatalogPublicService,
		private readonly limits: CatalogRateLimit,
		private readonly insights: SearchInsightsService,
	) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@ApiOperation({ operationId: 'catalogSearch', summary: 'Typeahead and search results, one page at a time' })
	async searchProducts(
		@Query(new ZodValidationPipe(CatalogSearchQuery)) query: CatalogSearchQuery,
		@Req() request: FastifyRequest,
	): Promise<CatalogSearchPage> {
		await this.limits.enforce('catalog_search', { ip: request.ip });
		const { q, categoryId, page, pageSize, source } = query;
		try {
			const found = await this.search.search({ q, ...(categoryId ? { categoryId } : {}), page, pageSize });
			// A committed search counts once, on its first page; typeahead and paging never do.
			if (source === 'page' && page === 1) await this.insights.recordSearch(q, found.total);
			return CatalogSearchPage.parse({
				items: await this.catalog.cardsForIds(found.items.map((product) => product.id)),
				total: found.total,
				page,
				pageSize,
			});
		} catch (error) {
			if (error instanceof SearchUnavailableError) {
				throw new ServiceUnavailableException('search_unavailable');
			}
			throw error;
		}
	}

	@Post('clicks')
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ operationId: 'catalogSearchClick', summary: 'Count a product opened from search results' })
	async recordClick(
		@Body(new ZodValidationPipe(CatalogSearchClick)) body: CatalogSearchClick,
		@Req() request: FastifyRequest,
	): Promise<void> {
		await this.limits.enforce('search_click', { ip: request.ip });
		await this.insights.recordClick(body.q, body.productId);
	}

	@Get('trending')
	@Header('Cache-Control', 'public, max-age=300')
	@ApiOperation({ operationId: 'catalogSearchTrending', summary: 'Products most opened from search lately' })
	async trending(
		@Query(new ZodValidationPipe(CatalogSearchTrendingQuery)) query: CatalogSearchTrendingQuery,
		@Req() request: FastifyRequest,
	): Promise<CatalogSearchTrending> {
		await this.limits.enforce('catalog_search', { ip: request.ip });
		return CatalogSearchTrending.parse(await this.insights.trending(query.limit));
	}
}
