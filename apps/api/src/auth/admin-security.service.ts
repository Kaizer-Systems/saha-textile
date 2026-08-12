import { randomUUID } from 'node:crypto';

import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type {
	AdminPasswordChangeRequest,
	AdminPinSetupRequest,
	AdminSecuritySettingsResponse,
	AuditLog,
} from '@saha-textile/contracts';
import type { AuditLogRepository } from '@saha-textile/core-domain';

import { AUDIT_LOG_REPOSITORY } from '../infra/tokens';
import { AuthService } from './auth.service';
import { assertPasswordAcceptable } from './password-policy';
import { assertPinAcceptable } from './pin-policy';
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
	 *
	 * Strength is checked BEFORE that proof, which inverts the usual order for a reason. The
	 * verdict is a fact about a string the caller just typed and reveals nothing about the
	 * account, while an Argon2 verify is deliberately expensive — checking the cheap,
	 * non-secret condition first keeps a request that cannot succeed from costing a hash.
	 */
	async setPin(userId: string, request: AdminPinSetupRequest, requestId: string | null): Promise<void> {
		assertPinAcceptable(request.pin);
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
		// Strength before the proof, for the same reason `setPin` checks the PIN first: the
		// verdict is cheap and reveals nothing about the account, while an Argon2 verify is
		// deliberately expensive and should not be spent on a request that cannot succeed.
		assertPasswordAcceptable(request.newPassword);
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
	 * Answers the same refusal whether the account is missing or the password is wrong. These
	 * endpoints are reached with a session, so the account's existence is not a secret — but
	 * keeping one answer means a future caller cannot accidentally build an oracle out of the
	 * difference.
	 *
	 * ## Why 403 and not 401
	 *
	 * The locked rule is `401` for an absent or invalid session and `403` for a caller who is
	 * authenticated but not sufficiently authorized. Somebody reaching this line HAS a valid
	 * admin session — the global guard already proved it — and has failed a step-up proof for
	 * one operation. That is the second case, not the first.
	 *
	 * It was 401, and that had a consequence beyond taxonomy. Both Angular interceptors read
	 * a 401 as "this session is gone": on a credential-classified route they clear the session
	 * store immediately, and on any other route they rotate, replay, receive the same refusal
	 * and clear it anyway. Either way a mistyped current password on the Security Settings
	 * form signed the operator out of a session the server considers perfectly alive. No route
	 * classification avoids that, because both branches end in the same call — the status code
	 * was carrying a meaning the client could not help but act on.
	 *
	 * The same reasoning will apply to storefront step-up, email change and set-password when
	 * those are wired: a proof failure is not a session failure.
	 */
	private async requireRecentPasswordProof(userId: string, currentPassword: string) {
		const user = await this.auth.findAuthUserById(userId);
		if (!user || !(await this.auth.verifyPassword(user, currentPassword))) {
			throw new ForbiddenException('Invalid credentials');
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
