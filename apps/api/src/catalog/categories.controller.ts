import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CatalogService } from './catalog.service';
import { Public } from '../auth/session.guard';
import { API_TAGS } from '../openapi-tags';

@ApiTags(API_TAGS.catalog)
@Controller('catalog/categories')
/** Public taxonomy. */
@Public()
export class CategoriesController {
	constructor(private readonly catalog: CatalogService) {}

	@Get()
	@ApiOperation({ operationId: 'getCategoryTree', summary: 'Get the full category taxonomy tree' })
	tree() {
		return this.catalog.getCategoryTree();
	}

	@Get(':slug')
	@ApiOperation({ operationId: 'getCategory', summary: 'Get a single category by slug' })
	get(@Param('slug') slug: string) {
		return this.catalog.getCategory(slug);
	}
}
