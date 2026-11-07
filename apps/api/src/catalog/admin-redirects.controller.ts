import { Body, Controller, Delete, Get, Header, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SeoRedirectWrite } from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { CatalogService } from './catalog.service';

@ApiTags(API_TAGS.catalog)
@Audience('admin')
@Controller('admin/catalog/redirects')
export class AdminRedirectsController {
	constructor(private readonly catalog: CatalogService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('product.index')
	@ApiOperation({ operationId: 'listAdminRedirects', summary: 'List redirect rows' })
	list() {
		return this.catalog.listRedirects();
	}

	@Post()
	@RequirePermissions('product.edit')
	@ApiOperation({ operationId: 'saveAdminRedirect', summary: 'Save a redirect, collapsing any chain' })
	save(
		@Body(new ZodValidationPipe(SeoRedirectWrite)) body: SeoRedirectWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.catalog.saveRedirect(body, principal?.userId ?? null);
	}

	@Delete()
	@RequirePermissions('product.edit')
	@ApiOperation({ operationId: 'removeAdminRedirect', summary: 'Remove one redirect row' })
	remove(@Query('sourcePath') sourcePath: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.catalog.removeRedirect(sourcePath, principal?.userId ?? null);
	}
}
