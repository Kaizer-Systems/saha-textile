import { randomUUID } from 'node:crypto';

import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
	MAX_SAVED_REPLIES,
	type MailboxRight,
	type SavedReply,
	type SavedReplyCreate,
	type SavedReplyList,
	type SavedReplyWrite,
} from '@saha-textile/contracts';
import {
	type MailboxAccessRepository,
	type SavedReplyRepository,
	type StoredSavedReply,
	mailboxRights,
} from '@saha-textile/core-domain';

import { MAILBOX_ACCESS_REPOSITORY, SAVED_REPLY_REPOSITORY } from '../infra/tokens';
import { MailboxBookkeeping } from './mailbox-support';

/** The audit action for every saved-reply change; the text itself is never recorded. */
export const SAVED_REPLY_CHANGED = 'mailbox.saved_reply_changed';

/**
 * Saved replies (C3, owner 2026-11-19): shared replies per mailbox, usable by everyone who can send
 * from it and editable only by people with that mailbox's Settings right, plus each admin user's
 * own personal replies. Every call names the mailbox being written in, and the Send right there is
 * checked first, so nobody reads a mailbox's shared replies without being able to use them.
 */
@Injectable()
export class SavedRepliesService {
	constructor(
		@Inject(SAVED_REPLY_REPOSITORY) private readonly replies: SavedReplyRepository,
		@Inject(MAILBOX_ACCESS_REPOSITORY) private readonly access: MailboxAccessRepository,
		private readonly books: MailboxBookkeeping,
	) {}

	async list(adminUserId: string, mailboxId: string): Promise<SavedReplyList> {
		const rights = await this.rightsIn(adminUserId, mailboxId);
		const canEditShared = rights.has('settings');
		const [shared, personal] = await Promise.all([
			this.replies.listShared(mailboxId),
			this.replies.listPersonal(adminUserId),
		]);
		return {
			shared: shared.map((reply) => this.view(reply, canEditShared)),
			personal: personal.map((reply) => this.view(reply, true)),
			canEditShared,
		};
	}

	async create(adminUserId: string, mailboxId: string, write: SavedReplyCreate): Promise<SavedReply> {
		const rights = await this.rightsIn(adminUserId, mailboxId);
		const shared = write.scope === 'shared';
		if (shared && !rights.has('settings')) {
			throw new ForbiddenException({ code: 'mailbox_right_missing', right: 'settings' });
		}
		const existing = shared
			? await this.replies.listShared(mailboxId)
			: await this.replies.listPersonal(adminUserId);
		if (existing.length >= MAX_SAVED_REPLIES) throw new ConflictException({ code: 'too_many_saved_replies' });
		const now = new Date().toISOString();
		const reply = await this.replies.create({
			id: `srp_${randomUUID()}`,
			scope: write.scope,
			mailboxId: shared ? mailboxId : null,
			ownerAdminUserId: shared ? null : adminUserId,
			title: write.title,
			body: write.body,
			createdBy: adminUserId,
			updatedBy: adminUserId,
			createdAt: now,
			updatedAt: now,
		});
		await this.audit(adminUserId, mailboxId, reply, 'created');
		return this.view(reply, true);
	}

	async update(adminUserId: string, mailboxId: string, id: string, write: SavedReplyWrite): Promise<SavedReply> {
		const reply = await this.editable(adminUserId, mailboxId, id);
		const updated = await this.replies.update(reply.id, {
			title: write.title,
			body: write.body,
			updatedBy: adminUserId,
			updatedAt: new Date().toISOString(),
		});
		if (!updated) throw new NotFoundException('Saved reply not found');
		await this.audit(adminUserId, mailboxId, updated, 'updated');
		return this.view(updated, true);
	}

	async remove(adminUserId: string, mailboxId: string, id: string): Promise<void> {
		const reply = await this.editable(adminUserId, mailboxId, id);
		if (!(await this.replies.delete(reply.id))) throw new NotFoundException('Saved reply not found');
		await this.audit(adminUserId, mailboxId, reply, 'deleted');
	}

	/**
	 * A reply this person may change from this mailbox: their own, or this mailbox's shared one with
	 * the Settings right. Anything else answers 404, so another person's replies are not revealed.
	 */
	private async editable(adminUserId: string, mailboxId: string, id: string): Promise<StoredSavedReply> {
		const rights = await this.rightsIn(adminUserId, mailboxId);
		const reply = await this.replies.findById(id);
		const own = reply?.scope === 'personal' && reply.ownerAdminUserId === adminUserId;
		const sharedHere = reply?.scope === 'shared' && reply.mailboxId === mailboxId;
		if (!reply || (!own && !sharedHere)) throw new NotFoundException('Saved reply not found');
		if (sharedHere && !rights.has('settings')) {
			throw new ForbiddenException({ code: 'mailbox_right_missing', right: 'settings' });
		}
		return reply;
	}

	/** The Send right in this mailbox is needed for any saved reply: they exist to write mail. */
	private async rightsIn(adminUserId: string, mailboxId: string): Promise<ReadonlySet<MailboxRight>> {
		const rights = mailboxRights(await this.access.listForAdminUser(adminUserId), adminUserId, mailboxId);
		if (!rights.size) throw new NotFoundException('Mailbox not found');
		if (!rights.has('send')) throw new ForbiddenException({ code: 'mailbox_right_missing', right: 'send' });
		return rights;
	}

	private view(reply: StoredSavedReply, editable: boolean): SavedReply {
		return {
			id: reply.id,
			scope: reply.scope,
			title: reply.title,
			body: reply.body,
			updatedAt: reply.updatedAt,
			editable,
		};
	}

	private audit(adminUserId: string, mailboxId: string, reply: StoredSavedReply, change: string): Promise<void> {
		return this.books.record(adminUserId, SAVED_REPLY_CHANGED, mailboxId, {
			savedReplyId: reply.id,
			scope: reply.scope,
			change,
		});
	}
}
