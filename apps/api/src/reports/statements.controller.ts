import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlByLocationQuery, StatementKind, StatementQuery } from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { StatementsService } from './statements.service';

/** The financial statements (accounts brief U2, U3). */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/accounts/reports')
export class StatementsController {
	constructor(private readonly statements: StatementsService) {}

	@Get('pl-by-location')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'reportPlByLocation', summary: 'Profit and loss for a period by location (U3)' })
	plByLocation(
		@Query(new ZodValidationPipe(PlByLocationQuery)) query: PlByLocationQuery,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.statements.plByLocation(query, principal);
	}

	@Get('statements/:kind')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'reportStatement', summary: 'Balance sheet or profit and loss as at a day (U2)' })
	statement(
		@Param('kind', new ZodValidationPipe(StatementKind)) kind: StatementKind,
		@Query(new ZodValidationPipe(StatementQuery)) query: StatementQuery,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.statements.statement(kind, query, principal);
	}
}
