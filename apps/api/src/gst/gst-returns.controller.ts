import { Body, Controller, Get, Header, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { GstCalendarQuery, GstReturnPrepare, GstReturnStep } from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { GstReturnsService } from './gst-returns.service';

/** GST returns from the books (accounts brief G3, G4). */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/accounts/gst/returns')
export class GstReturnsController {
	constructor(private readonly returns: GstReturnsService) {}

	@Get('calendar')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'gstCalendar', summary: 'A GSTIN’s returns with due dates and status (G3)' })
	calendar(@Query(new ZodValidationPipe(GstCalendarQuery)) query: GstCalendarQuery) {
		return this.returns.calendar(query);
	}

	@Post()
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'gstReturnPrepare', summary: 'Prepare a return from the books (G4)' })
	prepare(
		@Body(new ZodValidationPipe(GstReturnPrepare)) body: GstReturnPrepare,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.returns.prepare(body, principal);
	}

	@Get(':id')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'gstReturn', summary: 'A prepared return with its tables and checks (G4)' })
	get(@Param('id') id: string) {
		return this.returns.get(id);
	}

	@Post(':id/step')
	@RequirePermissions('accounts.post')
	@ApiOperation({ operationId: 'gstReturnStep', summary: 'Accountant checked, or approved by the CA (G4)' })
	step(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(GstReturnStep)) body: GstReturnStep,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.returns.step(id, body, principal);
	}
}
