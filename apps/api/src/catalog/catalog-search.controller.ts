import { Controller, Get, Header, Query, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SearchUnavailableError, type SearchPort } from '@saha-textile/core-domain';
import { Inject } from '@nestjs/common';

import { Public } from '../auth/session.guard';
import { SEARCH_PORT } from '../infra/tokens';
import { API_TAGS } from '../openapi-tags';
import { CatalogPublicService } from './catalog-public.service';

@ApiTags(API_TAGS.catalog)
@Controller('catalog/search')
@Public()
export class CatalogSearchController {
	constructor(
		@Inject(SEARCH_PORT) private readonly search: SearchPort,
		private readonly catalog: CatalogPublicService,
	) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@ApiOperation({ operationId: 'catalogSearch', summary: 'Typeahead and search' })
	async searchProducts(@Query('q') q = '', @Query('categoryId') categoryId?: string) {
		try {
			const page = await this.search.search({ q, categoryId, page: 1, pageSize: 24 });
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
