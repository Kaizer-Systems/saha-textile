import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { ConflictException, HttpException, Inject, Injectable, Optional } from '@nestjs/common';
import type { AuditLog, Mailbox } from '@saha-textile/contracts';
import { type AuditLogRepository, type MailboxRepository, MailboxAccessRevoked } from '@saha-textile/core-domain';

import { AUDIT_LOG_REPOSITORY, MAILBOX_REPOSITORY } from '../infra/tokens';

/** How long the Google sign-in may take before its `state` stops being accepted. */
export const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * The OAuth `state`: who started the sign-in, a nonce and an expiry, signed with a key derived
 * from `MAILBOX_TOKEN_KEY`. The callback trusts it instead of the session cookie, because the
 * short-lived access cookie can expire while someone reads Google's consent screen. Google's
 * codes are single-use, so a replayed state carries nothing.
 */
export class MailboxSignInState {
	private readonly key: Buffer;

	constructor(tokenKey: string) {
		this.key = createHmac('sha256', Buffer.from(tokenKey, 'base64')).update('mailbox-oauth-state').digest();
	}

	issue(adminUserId: string, now = Date.now()): string {
		const payload = Buffer.from(
			JSON.stringify({ u: adminUserId, n: randomUUID(), e: now + STATE_TTL_MS }),
		).toString('base64url');
		return `${payload}.${this.sign(payload)}`;
	}

	/** The admin user who started the sign-in, or null for a forged, altered or expired state. */
	verify(state: string, now = Date.now()): string | null {
		const [payload, signature] = state.split('.');
		if (!payload || !signature) return null;
		const expected = Buffer.from(this.sign(payload));
		const given = Buffer.from(signature);
		if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
		try {
			const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { u?: unknown; e?: unknown };
			return typeof body.u === 'string' && typeof body.e === 'number' && body.e > now ? body.u : null;
		} catch {
			return null;
		}
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
	) {}

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
