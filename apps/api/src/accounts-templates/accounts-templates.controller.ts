import { Body, Controller, Get, Header, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	AccountsTemplate,
	TemplateDraftWrite,
	TemplateNew,
	TemplatePublish,
	TemplatesOpenQuery,
} from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { AccountsTemplatesService } from './accounts-templates.service';

/**
 * Settings › Accounts templates (accounts templates AT2, AT3): the library, read with accounts.index; New template, Import,
 * Save draft and Publish with accounts_template.edit.
 */
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

	@Get('opens')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'accountsTemplatesOpen', summary: 'What a kind of company unlocks (AT1)' })
	opens(@Query(new ZodValidationPipe(TemplatesOpenQuery)) query: TemplatesOpenQuery) {
		return this.templates.opens(query.kind);
	}

	@Get(':code')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({ operationId: 'accountsTemplate', summary: 'One accounts template with every version' })
	get(@Param('code') code: string) {
		return this.templates.get(code);
	}

	@Post()
	@RequirePermissions('accounts_template.edit')
	@ApiOperation({ operationId: 'newAccountsTemplate', summary: 'Start a new template as a draft (AT2)' })
	create(
		@Body(new ZodValidationPipe(TemplateNew)) body: TemplateNew,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.templates.create(body, principal?.userId ?? null);
	}

	@Post('import')
	@RequirePermissions('accounts_template.edit')
	@ApiOperation({
		operationId: 'importAccountsTemplate',
		summary: 'Import a template saved from another deployment (AT2)',
	})
	importTemplate(@Body(new ZodValidationPipe(AccountsTemplate)) body: AccountsTemplate) {
		return this.templates.importTemplate(body);
	}

	@Put(':code/draft')
	@RequirePermissions('accounts_template.edit')
	@ApiOperation({ operationId: 'saveAccountsTemplateDraft', summary: 'Save the builder draft (AT3)' })
	saveDraft(
		@Param('code') code: string,
		@Body(new ZodValidationPipe(TemplateDraftWrite)) body: TemplateDraftWrite,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.templates.saveDraft(code, body, principal?.userId ?? null);
	}

	@Get(':code/changes')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('accounts.index')
	@ApiOperation({
		operationId: 'accountsTemplateChanges',
		summary: 'What the draft changes from the newest version (AT3)',
	})
	changes(@Param('code') code: string) {
		return this.templates.changes(code);
	}

	@Post(':code/publish')
	@RequirePermissions('accounts_template.edit')
	@ApiOperation({ operationId: 'publishAccountsTemplate', summary: 'Publish the draft as the next version (AT3)' })
	publish(
		@Param('code') code: string,
		@Body(new ZodValidationPipe(TemplatePublish)) body: TemplatePublish,
		@Principal() principal?: AuthenticatedPrincipal,
	) {
		return this.templates.publish(code, body, principal?.userId ?? null);
	}
}
