import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProductDraftListQuery, ProductDraftWrite } from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { ProductDraftsService } from './product-drafts.service';

/**
 * Products › Drafts (product bulk actions brief § 7): unfinished product-form work. Reading needs the
 * product list right; saving or discarding a new-product draft needs the right to add products, and a
 * draft of changes the right to edit them (checked per draft by the service).
 */
@ApiTags(API_TAGS.catalog)
@Audience('admin')
@Controller('admin/catalog/product-drafts')
export class AdminProductDraftsController {
	constructor(private readonly drafts: ProductDraftsService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('product.index')
	@ApiOperation({ operationId: 'listProductDrafts', summary: 'My drafts or the team’s, newest save first' })
	list(
		@Query(new ZodValidationPipe(ProductDraftListQuery)) query: ProductDraftListQuery,
		@Principal() principal: AuthenticatedPrincipal,
	) {
		return this.drafts.list(query, principal);
	}

	@Get(':id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('product.index')
	@ApiOperation({ operationId: 'getProductDraft', summary: 'Read one draft to carry on with it' })
	get(@Param('id') id: string) {
		return this.drafts.get(id);
	}

	@Post()
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('product.index')
	@ApiOperation({ operationId: 'createProductDraft', summary: 'Save the product form as a draft, unchecked' })
	create(
		@Body(new ZodValidationPipe(ProductDraftWrite)) body: ProductDraftWrite,
		@Principal() principal: AuthenticatedPrincipal,
	) {
		return this.drafts.save(null, body, principal);
	}

	@Post(':id')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('product.index')
	@ApiOperation({ operationId: 'updateProductDraft', summary: 'Save over a draft' })
	update(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(ProductDraftWrite)) body: ProductDraftWrite,
		@Principal() principal: AuthenticatedPrincipal,
	) {
		return this.drafts.save(id, body, principal);
	}

	@Delete(':id')
	@HttpCode(204)
	@RequirePermissions('product.index')
	@ApiOperation({ operationId: 'deleteProductDraft', summary: 'Discard a draft; the product is untouched' })
	remove(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal) {
		return this.drafts.remove(id, principal);
	}
}
