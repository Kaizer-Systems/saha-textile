import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { GstSetOffPost } from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { GstSetOffService } from './gst-set-off.service';

/** Q7 Post the set-off: a GSTR-3B's set-off journal and challan payment (accounts brief G6, Q7). */
@ApiTags(API_TAGS.orders)
@Audience('admin')
@Controller('admin/accounts/gst/returns')
export class GstSetOffController {
	constructor(private readonly setOff: GstSetOffService) {}

	@Post(':id/set-off')
	@RequirePermissions('accounts.post')
	@ApiOperation({ operationId: 'gstSetOffPost', summary: 'Post a GSTR-3B’s set-off and challan payment (Q7)' })
	post(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(GstSetOffPost)) body: GstSetOffPost,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.setOff.post(id, body, principal);
	}
}
