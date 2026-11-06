import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AdminAddonTemplatesController } from './admin-addon-templates.controller';
import { AdminFaqController, AdminQuestionsController, FaqController, QuestionsController } from './content.controller';
import { AdminProductsController } from './admin-products.controller';
import { AdminRedirectsController } from './admin-redirects.controller';
import { CatalogPublicService } from './catalog-public.service';
import { CatalogRateLimit } from './catalog-rate-limit';
import { CatalogSearchController } from './catalog-search.controller';
import { CatalogService } from './catalog.service';
import { CategoriesController } from './categories.controller';
import { ContentService } from './content.service';
import { ProductsController } from './products.controller';
import { RecentPurchasesService } from './recent-purchases.service';
import { StockAlertsController } from './stock-alerts.controller';
import { StorefrontCatalogController } from './storefront-catalog.controller';

@Module({
	imports: [AuthModule],
	controllers: [
		ProductsController,
		CategoriesController,
		AdminRedirectsController,
		AdminProductsController,
		AdminAddonTemplatesController,
		StorefrontCatalogController,
		StockAlertsController,
		CatalogSearchController,
		FaqController,
		AdminFaqController,
		QuestionsController,
		AdminQuestionsController,
	],
	providers: [CatalogService, CatalogPublicService, CatalogRateLimit, ContentService, RecentPurchasesService],
})
export class CatalogModule {}
