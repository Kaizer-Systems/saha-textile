import { Body, Controller, Header, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StockAlertWrite } from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { CatalogService } from './catalog.service';

@ApiTags(API_TAGS.catalog)
@Audience('storefront')
@Controller('catalog/products')
export class StockAlertsController {
	constructor(private readonly catalog: CatalogService) {}

	@Post(':idOrSlug/stock-alerts')
	@Header('Cache-Control', 'no-store')
	@ApiOperation({ operationId: 'requestStockAlert', summary: 'Ask to be told when a variant can be bought' })
	stockAlert(
		@Param('idOrSlug') idOrSlug: string,
		@Body(new ZodValidationPipe(StockAlertWrite)) body: StockAlertWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.catalog.requestStockAlert(idOrSlug, body.variantSku, principal?.userId ?? null);
	}
}
