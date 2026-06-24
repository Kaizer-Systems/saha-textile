import { Module } from '@nestjs/common';

import { CatalogService } from './catalog.service';
import { CategoriesController } from './categories.controller';
import { ProductsController } from './products.controller';

@Module({
	controllers: [ProductsController, CategoriesController],
	providers: [CatalogService],
})
export class CatalogModule {}
