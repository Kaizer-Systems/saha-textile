import { Controller, Get, Header, Query, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CatalogCardsQuery, CatalogPlacementQuery, CatalogSeoRouteQuery } from '@saha-textile/contracts';

import { Public } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { CatalogEtagInterceptor } from './catalog-etag.interceptor';
import { CatalogLocaleInterceptor } from './catalog-locale';
import { CatalogPublicService } from './catalog-public.service';
import { RecentPurchasesService } from './recent-purchases.service';

/**
 * Public catalogue reads for the storefront. Admin writes stay on `admin/catalog`.
 * Responses are cacheable. The redirect list is not: it is `no-store`.
 */
@ApiTags(API_TAGS.catalog)
@Controller('catalog')
@Public()
@UseInterceptors(CatalogLocaleInterceptor, CatalogEtagInterceptor)
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
	placement(@Query(new ZodValidationPipe(CatalogPlacementQuery)) query: CatalogPlacementQuery) {
		return this.catalog.placement(query);
	}

	@Get('cards')
	@Header('Cache-Control', 'no-store')
	@ApiOperation({ operationId: 'catalogCards', summary: 'Live cards for a personal slug list' })
	cards(@Query(new ZodValidationPipe(CatalogCardsQuery)) query: CatalogCardsQuery) {
		return this.catalog.cardsForSlugs([query.slug ?? []].flat());
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

	@Get('seo-route')
	@Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
	@ApiOperation({ operationId: 'catalogSeoRoute', summary: 'Head data for one public address' })
	async seoRoute(@Query(new ZodValidationPipe(CatalogSeoRouteQuery)) query: CatalogSeoRouteQuery) {
		return { route: await this.catalog.seoRoute(query.path, query.locale) };
	}

	@Get('sitemap')
	@Header('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')
	@ApiOperation({ operationId: 'catalogSitemap', summary: 'Indexable addresses for the sitemap' })
	async sitemap() {
		return { paths: await this.catalog.sitemapPaths() };
	}

	@Get('live-paths')
	@Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
	@ApiOperation({ operationId: 'catalogLivePaths', summary: 'Live product slugs and category paths' })
	livePaths() {
		return this.catalog.livePaths();
	}
}
