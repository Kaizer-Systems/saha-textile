import { randomUUID } from 'node:crypto';

import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type {
	AdminPasswordChangeRequest,
	AdminPinSetupRequest,
	AdminSecuritySettingsResponse,
	AuditLog,
} from '@saha-textile/contracts';
import type { AuditLogRepository } from '@saha-textile/core-domain';

import { AUDIT_LOG_REPOSITORY } from '../infra/tokens';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

/**
 * An administrator managing their OWN credentials.
 *
 * Separate from `AdminUsersService`, which is one operator acting on another. The rules differ
 * in kind: there is no delegation question here, and the guard that matters is recent-password
 * proof — a hijacked session must not be able to change the credential it rode in on, or to
 * mint an easier second one for itself.
 *
 * Every mutation is audited. A credential change is exactly the event somebody needs to find
 * afterwards when asking how an account was taken over.
 */
@Injectable()
export class AdminSecurityService {
	constructor(
		private readonly auth: AuthService,
		private readonly sessions: SessionService,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
	) {}

	/** What Security Settings renders. Says a PIN EXISTS, never anything about its value. */
	async settings(userId: string): Promise<AdminSecuritySettingsResponse> {
		const user = await this.auth.findAuthUserById(userId);
		if (!user) throw new UnauthorizedException('Authentication required');

		return {
			hasPin: user.pinHash !== null,
			preferredLoginMethod: user.preferredLoginMethod,
			pinLockedUntil: user.pinLockedUntil,
			pinRevalidationRequiredAt: user.pinRevalidationRequiredAt,
			emailVerified: user.emailVerified,
			activeSessions: await this.sessions.countActiveForUser(userId, 'admin'),
		};
	}

	/**
	 * Sets or replaces the PIN.
	 *
	 * Password proof on every change, not only the first: a session that has been taken over
	 * must not be able to add a six-digit credential that then unlocks the account on its own.
	 */
	async setPin(userId: string, request: AdminPinSetupRequest, requestId: string | null): Promise<void> {
		const user = await this.requireRecentPasswordProof(userId, request.currentPassword);
		const existed = user.pinHash !== null;

		await this.auth.authUserRepository.setPinHash(user.id, await this.auth.hashPassword(request.pin));
		if (request.preferredLoginMethod) {
			await this.auth.authUserRepository.setPreferredLoginMethod(user.id, request.preferredLoginMethod);
		}

		await this.audit.append(
			this.entry(user.id, existed ? 'admin.security.pin.change' : 'admin.security.pin.set', requestId, [
				{ field: 'hasPin', before: existed, after: true },
				...(request.preferredLoginMethod
					? [{ field: 'preferredLoginMethod', after: request.preferredLoginMethod }]
					: []),
			]),
		);
	}

	/**
	 * Removes the PIN.
	 *
	 * The preferred method falls back to `password` in the same operation. Leaving it on `pin`
	 * would present an operator with a PIN screen for a credential that no longer exists —
	 * a login they cannot complete and cannot obviously explain.
	 */
	async removePin(userId: string, currentPassword: string, requestId: string | null): Promise<void> {
		const user = await this.requireRecentPasswordProof(userId, currentPassword);

		await this.auth.authUserRepository.setPinHash(user.id, null);
		await this.auth.authUserRepository.setPreferredLoginMethod(user.id, 'password');

		await this.audit.append(
			this.entry(user.id, 'admin.security.pin.remove', requestId, [
				{ field: 'hasPin', before: user.pinHash !== null, after: false },
			]),
		);
	}

	/**
	 * Changes the password, then ends every session including this one.
	 *
	 * `setPasswordHash` bumps `tokenVersion` in the same write, so existing access tokens are
	 * already dead; revoking the sessions as well kills the refresh tokens, which is what
	 * stops a stolen cookie outliving the credential it was obtained under. Signing the
	 * operator out of their own browser is the intended cost — the alternative is a password
	 * change that leaves whoever else was signed in exactly where they were.
	 *
	 * The PIN is deliberately NOT suspended. That is the RESET path's behaviour, and it exists
	 * because a reset answers a suspected compromise; a voluntary change by somebody who
	 * already proved the old password is not the same event.
	 */
	async changePassword(
		userId: string,
		request: AdminPasswordChangeRequest,
		requestId: string | null,
	): Promise<{ revokedSessions: number }> {
		const user = await this.requireRecentPasswordProof(userId, request.currentPassword);

		await this.auth.authUserRepository.setPasswordHash(user.id, await this.auth.hashPassword(request.newPassword));
		const revokedSessions = await this.sessions.revokeAllForUser(user.id, 'password_changed');

		await this.audit.append(
			this.entry(user.id, 'admin.security.password.change', requestId, [
				{ field: 'revokedSessions', after: revokedSessions },
			]),
		);
		return { revokedSessions };
	}

	/**
	 * The recent-password proof itself.
	 *
	 * Answers the same `Invalid credentials` whether the account is missing or the password is
	 * wrong. These endpoints are reached with a session, so the account's existence is not a
	 * secret — but keeping one message means a future caller cannot accidentally build an
	 * oracle out of the difference.
	 */
	private async requireRecentPasswordProof(userId: string, currentPassword: string) {
		const user = await this.auth.findAuthUserById(userId);
		if (!user || !(await this.auth.verifyPassword(user, currentPassword))) {
			throw new UnauthorizedException('Invalid credentials');
		}
		return user;
	}

	private entry(userId: string, action: string, requestId: string | null, diffs: AuditLog['diffs']): AuditLog {
		return {
			id: `audit_${randomUUID()}`,
			// Actor and target are the same account: this is self-service, and recording it as
			// an administrative action on somebody else would misread later.
			actorUserId: userId,
			targetUserId: userId,
			audience: 'admin',
			action,
			entityType: 'user',
			entityId: userId,
			severity: 'warn',
			retentionTier: 'financial_security',
			diffs,
			metadata: {},
			requestId,
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date().toISOString(),
		};
	}
}
