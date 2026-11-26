import { Body, Controller, Get, Header, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SettlementImportWrite, SettlementListQuery } from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { SettlementsService } from './settlements.service';

/** Gateway payouts and courier COD remittances (accounts brief Q10). */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/accounts/settlements')
export class SettlementsController {
	constructor(private readonly settlements: SettlementsService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'settlements', summary: 'Payouts and COD remittances in a period (Q10)' })
	list(@Query(new ZodValidationPipe(SettlementListQuery)) query: SettlementListQuery) {
		return this.settlements.list(query);
	}

	@Post('preview')
	@RequirePermissions('accounts.edit')
	@ApiOperation({
		operationId: 'settlementPreview',
		summary: 'A payout file’s payouts, matched, before saving (Q10)',
	})
	preview(@Body(new ZodValidationPipe(SettlementImportWrite)) body: SettlementImportWrite) {
		return this.settlements.preview(body);
	}

	@Post()
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'settlementImport', summary: 'Import a payout file and post each payout (Q10)' })
	import(
		@Body(new ZodValidationPipe(SettlementImportWrite)) body: SettlementImportWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.settlements.import(body, principal);
	}

	@Get(':id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'settlement', summary: 'One payout with its rows (Q10)' })
	get(@Param('id') id: string) {
		return this.settlements.get(id);
	}
}
