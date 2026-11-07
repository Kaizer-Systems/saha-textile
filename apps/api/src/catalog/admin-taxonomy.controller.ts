import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminAttributeWrite, AdminCategoryWrite } from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { TaxonomyService } from './taxonomy.service';

/** Categories and attributes for the admin. Every write is authorised and audited. */
@ApiTags(API_TAGS.catalog)
@Audience('admin')
@Controller('admin/catalog')
export class AdminTaxonomyController {
	constructor(private readonly taxonomy: TaxonomyService) {}

	@Get('categories')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('category.index')
	@ApiOperation({ operationId: 'listAdminCategories', summary: 'Every category with its address and product count' })
	categories() {
		return this.taxonomy.listCategories();
	}

	@Post('categories')
	@RequirePermissions('category.create')
	@ApiOperation({ operationId: 'createCategory', summary: 'Add a category' })
	createCategory(
		@Body(new ZodValidationPipe(AdminCategoryWrite)) body: AdminCategoryWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.taxonomy.saveCategory(null, body, principal?.userId ?? null);
	}

	@Post('categories/:id')
	@HttpCode(200)
	@RequirePermissions('category.edit')
	@ApiOperation({ operationId: 'updateCategory', summary: 'Save a category; a move or rename writes its redirects' })
	updateCategory(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(AdminCategoryWrite)) body: AdminCategoryWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.taxonomy.saveCategory(id, body, principal?.userId ?? null);
	}

	@Delete('categories/:id')
	@RequirePermissions('category.destroy')
	@ApiOperation({ operationId: 'deleteCategory', summary: 'Delete an empty category' })
	deleteCategory(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.taxonomy.deleteCategory(id, principal?.userId ?? null);
	}

	@Get('attributes')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('attribute.index')
	@ApiOperation({ operationId: 'listAdminAttributes', summary: 'Every attribute and its values' })
	attributes() {
		return this.taxonomy.listAttributes();
	}

	@Post('attributes')
	@HttpCode(200)
	@RequirePermissions('attribute.edit')
	@ApiOperation({ operationId: 'saveAttribute', summary: 'Add or save an attribute' })
	saveAttribute(
		@Body(new ZodValidationPipe(AdminAttributeWrite)) body: AdminAttributeWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.taxonomy.saveAttribute(body, principal?.userId ?? null);
	}

	@Delete('attributes/:code')
	@RequirePermissions('attribute.destroy')
	@ApiOperation({ operationId: 'deleteAttribute', summary: 'Delete an attribute no product uses' })
	deleteAttribute(@Param('code') code: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.taxonomy.deleteAttribute(code, principal?.userId ?? null);
	}
}
