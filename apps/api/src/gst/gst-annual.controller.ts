import { Body, Controller, Get, Header, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { GstAnnualNoteWrite, GstAnnualQuery } from '@saha-textile/contracts';

import { Audience, RequirePermissions } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { GstAnnualService } from './gst-annual.service';

/** GSTR-9 against the books, and each month's returns against the books (accounts brief G9, G7). */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/accounts/gst/annual')
export class GstAnnualController {
	constructor(private readonly annual: GstAnnualService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'gstAnnual', summary: 'GSTR-9 and the monthly returns against the books (G9, G7)' })
	view(@Query(new ZodValidationPipe(GstAnnualQuery)) query: GstAnnualQuery) {
		return this.annual.view(query);
	}

	@Post('notes')
	@RequirePermissions('accounts.edit')
	@ApiOperation({ operationId: 'gstAnnualNote', summary: 'Why a GSTR-9 table differs from the books (G9)' })
	note(@Body(new ZodValidationPipe(GstAnnualNoteWrite)) body: GstAnnualNoteWrite) {
		return this.annual.note(body);
	}
}
