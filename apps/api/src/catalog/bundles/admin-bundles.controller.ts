import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BundleDetailsWrite, BundlePriceMethodWrite, ProductBundleWrite } from '@saha-textile/contracts';

import { Principal } from '../../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../../auth/session.guard';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { API_TAGS } from '../../openapi-tags';
import { ProductBuilderService } from '../product-builder.service';
import { BundleAdminService } from './bundle-admin.service';

/** The bundle builder page (bundle builder brief, approved 2026-11-22; V1 option 1). */
@ApiTags(API_TAGS.catalog)
@Audience('admin')
@Controller('admin/catalog/products/:idOrSlug/bundle')
export class AdminBundleBuilderController {
	constructor(
		private readonly bundles: BundleAdminService,
		private readonly builder: ProductBuilderService,
	) {}

	@Get('builder')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('product.index')
	@ApiOperation({
		operationId: 'getBundleBuilder',
		summary: 'Open a bundle in the builder: its tabs, items, methods and checks',
	})
	view(@Param('idOrSlug') idOrSlug: string) {
		return this.bundles.view(idOrSlug);
	}

	@Post('draft')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('product.edit')
	@ApiOperation({
		operationId: 'draftBundle',
		summary: 'Work a bundle out without saving: the live preview and checks',
	})
	draft(
		@Param('idOrSlug') idOrSlug: string,
		@Body(new ZodValidationPipe(ProductBundleWrite)) body: ProductBundleWrite,
	) {
		return this.bundles.draft(idOrSlug, body);
	}

	@Put('build')
	@HttpCode(200)
	@RequirePermissions('product.edit')
	@ApiOperation({
		operationId: 'saveBundleBuild',
		summary: "Save a bundle's levels, extras and price rules; its photos follow",
	})
	async build(
		@Param('idOrSlug') idOrSlug: string,
		@Body(new ZodValidationPipe(ProductBundleWrite)) body: ProductBundleWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		const saved = await this.builder.saveBundle(idOrSlug, body, principal?.userId ?? null);
		await this.bundles.syncPhotos(saved.productId);
		return this.bundles.view(idOrSlug);
	}

	@Put('details')
	@HttpCode(200)
	@RequirePermissions('product.edit')
	@ApiOperation({ operationId: 'saveBundleDetails', summary: "Save a bundle's Details, SEO, FAQ's and Status tabs" })
	details(
		@Param('idOrSlug') idOrSlug: string,
		@Body(new ZodValidationPipe(BundleDetailsWrite)) body: BundleDetailsWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.bundles.saveDetails(idOrSlug, body, principal?.userId ?? null);
	}
}

/** Products › Bundle price methods: the "Set price is" list, made in the method builder (owner, 22 Nov 2026). */
@ApiTags(API_TAGS.catalog)
@Audience('admin')
@Controller('admin/catalog/bundle-price-methods')
export class AdminBundlePriceMethodsController {
	constructor(private readonly bundles: BundleAdminService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('product.index')
	@ApiOperation({
		operationId: 'listBundlePriceMethods',
		summary: 'Every price method, with how many bundles use it',
	})
	list() {
		return this.bundles.methodRows();
	}

	@Get(':id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('product.index')
	@ApiOperation({ operationId: 'getBundlePriceMethod', summary: 'One price method for its builder' })
	one(@Param('id') id: string) {
		return this.bundles.method(id);
	}

	@Post()
	@HttpCode(200)
	@RequirePermissions('product.edit')
	@ApiOperation({ operationId: 'createBundlePriceMethod', summary: 'Add a price method' })
	create(
		@Body(new ZodValidationPipe(BundlePriceMethodWrite)) body: BundlePriceMethodWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.bundles.createMethod(body, principal?.userId ?? null);
	}

	@Put(':id')
	@HttpCode(200)
	@RequirePermissions('product.edit')
	@ApiOperation({
		operationId: 'updateBundlePriceMethod',
		summary: 'Save a price method; bundles using it price by the new version',
	})
	update(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(BundlePriceMethodWrite)) body: BundlePriceMethodWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.bundles.updateMethod(id, body, principal?.userId ?? null);
	}

	@Delete(':id')
	@HttpCode(204)
	@RequirePermissions('product.edit')
	@ApiOperation({ operationId: 'deleteBundlePriceMethod', summary: 'Remove a price method no bundle uses' })
	remove(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.bundles.deleteMethod(id, principal?.userId ?? null);
	}
}
