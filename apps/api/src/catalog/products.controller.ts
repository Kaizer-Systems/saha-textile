import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { ProductFilter } from '@saha-textile/core-domain';

import { CatalogService } from './catalog.service';
import { Public } from '../auth/session.guard';
import { API_TAGS } from '../openapi-tags';

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
export class ProductsController {
	constructor(private readonly catalog: CatalogService) {}

	@Get()
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

	@Get(':idOrSlug')
	@ApiOperation({ operationId: 'getProduct', summary: 'Get a single product by id or slug' })
	get(@Param('idOrSlug') idOrSlug: string) {
		return this.catalog.getProduct(idOrSlug);
	}
}
