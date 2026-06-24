import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CatalogService } from './catalog.service';

@ApiTags('catalog')
@Controller('catalog/categories')
export class CategoriesController {
	constructor(private readonly catalog: CatalogService) {}

	@Get()
	@ApiOperation({ summary: 'Get the full category taxonomy tree' })
	tree() {
		return this.catalog.getCategoryTree();
	}

	@Get(':slug')
	@ApiOperation({ summary: 'Get a single category by slug' })
	get(@Param('slug') slug: string) {
		return this.catalog.getCategory(slug);
	}
}
