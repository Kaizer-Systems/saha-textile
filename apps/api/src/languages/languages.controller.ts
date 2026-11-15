import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { type ActiveLocaleConfig } from '@saha-textile/contracts';

import { Public } from '../auth/session.guard';
import { API_TAGS } from '../openapi-tags';
import { LanguagesService } from './languages.service';

/** The active languages, read by the admin's language switches and by the shop. */
@ApiTags(API_TAGS.languages)
@Controller()
export class LanguagesController {
	constructor(private readonly languages: LanguagesService) {}

	@Get('storefront/languages')
	@Public()
	@Header('Cache-Control', 'public, max-age=60')
	@ApiOperation({ operationId: 'storefrontLanguages', summary: 'The active languages, English first' })
	list(): ActiveLocaleConfig {
		return this.languages.active();
	}
}
