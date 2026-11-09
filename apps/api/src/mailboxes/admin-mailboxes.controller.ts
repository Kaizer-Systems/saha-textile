import {
	Body,
	Controller,
	Get,
	Header,
	HttpCode,
	Param,
	Post,
	Put,
	Query,
	Redirect,
	UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContactMailboxWrite, MailboxAccessWrite, MailboxOAuthCallbackQuery } from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, Public, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { MailboxesAdminService } from './mailboxes-admin.service';

const actor = (principal: AuthenticatedPrincipal | undefined) => principal?.userId ?? null;

const me = (principal: AuthenticatedPrincipal | undefined): string => {
	if (!principal) throw new UnauthorizedException();
	return principal.userId;
};

/**
 * Settings › Mailboxes. `mailbox.manage` only: it decides who reads which mailbox.
 * Google's callback is the one public route; the signed `state` authorises it.
 */
@ApiTags(API_TAGS.mailboxes)
@Audience('admin')
@Controller('admin/mailboxes')
export class AdminMailboxesController {
	constructor(private readonly mailboxes: MailboxesAdminService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('mailbox.manage')
	@ApiOperation({
		operationId: 'listMailboxes',
		summary: 'Connected mailboxes, how many may read or send, and the Contact Us mailbox',
	})
	list() {
		return this.mailboxes.list();
	}

	@Post('connect')
	@HttpCode(200)
	@RequirePermissions('mailbox.manage')
	@ApiOperation({
		operationId: 'startMailboxConnection',
		summary: "Google's sign-in address for connecting a mailbox",
	})
	connect(@Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.mailboxes.connectUrl(me(principal));
	}

	@Get('oauth/callback')
	@Public()
	@Redirect()
	@ApiOperation({
		operationId: 'completeMailboxConnection',
		summary: "Google's answer; returns to the admin's Mailboxes tab",
	})
	async callback(@Query(new ZodValidationPipe(MailboxOAuthCallbackQuery)) query: MailboxOAuthCallbackQuery) {
		return { url: await this.mailboxes.completeSignIn(query), statusCode: 302 };
	}

	@Put('contact-target')
	@RequirePermissions('mailbox.manage')
	@ApiOperation({ operationId: 'setContactMailbox', summary: 'Where Contact Us messages go' })
	contactTarget(
		@Body(new ZodValidationPipe(ContactMailboxWrite)) body: ContactMailboxWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.mailboxes.setContactTarget(body.mailboxId, actor(principal));
	}

	@Get(':id/access')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('mailbox.manage')
	@ApiOperation({ operationId: 'getMailboxAccess', summary: 'Who may read or send from one mailbox' })
	getAccess(@Param('id') id: string) {
		return this.mailboxes.getAccess(id);
	}

	@Put(':id/access')
	@RequirePermissions('mailbox.manage')
	@ApiOperation({ operationId: 'setMailboxAccess', summary: "Replace one mailbox's access list" })
	setAccess(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(MailboxAccessWrite)) body: MailboxAccessWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.mailboxes.setAccess(id, body, actor(principal));
	}

	@Post(':id/refresh')
	@HttpCode(200)
	@RequirePermissions('mailbox.manage')
	@ApiOperation({
		operationId: 'refreshMailboxAliases',
		summary: "Re-read the mailbox's send-as addresses from Gmail",
	})
	refresh(@Param('id') id: string) {
		return this.mailboxes.refreshSendAs(id);
	}

	@Post(':id/disconnect')
	@HttpCode(200)
	@RequirePermissions('mailbox.manage')
	@ApiOperation({ operationId: 'disconnectMailbox', summary: 'Withdraw access at Google and forget the token' })
	disconnect(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.mailboxes.disconnect(id, actor(principal));
	}
}
