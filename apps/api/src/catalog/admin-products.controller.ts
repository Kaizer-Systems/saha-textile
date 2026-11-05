import { Body, Controller, Get, Header, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminProductListQuery, DiscontinueProduct, ProductMerchandisingWrite } from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { CatalogService } from './catalog.service';

@ApiTags(API_TAGS.catalog)
@Audience('admin')
@Controller('admin/catalog/products')
export class AdminProductsController {
	constructor(private readonly catalog: CatalogService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('product.index')
	@ApiOperation({ operationId: 'listAdminProducts', summary: 'List products for the admin, every status' })
	list(@Query(new ZodValidationPipe(AdminProductListQuery)) query: AdminProductListQuery) {
		return this.catalog.adminList(query);
	}

	@Get('replacement-targets')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('product.edit')
	@ApiOperation({
		operationId: 'listReplacementTargets',
		summary: 'Live products and collections a discontinued product may point to',
	})
	replacementTargets() {
		return this.catalog.replacementTargets();
	}

	@Get(':idOrSlug')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('product.index')
	@ApiOperation({ operationId: 'getAdminProduct', summary: 'Read one product and its variants for the admin form' })
	detail(@Param('idOrSlug') idOrSlug: string) {
		return this.catalog.adminDetail(idOrSlug);
	}

	@Post(':idOrSlug/discontinue')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('product.edit')
	@ApiOperation({ operationId: 'discontinueProduct', summary: 'Discontinue a product and write its redirect' })
	discontinue(
		@Param('idOrSlug') idOrSlug: string,
		@Body(new ZodValidationPipe(DiscontinueProduct)) body: DiscontinueProduct,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.catalog.discontinue(idOrSlug, body.replacementPath ?? null, principal?.userId ?? null);
	}

	@Post(':idOrSlug')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('product.edit')
	@ApiOperation({ operationId: 'updateProductMerchandising', summary: 'Save the product form fields' })
	update(
		@Param('idOrSlug') idOrSlug: string,
		@Body(new ZodValidationPipe(ProductMerchandisingWrite)) body: ProductMerchandisingWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.catalog.updateMerchandising(idOrSlug, body, principal?.userId ?? null);
	}
}
