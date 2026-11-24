import { Body, Controller, Get, Header, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Gstr2bDecision, Gstr2bImportWrite, Gstr2bQuery } from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { Gstr2bService } from './gstr2b.service';

/** GSTR-2B against our purchases (accounts brief G5). */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/accounts/gst/2b')
export class Gstr2bController {
	constructor(private readonly gstr2b: Gstr2bService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'gstr2bView', summary: 'A month’s GSTR-2B against our purchases (G5)' })
	view(@Query(new ZodValidationPipe(Gstr2bQuery)) query: Gstr2bQuery) {
		return this.gstr2b.view(query);
	}

	@Post()
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'gstr2bImport', summary: 'Import the GSTR-2B file from the portal (G5)' })
	import(
		@Body(new ZodValidationPipe(Gstr2bImportWrite)) body: Gstr2bImportWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.gstr2b.import(body, principal);
	}

	@Post('decisions')
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'gstr2bDecide', summary: 'Record what was done on the portal for a 2B line (G5)' })
	decide(@Body(new ZodValidationPipe(Gstr2bDecision)) body: Gstr2bDecision) {
		return this.gstr2b.decide(body);
	}
}
