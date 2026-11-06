import { Controller, Get, Header, Query, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/session.guard';
import { API_TAGS } from '../openapi-tags';
import { CatalogEtagInterceptor } from './catalog-etag.interceptor';
import { CatalogPublicService } from './catalog-public.service';
import { RecentPurchasesService } from './recent-purchases.service';

/**
 * Public catalogue reads for the storefront. Admin writes stay on `admin/catalog`.
 * Responses are cacheable. The redirect list is not: it is `no-store`.
 */
@ApiTags(API_TAGS.catalog)
@Controller('catalog')
@Public()
@UseInterceptors(CatalogEtagInterceptor)
export class StorefrontCatalogController {
	constructor(
		private readonly catalog: CatalogPublicService,
		private readonly recentPurchases: RecentPurchasesService,
	) {}

	@Get('home')
	@Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
	@ApiOperation({ operationId: 'catalogHome', summary: 'Homepage rails' })
	home() {
		return this.catalog.home();
	}

	@Get('placements')
	@Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
	@ApiOperation({ operationId: 'catalogPlacement', summary: 'Category listing by placement path' })
	placement(
		@Query('path') path = '',
		@Query('page') page?: string,
		@Query('pageSize') pageSize?: string,
		@Query('attribute') attribute?: string,
	) {
		return this.catalog.placement(path, page ? Number(page) : 1, pageSize ? Number(pageSize) : 24, attribute);
	}

	@Get('cards')
	@Header('Cache-Control', 'no-store')
	@ApiOperation({ operationId: 'catalogCards', summary: 'Live cards for a personal slug list' })
	cards(@Query('slug') slug?: string | string[]) {
		const slugs = Array.isArray(slug) ? slug : slug ? [slug] : [];
		return this.catalog.cardsForSlugs(slugs);
	}

	@Get('recent-purchases')
	@Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
	@ApiOperation({
		operationId: 'catalogRecentPurchases',
		summary: 'Real sales from the last day, without buyer data',
	})
	recent() {
		return this.recentPurchases.list();
	}

	@Get('live-paths')
	@Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
	@ApiOperation({ operationId: 'catalogLivePaths', summary: 'Live product slugs and category paths' })
	livePaths() {
		return this.catalog.livePaths();
	}
}
