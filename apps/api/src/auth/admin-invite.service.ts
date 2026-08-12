import { randomUUID } from 'node:crypto';

import { BadRequestException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type {
	AdminInvite,
	AdminInviteAcceptRequest,
	AdminInviteRequest,
	AuditLog,
	User,
} from '@saha-textile/contracts';
import type {
	AdminInviteRepository,
	AuditLogRepository,
	AuthUserRepository,
	NotificationPort,
	TransactionManagerPort,
	UserRepository,
} from '@saha-textile/core-domain';

import {
	ADMIN_INVITE_REPOSITORY,
	AUDIT_LOG_REPOSITORY,
	AUTH_USER_REPOSITORY,
	NOTIFICATION_PORT,
	TRANSACTION_MANAGER,
	USER_REPOSITORY,
} from '../infra/tokens';
import { AuthService } from './auth.service';
import { assertPasswordAcceptable } from './password-policy';
import { assertPinAcceptable } from './pin-policy';

/** Invites expire after seven days — long enough to be actioned, short enough to matter. */
const INVITE_TTL_HOURS = 24 * 7;

@Injectable()
export class AdminInviteService {
	private readonly logger = new Logger(AdminInviteService.name);

	constructor(
		private readonly auth: AuthService,
		@Inject(ADMIN_INVITE_REPOSITORY) private readonly invites: AdminInviteRepository,
		@Inject(AUTH_USER_REPOSITORY) private readonly authUsers: AuthUserRepository,
		@Inject(USER_REPOSITORY) private readonly users: UserRepository,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
		@Inject(NOTIFICATION_PORT) private readonly notifications: NotificationPort,
		@Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManagerPort,
	) {}

	/**
	 * Creates an invite. This is the ONLY way a staff/admin account comes into existence —
	 * there is no admin self-registration (owner lock), so this route is the entire
	 * privilege-granting surface and is audited accordingly.
	 *
	 * The plaintext token leaves exactly once, in the invitation email; only its HMAC is
	 * persisted, so a database read cannot yield a usable invite.
	 */
	async create(input: {
		request: AdminInviteRequest;
		invitedByUserId: string;
		requestId?: string | null;
	}): Promise<AdminInvite> {
		const emailNormalized = this.auth.normalizeEmail(input.request.email);

		// An existing account is not re-invited: changing an established user's role is a
		// different, separately audited operation.
		const existing = await this.authUsers.findAuthStateByEmail(emailNormalized);
		if (existing) throw new BadRequestException('An account already exists for that address');

		const token = `${randomUUID()}${randomUUID()}`.replace(/-/g, '');
		const nowMs = Date.now();

		const invite: AdminInvite = {
			id: `inv_${randomUUID()}`,
			emailNormalized,
			role: input.request.role,
			permissions: input.request.permissions ?? [],
			invitedByUserId: input.invitedByUserId,
			tokenHash: this.auth.hash(token),
			createdAt: new Date(nowMs).toISOString(),
			expiresAt: new Date(nowMs + INVITE_TTL_HOURS * 3600_000).toISOString(),
			acceptedAt: null,
			revokedAt: null,
		};

		// The invite and its audit record commit together: a granted privilege must never
		// exist without the evidence of who granted it.
		await this.transactions.withTransaction(async (context) => {
			await this.invites.create(invite);
			await this.audit.append(
				this.auditEntry(input.invitedByUserId, 'admin.invite.create', invite, input.requestId),
				context,
			);
		});

		await this.notifications.send({
			channel: 'email',
			category: 'transactional',
			templateKey: 'admin_invite',
			destination: emailNormalized,
			variables: { token, role: invite.role },
		});

		return invite;
	}

	/**
	 * Redeems an invite and creates the staff/admin account.
	 *
	 * `consume` is atomic, so two people racing the same link cannot both create an account.
	 *
	 * BOTH credentials are judged for strength FIRST, before the token is consumed. `consume`
	 * is single-use and irreversible: refusing afterwards would spend the invitation on a
	 * request that failed, leaving an invitee unable to accept and an administrator having to
	 * issue a fresh link because somebody typed `123456` or `Password1234`.
	 */
	async accept(request: AdminInviteAcceptRequest): Promise<User> {
		// Both credentials are judged before the invitation is spent, for the reason spelled
		// out above: `consume` is single-use and irreversible.
		assertPasswordAcceptable(request.password);
		if (request.pin) assertPinAcceptable(request.pin);

		const invite = await this.invites.consume(this.auth.hash(request.token), new Date().toISOString());
		// One message for expired, revoked, already-accepted and unknown alike.
		if (!invite) throw new UnauthorizedException('Invalid or expired invitation');

		const passwordHash = await this.auth.hashPassword(request.password);
		const user = await this.users.save({
			id: `user_${randomUUID()}`,
			email: invite.emailNormalized,
			// Accepting the invite proves control of the mailbox it was sent to.
			emailVerified: true,
			phone: null,
			phoneVerified: false,
			displayName: request.displayName,
			role: invite.role,
			status: 'active',
			identities: [{ provider: 'password', email: invite.emailNormalized }],
			addresses: [],
			guestCartId: null,
		});

		await this.authUsers.setPasswordHash(user.id, passwordHash);
		if (request.pin) {
			await this.authUsers.setPinHash(user.id, await this.auth.hashPassword(request.pin));
		}
		if (request.preferredLoginMethod) {
			await this.authUsers.setPreferredLoginMethod(user.id, request.preferredLoginMethod);
		}

		await this.audit.append(this.auditEntry(user.id, 'admin.invite.accept', invite, null));
		this.logger.log(`Admin invite accepted for ${invite.role} account ${user.id}`);
		return user;
	}

	async listPending(): Promise<AdminInvite[]> {
		return this.invites.listPending();
	}

	async revoke(inviteId: string, actorUserId: string, requestId?: string | null): Promise<void> {
		await this.invites.revoke(inviteId, new Date().toISOString());
		await this.audit.append({
			id: `audit_${randomUUID()}`,
			actorUserId,
			targetUserId: null,
			audience: 'admin',
			action: 'admin.invite.revoke',
			entityType: 'adminInvite',
			entityId: inviteId,
			severity: 'warn',
			retentionTier: 'financial_security',
			diffs: [],
			metadata: {},
			requestId: requestId ?? null,
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date().toISOString(),
		});
	}

	/**
	 * Audit rows for privilege changes use the SEVEN-year tier: who was granted admin
	 * access, by whom, and when is security evidence, not routine catalog churn. The email
	 * is recorded because the invite itself is the grant; no token material is ever logged.
	 */
	private auditEntry(actorUserId: string, action: string, invite: AdminInvite, requestId?: string | null): AuditLog {
		return {
			id: `audit_${randomUUID()}`,
			actorUserId,
			targetUserId: null,
			audience: 'admin',
			action,
			entityType: 'adminInvite',
			entityId: invite.id,
			severity: 'warn',
			retentionTier: 'financial_security',
			diffs: [
				{ field: 'role', after: invite.role },
				{ field: 'permissions', after: invite.permissions },
				{ field: 'emailNormalized', after: invite.emailNormalized },
			],
			metadata: {},
			requestId: requestId ?? null,
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date().toISOString(),
		};
	}
}
