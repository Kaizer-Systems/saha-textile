import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AddonTemplateOptionWrite } from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { CatalogService } from './catalog.service';

@ApiTags(API_TAGS.catalog)
@Audience('admin')
@Controller('admin/catalog/addon-templates')
export class AdminAddonTemplatesController {
	constructor(private readonly catalog: CatalogService) {}

	@Get()
	@RequirePermissions('product.index')
	@ApiOperation({ operationId: 'listAddonTemplates', summary: 'List add-on templates' })
	list() {
		return this.catalog.listAddonTemplates();
	}

	@Post()
	@RequirePermissions('product.edit')
	@ApiOperation({ operationId: 'saveAddonTemplate', summary: 'Save an add-on template option' })
	save(
		@Body(new ZodValidationPipe(AddonTemplateOptionWrite)) body: AddonTemplateOptionWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.catalog.saveAddonTemplate(body, principal?.userId ?? null);
	}

	@Delete(':code')
	@RequirePermissions('product.edit')
	@ApiOperation({ operationId: 'removeAddonTemplate', summary: 'Remove an add-on template option' })
	remove(@Param('code') code: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.catalog.removeAddonTemplate(code, principal?.userId ?? null);
	}
}
