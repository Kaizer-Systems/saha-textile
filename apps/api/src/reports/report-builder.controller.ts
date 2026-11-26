import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReportDefinitionEdit, ReportDefinitionWrite, ReportRun } from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { ReportBuilderService } from './report-builder.service';

/** The custom report builder and saved reports (accounts brief V1, V2). */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/accounts/reports')
export class ReportBuilderController {
	constructor(private readonly builder: ReportBuilderService) {}

	@Get('catalogue')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'reportCatalogue', summary: 'The kinds of data and their fields (V1)' })
	catalogue() {
		return this.builder.catalogue();
	}

	@Post('run')
	@HttpCode(200)
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'reportRun', summary: 'A report’s table for a period (V1)' })
	run(@Body(new ZodValidationPipe(ReportRun)) body: ReportRun, @Principal() principal?: AuthenticatedPrincipal) {
		return this.builder.run(body, principal);
	}

	@Get('saved')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'reportSavedList', summary: 'Saved reports this person may open (U1)' })
	list(@Principal() principal?: AuthenticatedPrincipal) {
		return this.builder.list(principal);
	}

	@Get('saved/:id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'reportSavedGet', summary: 'A saved report (V2)' })
	get(@Param('id') id: string, @Principal() principal?: AuthenticatedPrincipal) {
		return this.builder.get(id, principal);
	}

	@Post('saved')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'reportSavedCreate', summary: 'Save a report as a template (V2)' })
	create(
		@Body(new ZodValidationPipe(ReportDefinitionWrite)) body: ReportDefinitionWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.builder.create(body, principal);
	}

	@Put('saved/:id')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'reportSavedUpdate', summary: 'Change a saved report (its maker only)' })
	update(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(ReportDefinitionEdit)) body: ReportDefinitionEdit,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.builder.update(id, body, principal);
	}

	@Delete('saved/:id')
	@HttpCode(204)
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'reportSavedDelete', summary: 'Delete a saved report (its maker only)' })
	async remove(@Param('id') id: string, @Principal() principal?: AuthenticatedPrincipal) {
		await this.builder.remove(id, principal);
	}
}
