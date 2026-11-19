import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { ConflictException, HttpException, Inject, Injectable, Optional } from '@nestjs/common';
import type { AuditLog, Mailbox } from '@saha-textile/contracts';
import {
	type AdminUserRepository,
	type AuditLogRepository,
	type MailboxRepository,
	MailboxAccessRevoked,
} from '@saha-textile/core-domain';

import { ADMIN_USER_REPOSITORY, AUDIT_LOG_REPOSITORY, MAILBOX_REPOSITORY } from '../infra/tokens';

/** The audit action written for every message sent from the admin. */
export const MESSAGE_SENT = 'mailbox.message_sent';
/** Newest sends read back per lookup; older ones simply show no name. */
const SENT_LOOKUP = 200;

/** One message sent from the admin: Gmail's ids and who sent it. */
export interface SentFromAdmin {
	gmailMessageId: string;
	threadId: string;
	sentBy: string;
	sentAt: string;
}

/** How long the Google sign-in may take before its `state` stops being accepted. */
export const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * The OAuth `state`: who started the sign-in, a nonce and an expiry, signed with a key derived
 * from `MAILBOX_TOKEN_KEY`. The callback trusts it instead of the session cookie, because the
 * short-lived access cookie can expire while someone reads Google's consent screen. The nonce is
 * also stored (hashed) when the sign-in starts and used up by the callback, so a state works once;
 * the callback then checks the admin user is still active and still a super admin.
 */
export class MailboxSignInState {
	private readonly key: Buffer;

	constructor(tokenKey: string) {
		this.key = createHmac('sha256', Buffer.from(tokenKey, 'base64')).update('mailbox-oauth-state').digest();
	}

	issue(adminUserId: string, now = Date.now()): { state: string; nonce: string; expiresAt: number } {
		const nonce = randomUUID();
		const expiresAt = now + STATE_TTL_MS;
		const payload = Buffer.from(JSON.stringify({ u: adminUserId, n: nonce, e: expiresAt })).toString('base64url');
		return { state: `${payload}.${this.sign(payload)}`, nonce, expiresAt };
	}

	/** Who started the sign-in and its nonce, or null for a forged, altered or expired state. */
	verify(state: string, now = Date.now()): { adminUserId: string; nonce: string } | null {
		const [payload, signature] = state.split('.');
		if (!payload || !signature) return null;
		const expected = Buffer.from(this.sign(payload));
		const given = Buffer.from(signature);
		if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
		try {
			const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
				u?: unknown;
				n?: unknown;
				e?: unknown;
			};
			return typeof body.u === 'string' &&
				typeof body.n === 'string' &&
				typeof body.e === 'number' &&
				body.e > now
				? { adminUserId: body.u, nonce: body.n }
				: null;
		} catch {
			return null;
		}
	}

	/** The stored form of a nonce: a hash, so the database never holds a usable state. */
	static nonceHash(nonce: string): string {
		return createHash('sha256').update(nonce).digest('hex');
	}

	private sign(payload: string): string {
		return createHmac('sha256', this.key).update(payload).digest('base64url');
	}
}

/** The answer the admin reads when Google has withdrawn a mailbox's access. */
export const needsReconnect = (address: string) =>
	new ConflictException({ code: 'mailbox_needs_reconnect', message: `${address} needs to be connected again.` });

/** Marks mailboxes Google no longer lets the API into, and writes the audit trail for this area. */
@Injectable()
export class MailboxBookkeeping {
	constructor(
		@Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
		@Optional() @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository | null = null,
		@Optional() @Inject(ADMIN_USER_REPOSITORY) private readonly adminUsers: AdminUserRepository | null = null,
	) {}

	/**
	 * Messages sent from the admin through this mailbox since `since`, newest first, each with
	 * the sender's name. Gmail records only that the mailbox sent a message; the audit trail
	 * records which admin user did (review E8).
	 */
	async sentFromAdmin(mailboxId: string, since: string): Promise<SentFromAdmin[]> {
		if (!this.audit) return [];
		const page = await this.audit.list({
			action: MESSAGE_SENT,
			entityType: 'mailbox',
			entityId: mailboxId,
			from: since,
			page: 1,
			pageSize: SENT_LOOKUP,
		});
		const names = new Map<string, Promise<string>>();
		const nameOf = (id: string) => {
			const known = names.get(id);
			if (known) return known;
			const found = (this.adminUsers?.findById(id) ?? Promise.resolve(null)).then(
				(user) => user?.displayName || user?.username || user?.email?.split('@')[0] || '',
				() => '',
			);
			names.set(id, found);
			return found;
		};
		const rows = await Promise.all(
			page.items.map(async (entry): Promise<SentFromAdmin | null> => {
				const { gmailMessageId, threadId } = entry.metadata as { gmailMessageId?: unknown; threadId?: unknown };
				if (typeof gmailMessageId !== 'string' || typeof threadId !== 'string' || !entry.actorUserId)
					return null;
				const sentBy = await nameOf(entry.actorUserId);
				return sentBy ? { gmailMessageId, threadId, sentBy, sentAt: entry.createdAt } : null;
			}),
		);
		return rows.filter((row): row is SentFromAdmin => row !== null);
	}

	/**
	 * Runs a Gmail call. A withdrawn grant marks the mailbox as needing reconnection and answers
	 * 409; Gmail's own rate limit answers 429; any other Gmail failure answers 502 with no detail.
	 */
	async guard<T>(mailbox: Mailbox, call: () => Promise<T>): Promise<T> {
		try {
			return await call();
		} catch (error) {
			if (error instanceof MailboxAccessRevoked) {
				await this.mailboxes.save({ ...mailbox, status: 'needs_reconnect' });
				throw needsReconnect(mailbox.address);
			}
			if (error instanceof HttpException) throw error;
			const status = (error as { status?: unknown }).status;
			if (status === 429) throw new HttpException('Gmail is busy; try again in a moment.', 429);
			throw new HttpException('Gmail could not be reached.', 502);
		}
	}

	/** Who did what to which mailbox. Access changes are kept as long as security records. */
	async record(
		actorUserId: string | null,
		action: string,
		entityId: string | null,
		metadata: Record<string, unknown>,
	): Promise<void> {
		if (!this.audit) return;
		const entry: AuditLog = {
			id: `audit_${randomUUID()}`,
			actorUserId,
			targetUserId: null,
			audience: 'admin',
			action,
			entityType: 'mailbox',
			entityId,
			severity: 'warn',
			retentionTier: 'financial_security',
			diffs: [],
			metadata,
			requestId: null,
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date().toISOString(),
		};
		await this.audit.append(entry);
	}
}
