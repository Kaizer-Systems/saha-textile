import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublicShopEventsQuery } from '@saha-textile/contracts';

import { Public } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { EventsPublicService } from './events-public.service';

/** The shop's top bar, phone strip and event popup read this. */
@ApiTags(API_TAGS.events)
@Public()
@Controller('catalog/events')
export class EventsPublicController {
	constructor(private readonly events: EventsPublicService) {}

	@Get()
	// Short: the line must appear and go on time, and the countdown carries the server's clock.
	@Header('Cache-Control', 'public, max-age=15')
	@ApiOperation({ operationId: 'listShopEvents', summary: 'Published launch and sale events, with the server clock' })
	list(@Query(new ZodValidationPipe(PublicShopEventsQuery)) query: PublicShopEventsQuery) {
		return this.events.list(query.locale);
	}
}
