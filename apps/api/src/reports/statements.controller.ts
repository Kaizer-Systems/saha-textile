import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	AgeingSide,
	AuditReportQuery,
	PlByLocationQuery,
	StatementKind,
	StatementQuery,
} from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { BooksReportsService } from './books-reports.service';
import { StatementsService } from './statements.service';

/** The financial statements (U2, U3), outstanding with ageing (U5) and the audit report (U8). */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/accounts/reports')
export class StatementsController {
	constructor(
		private readonly statements: StatementsService,
		private readonly books: BooksReportsService,
	) {}

	@Get('ageing/:side')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'reportAgeing', summary: 'Customer or supplier outstanding with ageing (U5)' })
	ageing(@Param('side', new ZodValidationPipe(AgeingSide)) side: AgeingSide) {
		return this.books.ageing(side);
	}

	@Get('audit')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.lock')
	@ApiOperation({ operationId: 'reportAudit', summary: 'Every change across the books in a period (U8)' })
	audit(@Query(new ZodValidationPipe(AuditReportQuery)) query: AuditReportQuery) {
		return this.books.auditReport(query);
	}

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
