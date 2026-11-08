import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublicStoreLocationQuery } from '@saha-textile/contracts';

import { Public } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { StoreLocationsPublicService } from './store-locations-public.service';

/** Contact Us reads the stores through this; a change in the admin shows within a minute. */
@ApiTags(API_TAGS.stores)
@Public()
@Controller('catalog/store-locations')
export class StoreLocationsPublicController {
	constructor(private readonly stores: StoreLocationsPublicService) {}

	@Get()
	@Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
	@ApiOperation({ operationId: 'listStoreLocations', summary: 'Active stores in display order, in one language' })
	list(@Query(new ZodValidationPipe(PublicStoreLocationQuery)) query: PublicStoreLocationQuery) {
		return this.stores.list(query.locale);
	}
}
