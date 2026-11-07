import { Controller, Get, Param, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CatalogEtagInterceptor } from './catalog-etag.interceptor';
import { CatalogLocaleInterceptor } from './catalog-locale';
import { CatalogPublicService } from './catalog-public.service';
import { CatalogService } from './catalog.service';
import { Public } from '../auth/session.guard';
import { API_TAGS } from '../openapi-tags';

@ApiTags(API_TAGS.catalog)
@Controller('catalog/categories')
/** Public taxonomy. */
@Public()
export class CategoriesController {
	constructor(
		private readonly catalog: CatalogService,
		private readonly publicCatalog: CatalogPublicService,
	) {}

	@Get()
	@ApiOperation({ operationId: 'getCategoryTree', summary: 'Get the full category taxonomy tree' })
	tree() {
		return this.catalog.getCategoryTree();
	}

	@Get('menu')
	@UseInterceptors(CatalogLocaleInterceptor, CatalogEtagInterceptor)
	@ApiOperation({ operationId: 'getCategoryMenu', summary: 'The shop menu, in the language asked for' })
	menu() {
		return this.publicCatalog.menu();
	}

	@Get(':slug')
	@ApiOperation({ operationId: 'getCategory', summary: 'Get a single category by slug' })
	get(@Param('slug') slug: string) {
		return this.catalog.getCategory(slug);
	}
}
