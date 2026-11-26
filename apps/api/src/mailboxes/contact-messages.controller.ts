import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContactMessageRequest, type ContactMessageParsed } from '@saha-textile/contracts';
import type { FastifyRequest } from 'fastify';

import { Public } from '../auth/session.guard';
import { CatalogRateLimit } from '../catalog/catalog-rate-limit';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { ContactMessagesService } from './contact-messages.service';

/** The shop's Contact Us form. */
@ApiTags(API_TAGS.mailboxes)
@Controller('storefront/contact-messages')
export class ContactMessagesController {
	constructor(
		private readonly contact: ContactMessagesService,
		private readonly limits: CatalogRateLimit,
	) {}

	@Post()
	@Public()
	@HttpCode(202)
	@ApiOperation({ operationId: 'sendContactMessage', summary: 'Send a Contact Us message to the shop' })
	async send(
		@Body(new ZodValidationPipe(ContactMessageRequest)) body: ContactMessageParsed,
		@Req() request: FastifyRequest,
	) {
		await this.limits.enforce('contact_message', { identifier: body.email, ip: request.ip });
		await this.contact.submit(body, request.ip);
		return { accepted: true };
	}
}
