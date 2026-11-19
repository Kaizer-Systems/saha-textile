import {
	Body,
	Controller,
	Delete,
	Get,
	Header,
	HttpCode,
	Param,
	Patch,
	Post,
	Put,
	Query,
	Res,
	UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	InboxBulkRequest,
	InboxDraftWrite,
	InboxLabelId,
	InboxLabelWrite,
	InboxListQuery,
	InboxMarkMessagesRequest,
	InboxModifyRequest,
	InboxSendRequest,
} from '@saha-textile/contracts';
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
		summary: 'Reply, forward or write; it waits 10 seconds in Drafts so it can be undone',
	})
	send(
		@Param('mailboxId') mailboxId: string,
		@Body(new ZodValidationPipe(InboxSendRequest)) body: InboxSendRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.inbox.queueSend(me(principal), mailboxId, body);
	}

	@Get(':mailboxId/outbox/:outboxId')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('mailbox.use')
	@ApiOperation({ operationId: 'getInboxOutboxItem', summary: 'Whether a message I sent has gone yet' })
	outboxStatus(
		@Param('mailboxId') mailboxId: string,
		@Param('outboxId') outboxId: string,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.inbox.outboxStatus(me(principal), mailboxId, outboxId);
	}

	@Post(':mailboxId/outbox/:outboxId/cancel')
	@HttpCode(200)
	@RequirePermissions('mailbox.use')
	@ApiOperation({ operationId: 'undoInboxSend', summary: 'Undo Send: keep the message in Drafts instead' })
	cancelSend(
		@Param('mailboxId') mailboxId: string,
		@Param('outboxId') outboxId: string,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.inbox.cancelSend(me(principal), mailboxId, outboxId);
	}

	@Get(':mailboxId/drafts')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('mailbox.use')
	@ApiOperation({ operationId: 'listInboxDrafts', summary: "The mailbox's Gmail drafts, newest first" })
	drafts(
		@Param('mailboxId') mailboxId: string,
		@Query('pageToken') pageToken: string | undefined,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.inbox.listDrafts(me(principal), mailboxId, pageToken?.slice(0, 200) || undefined);
	}

	@Get(':mailboxId/drafts/:draftId')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('mailbox.use')
	@ApiOperation({ operationId: 'getInboxDraft', summary: 'One draft, to carry on writing it' })
	draft(
		@Param('mailboxId') mailboxId: string,
		@Param('draftId') draftId: string,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.inbox.getDraft(me(principal), mailboxId, draftId);
	}

	@Post(':mailboxId/drafts')
	@HttpCode(200)
	@RequirePermissions('mailbox.use')
	@ApiOperation({ operationId: 'createInboxDraft', summary: 'Save the compose box to Gmail as a new draft' })
	createDraft(
		@Param('mailboxId') mailboxId: string,
		@Body(new ZodValidationPipe(InboxDraftWrite)) body: InboxDraftWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.inbox.saveDraft(me(principal), mailboxId, null, body);
	}

	@Put(':mailboxId/drafts/:draftId')
	@RequirePermissions('mailbox.use')
	@ApiOperation({ operationId: 'saveInboxDraft', summary: 'Save the compose box over its Gmail draft' })
	saveDraft(
		@Param('mailboxId') mailboxId: string,
		@Param('draftId') draftId: string,
		@Body(new ZodValidationPipe(InboxDraftWrite)) body: InboxDraftWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.inbox.saveDraft(me(principal), mailboxId, draftId, body);
	}

	@Delete(':mailboxId/drafts/:draftId')
	@HttpCode(204)
	@RequirePermissions('mailbox.use')
	@ApiOperation({ operationId: 'deleteInboxDraft', summary: 'Discard a draft (deletes it in Gmail)' })
	async deleteDraft(
		@Param('mailboxId') mailboxId: string,
		@Param('draftId') draftId: string,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<void> {
		await this.inbox.deleteDraft(me(principal), mailboxId, draftId);
	}

	@Post(':mailboxId/threads/:threadId/modify')
	@HttpCode(200)
	@RequirePermissions('mailbox.use')
	@ApiOperation({
		operationId: 'modifyInboxThread',
		summary: 'Mark read or unread, archive, move, spam, star, important, label, Bin or restore one conversation',
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

	@Post(':mailboxId/messages/read')
	@HttpCode(200)
	@RequirePermissions('mailbox.use')
	@ApiOperation({
		operationId: 'markInboxMessages',
		summary: 'Mark exactly these messages read or unread, nothing else in their conversations',
	})
	async markMessages(
		@Param('mailboxId') mailboxId: string,
		@Body(new ZodValidationPipe(InboxMarkMessagesRequest)) body: InboxMarkMessagesRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		await this.inbox.markMessages(me(principal), mailboxId, body);
		return { ok: true };
	}

	@Get(':mailboxId/labels')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('mailbox.use')
	@ApiOperation({ operationId: 'listInboxLabels', summary: "The mailbox's own Gmail labels and categories" })
	labels(@Param('mailboxId') mailboxId: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.inbox.labels(me(principal), mailboxId);
	}

	@Post(':mailboxId/labels')
	@RequirePermissions('mailbox.use')
	@ApiOperation({ operationId: 'createInboxLabel', summary: 'Create a Gmail label (Labels right)' })
	createLabel(
		@Param('mailboxId') mailboxId: string,
		@Body(new ZodValidationPipe(InboxLabelWrite)) body: InboxLabelWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.inbox.createLabel(me(principal), mailboxId, body);
	}

	@Patch(':mailboxId/labels/:labelId')
	@RequirePermissions('mailbox.use')
	@ApiOperation({ operationId: 'renameInboxLabel', summary: 'Rename a Gmail label (Labels right)' })
	renameLabel(
		@Param('mailboxId') mailboxId: string,
		@Param('labelId', new ZodValidationPipe(InboxLabelId)) labelId: string,
		@Body(new ZodValidationPipe(InboxLabelWrite)) body: InboxLabelWrite,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.inbox.renameLabel(me(principal), mailboxId, labelId, body);
	}

	@Delete(':mailboxId/labels/:labelId')
	@HttpCode(200)
	@RequirePermissions('mailbox.use')
	@ApiOperation({
		operationId: 'deleteInboxLabel',
		summary: 'Delete a Gmail label; its conversations keep their mail (Labels right)',
	})
	async deleteLabel(
		@Param('mailboxId') mailboxId: string,
		@Param('labelId', new ZodValidationPipe(InboxLabelId)) labelId: string,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		await this.inbox.deleteLabel(me(principal), mailboxId, labelId);
		return { ok: true };
	}

	@Post(':mailboxId/bulk')
	@HttpCode(200)
	@RequirePermissions('mailbox.use')
	@ApiOperation({
		operationId: 'bulkInboxAction',
		summary: 'One action on chosen or matching conversations, each reported done or failed',
	})
	bulk(
		@Param('mailboxId') mailboxId: string,
		@Body(new ZodValidationPipe(InboxBulkRequest)) body: InboxBulkRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	) {
		return this.inbox.bulk(me(principal), mailboxId, body);
	}

	@Get(':mailboxId/bin')
	@Header('Cache-Control', 'no-store')
	@RequirePermissions('mailbox.use')
	@ApiOperation({ operationId: 'countInboxBin', summary: 'What Empty Bin would delete, counted by Gmail now' })
	bin(@Param('mailboxId') mailboxId: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.inbox.binSummary(me(principal), mailboxId);
	}

	@Post(':mailboxId/bin/empty')
	@HttpCode(200)
	@RequirePermissions('mailbox.use')
	@ApiOperation({
		operationId: 'emptyInboxBin',
		summary: 'Delete everything in the Bin for good (Delete forever right)',
	})
	emptyBin(@Param('mailboxId') mailboxId: string, @Principal() principal: AuthenticatedPrincipal | undefined) {
		return this.inbox.emptyBin(me(principal), mailboxId);
	}
}
