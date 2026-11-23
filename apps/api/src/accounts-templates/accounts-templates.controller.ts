import { Controller, Get, Header, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Audience, RequirePermissions } from '../auth/session.guard';
import { API_TAGS } from '../openapi-tags';
import { AccountsTemplatesService } from './accounts-templates.service';

/** Settings › Accounts templates (accounts templates AT2): the library, read with accounts.index. */
@ApiTags(API_TAGS.stock)
@Audience('admin')
@Controller('admin/accounts/templates')
export class AccountsTemplatesController {
	constructor(private readonly templates: AccountsTemplatesService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({
		operationId: 'accountsTemplates',
		summary: "Every accounts template, with whether this company's kind unlocks it",
	})
	library() {
		return this.templates.library();
	}

	@Get(':code')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'accountsTemplate', summary: 'One accounts template with every version' })
	get(@Param('code') code: string) {
		return this.templates.get(code);
	}
}
