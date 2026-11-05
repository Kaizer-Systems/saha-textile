import { Controller, Get, Header, Param, Query, UseInterceptors } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { publicRedirectView, type ProductFilter } from '@saha-textile/core-domain';

import { CatalogPublicService } from './catalog-public.service';
import { CatalogService } from './catalog.service';
import { Public } from '../auth/session.guard';
import { API_TAGS } from '../openapi-tags';
import { CatalogEtagInterceptor } from './catalog-etag.interceptor';

/**
 * PUBLIC catalog surface. It never accepts a `status` filter: only `live` products
 * are storefront-queryable (owner lock), and honouring a client-supplied status here
 * would let anyone read drafts and disabled products. Admin status filtering belongs
 * on the authenticated admin catalog surface (Chunk F), which passes `audience: 'admin'`.
 */
@ApiTags(API_TAGS.catalog)
@Controller('catalog/products')
/** Public catalog: browsing never requires an account (visibility is enforced by CatalogAudience). */
@Public()
@UseInterceptors(CatalogEtagInterceptor)
export class ProductsController {
	constructor(
		private readonly catalog: CatalogService,
		private readonly publicCatalog: CatalogPublicService,
	) {}

	@Get()
	@Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
	@ApiOperation({ operationId: 'listProducts', summary: 'List live products with filtering and pagination' })
	@ApiQuery({ name: 'page', required: false, type: Number })
	@ApiQuery({ name: 'pageSize', required: false, type: Number })
	@ApiQuery({ name: 'categoryId', required: false })
	@ApiQuery({ name: 'tag', required: false })
	@ApiQuery({ name: 'search', required: false })
	@ApiOkResponse({ description: 'Paginated list of live products' })
	list(
		@Query('page') page?: string,
		@Query('pageSize') pageSize?: string,
		@Query('categoryId') categoryId?: string,
		@Query('tag') tag?: string,
		@Query('search') search?: string,
	) {
		const filter: ProductFilter = {
			audience: 'public',
			page: page ? Number(page) : undefined,
			pageSize: pageSize ? Number(pageSize) : undefined,
			categoryId,
			tag,
			search,
		};
		return this.catalog.listProducts(filter);
	}

	@Get('legacy-redirects')
	@Header('Cache-Control', 'no-store')
	@ApiOperation({ operationId: 'listLegacyRedirects', summary: 'Redirect rows for the storefront resolver' })
	async legacyRedirects() {
		const rows = await this.catalog.listRedirects();
		return rows.map((row) => publicRedirectView(row));
	}

	@Get(':idOrSlug/relations')
	@Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
	@ApiOperation({
		operationId: 'productRelations',
		summary: 'Saved related, upsell, cross-sell, and bought-together cards',
	})
	relations(@Param('idOrSlug') idOrSlug: string) {
		return this.publicCatalog.relationCards(idOrSlug);
	}

	@Get(':idOrSlug/gallery')
	@Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
	@ApiOperation({ operationId: 'getProductGallery', summary: 'Gallery frames for quick view and the product page' })
	gallery(@Param('idOrSlug') idOrSlug: string) {
		return this.publicCatalog.gallery(idOrSlug);
	}

	@Get(':idOrSlug/view')
	@Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
	@ApiOperation({ operationId: 'getProductView', summary: 'Card and product-page read model for one live product' })
	@ApiQuery({ name: 'variant', required: false })
	view(@Param('idOrSlug') idOrSlug: string, @Query('variant') variant?: string) {
		return this.publicCatalog.page(idOrSlug, variant);
	}

	@Get(':idOrSlug')
	@ApiOperation({ operationId: 'getProduct', summary: 'Get a single product by id or slug' })
	get(@Param('idOrSlug') idOrSlug: string) {
		return this.catalog.getProduct(idOrSlug);
	}
}
