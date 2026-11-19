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
import {
	ContactMailboxWrite,
	MailboxAccessWrite,
	MailboxOAuthCallbackQuery,
	MailboxPeopleQuery,
} from '@saha-textile/contracts';

import { Principal } from '../auth/ownership';
import { Audience, Public, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { MailboxesAdminService } from './mailboxes-admin.service';

const me = (principal: AuthenticatedPrincipal | undefined): string => {
	if (!principal) throw new UnauthorizedException();
	return principal.userId;
};

/**
 * Settings › Mailboxes: decides who uses which mailbox, so every route needs `mailbox.manage` and
 * a super admin (owner log § admin Inbox upgrade, 2026-11-19). Google's callback is the one public
 * route; its single-use signed `state` authorises it.
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
	async list(@Principal() principal: AuthenticatedPrincipal | undefined) {
		await this.mailboxes.requireSuperAdmin(me(principal));
		return this.mailboxes.list();
	}

	@Post('connect')
	@HttpCode(200)
	@RequirePermissions('mailbox.manage')
	@ApiOperation({
		operationId: 'startMailboxConnection',
		summary: "Google's sign-in address for connecting a mailbox",
	})
	async connect(@Principal() principal: AuthenticatedPrincipal | undefined) {
		await this.mailboxes.requireSuperAdmin(me(principal));
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

	@Get('people')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('mailbox.manage')
	@ApiOperation({
		operationId: 'findMailboxPeople',
		summary: 'Admin users to add to an access list, searched by name, email or username',
	})
	async people(
		@Query(new ZodValidationPipe(MailboxPeopleQuery)) query: MailboxPeopleQuery,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		await this.mailboxes.requireSuperAdmin(me(principal));
		return this.mailboxes.people(query);
	}

	@Put('contact-target')
	@RequirePermissions('mailbox.manage')
	@ApiOperation({ operationId: 'setContactMailbox', summary: 'Where Contact Us messages go' })
	async contactTarget(
		@Body(new ZodValidationPipe(ContactMailboxWrite)) body: ContactMailboxWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		await this.mailboxes.requireSuperAdmin(me(principal));
		return this.mailboxes.setContactTarget(body.mailboxId, me(principal));
	}

	@Get(':id/access')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('mailbox.manage')
	@ApiOperation({ operationId: 'getMailboxAccess', summary: 'Who may use one mailbox, with their rights and names' })
	async getAccess(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		await this.mailboxes.requireSuperAdmin(me(principal));
		return this.mailboxes.getAccess(id);
	}

	@Put(':id/access')
	@RequirePermissions('mailbox.manage')
	@ApiOperation({ operationId: 'setMailboxAccess', summary: "Replace one mailbox's access list" })
	async setAccess(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(MailboxAccessWrite)) body: MailboxAccessWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		await this.mailboxes.requireSuperAdmin(me(principal));
		return this.mailboxes.setAccess(id, body, me(principal));
	}

	@Post(':id/refresh')
	@HttpCode(200)
	@RequirePermissions('mailbox.manage')
	@ApiOperation({
		operationId: 'refreshMailboxAliases',
		summary: "Re-read the mailbox's send-as addresses from Gmail",
	})
	async refresh(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		await this.mailboxes.requireSuperAdmin(me(principal));
		return this.mailboxes.refreshSendAs(id);
	}

	@Post(':id/disconnect')
	@HttpCode(200)
	@RequirePermissions('mailbox.manage')
	@ApiOperation({
		operationId: 'disconnectMailbox',
		summary: 'Stop the mailbox here, then withdraw access at Google',
	})
	async disconnect(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		await this.mailboxes.requireSuperAdmin(me(principal));
		return this.mailboxes.disconnect(id, me(principal));
	}

	@Post(':id/withdraw-again')
	@HttpCode(200)
	@RequirePermissions('mailbox.manage')
	@ApiOperation({
		operationId: 'retryMailboxWithdrawal',
		summary: "Ask Google again to withdraw a disconnected mailbox's access",
	})
	async withdrawAgain(@Param('id') id: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		await this.mailboxes.requireSuperAdmin(me(principal));
		return this.mailboxes.retryRevocation(id, me(principal));
	}
}
