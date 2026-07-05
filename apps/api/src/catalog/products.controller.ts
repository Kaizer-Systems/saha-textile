import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ProductStatus } from '@saha-textile/contracts';
import type { ProductFilter } from '@saha-textile/core-domain';

import { CatalogService } from './catalog.service';

@ApiTags('catalog')
@Controller('catalog/products')
export class ProductsController {
	constructor(private readonly catalog: CatalogService) {}

	@Get()
	@ApiOperation({ summary: 'List published products with filtering and pagination' })
	@ApiQuery({ name: 'page', required: false, type: Number })
	@ApiQuery({ name: 'pageSize', required: false, type: Number })
	@ApiQuery({ name: 'categoryId', required: false })
	@ApiQuery({ name: 'tag', required: false })
	@ApiQuery({ name: 'search', required: false })
	@ApiQuery({ name: 'status', required: false, enum: ProductStatus.options })
	@ApiOkResponse({ description: 'Paginated list of products' })
	list(
		@Query('page') page?: string,
		@Query('pageSize') pageSize?: string,
		@Query('categoryId') categoryId?: string,
		@Query('tag') tag?: string,
		@Query('search') search?: string,
		@Query('status') status?: string,
	) {
		const filter: ProductFilter = {
			page: page ? Number(page) : undefined,
			pageSize: pageSize ? Number(pageSize) : undefined,
			categoryId,
			tag,
			search,
			status: ProductStatus.safeParse(status).success ? (status as ProductFilter['status']) : undefined,
		};
		return this.catalog.listProducts(filter);
	}

	@Get(':idOrSlug')
	@ApiOperation({ summary: 'Get a single product by id or slug' })
	get(@Param('idOrSlug') idOrSlug: string) {
		return this.catalog.getProduct(idOrSlug);
	}
}
