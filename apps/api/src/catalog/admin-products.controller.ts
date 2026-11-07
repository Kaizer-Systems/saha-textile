import { Body, Controller, Get, Header, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	AdminProductListQuery,
	DiscontinueProduct,
	ProductBundleWrite,
	ProductCreate,
	ProductMerchandisingWrite,
} from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { CatalogService } from './catalog.service';
import { ProductBuilderService } from './product-builder.service';

@ApiTags(API_TAGS.catalog)
@Audience('admin')
@Controller('admin/catalog/products')
export class AdminProductsController {
	constructor(
		private readonly catalog: CatalogService,
		private readonly builder: ProductBuilderService,
	) {}

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

	@Post()
	@HttpCode(200)
	@RequirePermissions('product.create')
	@ApiOperation({ operationId: 'createProduct', summary: 'Add a product; it starts disabled' })
	create(
		@Body(new ZodValidationPipe(ProductCreate)) body: ProductCreate,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.builder.create(body, principal?.userId ?? null);
	}

	@Post(':idOrSlug/go-live')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('product.edit')
	@ApiOperation({
		operationId: 'goLiveProduct',
		summary: 'Put a product on sale, or list what stops it. The form and the list both call this',
	})
	goLive(@Param('idOrSlug') idOrSlug: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.builder.goLive(idOrSlug, principal?.userId ?? null);
	}

	@Get(':idOrSlug/bundle')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('product.index')
	@ApiOperation({ operationId: 'getProductBundle', summary: "Read a bundle product's groups" })
	bundle(@Param('idOrSlug') idOrSlug: string) {
		return this.builder.bundle(idOrSlug);
	}

	@Post(':idOrSlug/bundle')
	@HttpCode(200)
	@RequirePermissions('product.edit')
	@ApiOperation({ operationId: 'saveProductBundle', summary: "Save a bundle product's groups" })
	saveBundle(
		@Param('idOrSlug') idOrSlug: string,
		@Body(new ZodValidationPipe(ProductBundleWrite)) body: ProductBundleWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.builder.saveBundle(idOrSlug, body, principal?.userId ?? null);
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
