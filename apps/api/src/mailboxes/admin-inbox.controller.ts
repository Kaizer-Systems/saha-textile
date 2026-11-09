import {
	Body,
	Controller,
	Get,
	Header,
	HttpCode,
	Param,
	Post,
	Query,
	Res,
	UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InboxListQuery, InboxModifyRequest, InboxSendRequest } from '@saha-textile/contracts';
import type { FastifyReply } from 'fastify';

import { Principal } from '../auth/ownership';
import { Audience, RequirePermissions, type AuthenticatedPrincipal } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { InboxService } from './inbox.service';

const me = (principal: AuthenticatedPrincipal | undefined): string => {
	if (!principal) throw new UnauthorizedException();
	return principal.userId;
};

/** The Inbox (`mailbox.use`), limited further by each person's own access per mailbox. */
@ApiTags(API_TAGS.mailboxes)
@Audience('admin')
@Controller('admin/inbox')
export class AdminInboxController {
	constructor(private readonly inbox: InboxService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('mailbox.use')
	@ApiOperation({ operationId: 'listInboxMailboxes', summary: 'The mailboxes I may open, with unread counts' })
	summary(@Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.inbox.summary(me(principal));
	}

	@Get(':mailboxId/threads')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('mailbox.use')
	@ApiOperation({ operationId: 'listInboxThreads', summary: 'One folder of a mailbox, a page at a time' })
	threads(
		@Param('mailboxId') mailboxId: string,
		@Query(new ZodValidationPipe(InboxListQuery)) query: InboxListQuery,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.inbox.threads(me(principal), mailboxId, query);
	}

	@Get(':mailboxId/threads/:threadId')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('mailbox.use')
	@ApiOperation({ operationId: 'getInboxThread', summary: 'A whole conversation, cleaned for display' })
	thread(
		@Param('mailboxId') mailboxId: string,
		@Param('threadId') threadId: string,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.inbox.thread(me(principal), mailboxId, threadId);
	}

	@Get(':mailboxId/messages/:messageId/attachments/:attachmentId')
	@RequirePermissions('mailbox.use')
	@ApiOperation({ operationId: 'downloadInboxAttachment', summary: 'One attachment, always as a download' })
	async attachment(
		@Param('mailboxId') mailboxId: string,
		@Param('messageId') messageId: string,
		@Param('attachmentId') attachmentId: string,
		@Query('name') name: string | undefined,
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Res() reply: FastifyReply,
	) {
		const data = await this.inbox.attachment(me(principal), mailboxId, messageId, attachmentId);
		const filename = (name ?? 'attachment').replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'attachment';
		// A download, never shown inline, and never sniffed into something runnable.
		await reply
			.header('Content-Type', 'application/octet-stream')
			.header('Content-Disposition', `attachment; filename="${filename}"`)
			.header('X-Content-Type-Options', 'nosniff')
			.header('Cache-Control', 'no-store')
			.send(Buffer.from(data));
	}

	@Post(':mailboxId/send')
	@HttpCode(200)
	@RequirePermissions('mailbox.use')
	@ApiOperation({
		operationId: 'sendInboxMessage',
		summary: 'Reply, forward or write, from the mailbox or one of its aliases',
	})
	send(
		@Param('mailboxId') mailboxId: string,
		@Body(new ZodValidationPipe(InboxSendRequest)) body: InboxSendRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.inbox.send(me(principal), mailboxId, body);
	}

	@Post(':mailboxId/threads/:threadId/modify')
	@HttpCode(200)
	@RequirePermissions('mailbox.use')
	@ApiOperation({
		operationId: 'modifyInboxThread',
		summary: 'Mark read or unread, archive, move to Inbox, trash or restore',
	})
	async modify(
		@Param('mailboxId') mailboxId: string,
		@Param('threadId') threadId: string,
		@Body(new ZodValidationPipe(InboxModifyRequest)) body: InboxModifyRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		await this.inbox.modify(me(principal), mailboxId, threadId, body);
		return { ok: true };
	}
}
