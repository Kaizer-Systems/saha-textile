import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type {
	AccessTokenClaims,
	AuthSession,
	SessionAudience,
	SessionRevokeReason,
	UserRole,
} from '@saha-textile/contracts';
import type { AuthPort, AuthSessionRepository, AuthUserRepository } from '@saha-textile/core-domain';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { cookieNames, csrfCookieOptions, sessionCookieOptions } from '../common/cookies';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AUTH_PORT, AUTH_SESSION_REPOSITORY, AUTH_USER_REPOSITORY } from '../infra/tokens';

/** Result of establishing or refreshing a session. Tokens go to COOKIES, never a body. */
export interface EstablishedSession {
	session: AuthSession;
	csrfToken: string;
}

interface SessionUser {
	id: string;
	role: UserRole;
	tokenVersion: number;
	permissionsVersion: number;
}

export interface LiveSessionExpectation {
	userId?: string;
	audience?: SessionAudience;
}

/**
 * Session lifetimes. Admin idles out faster than storefront because an unattended admin
 * tab is a materially worse exposure; the absolute cap bounds a stolen refresh token
 * even if it is used continuously.
 */
const IDLE_TTL_SECONDS: Record<SessionAudience, number> = {
	storefront: 60 * 60 * 24 * 30,
	admin: 60 * 15,
};
const ABSOLUTE_TTL_SECONDS: Record<SessionAudience, number> = {
	storefront: 60 * 60 * 24 * 90,
	admin: 60 * 60 * 12,
};

@Injectable()
export class SessionService {
	private readonly logger = new Logger(SessionService.name);

	constructor(
		@Inject(APP_CONFIG) private readonly config: AppConfig,
		@Inject(AUTH_PORT) private readonly auth: AuthPort,
		@Inject(AUTH_SESSION_REPOSITORY) private readonly sessions: AuthSessionRepository,
		@Inject(AUTH_USER_REPOSITORY) private readonly authUsers: AuthUserRepository,
	) {}

	/**
	 * Hashes an opaque token with the server pepper.
	 *
	 * HMAC, not a plain digest: without the server-side key, a database dump alone does
	 * not let an attacker verify guesses offline. Opaque tokens carry 256 bits of entropy,
	 * so no slow KDF is needed — there is nothing to brute force.
	 */
	hashOpaqueToken(value: string): string {
		return createHmac('sha256', this.tokenPepper()).update(value).digest('hex');
	}

	private hash(value: string): string {
		return this.hashOpaqueToken(value);
	}

	private tokenPepper(): string {
		return this.config.cookies.csrfSecret ?? this.config.jwt.refreshSecret;
	}

	/** 256 bits of CSPRNG entropy — refresh tokens are opaque, never JWTs. */
	private opaqueToken(): string {
		return randomBytes(32).toString('base64url');
	}

	/**
	 * Fail-closed liveness check for an AuthSession row.
	 *
	 * Missing, revoked, idle-expired, absolute-expired, or identity-mismatched sessions
	 * are all rejected. Callers must not fall open when this returns false.
	 */
	isLiveSession(session: AuthSession | null | undefined, expected?: LiveSessionExpectation): session is AuthSession {
		if (!session) return false;
		if (session.revokedAt) return false;
		const nowMs = Date.now();
		if (new Date(session.expiresAt).getTime() <= nowMs) return false;
		if (new Date(session.absoluteExpiresAt).getTime() <= nowMs) return false;
		if (expected?.userId && session.userId !== expected.userId) return false;
		if (expected?.audience && session.audience !== expected.audience) return false;
		return true;
	}

	async findLiveById(sessionId: string, expected?: LiveSessionExpectation): Promise<AuthSession | null> {
		const session = await this.sessions.findById(sessionId);
		return this.isLiveSession(session, expected) ? session : null;
	}

	/**
	 * Resolves the live AuthSession for CSRF/session binding.
	 *
	 * Prefer the access-cookie `sid` (authenticated identity) so CSRF is bound to the
	 * session the access token claims, not whichever refresh cookie happens to resolve.
	 * Fall back to the refresh cookie when the access JWT is absent or unverifiable
	 * (refresh / logout paths).
	 */
	async resolveLiveSessionFromRequest(request: FastifyRequest): Promise<AuthSession | null> {
		const names = cookieNames(this.config);
		const access = this.readCookie(request, names.access);
		if (access) {
			try {
				const claims = (await this.auth.verifyToken(access)) as unknown as Record<string, unknown>;
				const sessionId = String(claims.sid ?? '');
				const userId = String(claims.sub ?? '');
				const audience = claims.aud as SessionAudience | undefined;
				if (sessionId && userId && audience) {
					return this.findLiveById(sessionId, { userId, audience });
				}
			} catch {
				// Access JWT expired/invalid — refresh may still identify a live session.
			}
		}

		const refresh = this.readCookie(request, names.refresh);
		if (!refresh) return null;
		const session = await this.sessions.findByRefreshTokenHash(this.hash(refresh));
		return this.isLiveSession(session) ? session : null;
	}

	/**
	 * Issues or preserves a CSRF token.
	 *
	 * Policy B (active session): do not replace a still-valid session-bound token on GET —
	 * cross-site top-level navigations send SameSite=lax cookies and must not become a
	 * session DoS primitive. If the readable cookie is missing or no longer matches the
	 * stored hash, recover by atomically rotating `csrfSecretHash` and issuing the new
	 * value. Anonymous callers still receive an unbound pre-session token.
	 */
	async issueCsrfToken(request: FastifyRequest, reply: FastifyReply): Promise<string> {
		const names = cookieNames(this.config);
		const session = await this.resolveLiveSessionFromRequest(request);
		const presented = this.readCookie(request, names.csrf);

		if (session) {
			if (presented && this.verifyCsrfForSession(session, presented)) {
				void reply.setCookie(names.csrf, presented, csrfCookieOptions(this.config));
				return presented;
			}

			const csrfToken = this.opaqueToken();
			const updated = await this.sessions.updateCsrfSecretHash(session.id, this.hash(csrfToken));
			if (!updated) {
				throw new UnauthorizedException('Session is no longer valid');
			}
			void reply.setCookie(names.csrf, csrfToken, csrfCookieOptions(this.config));
			return csrfToken;
		}

		const csrfToken = this.opaqueToken();
		void reply.setCookie(names.csrf, csrfToken, csrfCookieOptions(this.config));
		return csrfToken;
	}

	/**
	 * Issues a brand-new session: a fresh refresh family, a session-bound CSRF secret, and
	 * cookies. This is the ONLY place a session is born, so audience, lifetimes, and cookie
	 * attributes cannot drift between login paths.
	 */
	async establish(input: {
		user: SessionUser;
		audience: SessionAudience;
		reply: FastifyReply;
		request: FastifyRequest;
	}): Promise<EstablishedSession> {
		const nowMs = Date.now();
		const refreshToken = this.opaqueToken();
		const csrfToken = this.opaqueToken();

		const session: AuthSession = {
			id: `sess_${randomUUID()}`,
			userId: input.user.id,
			audience: input.audience,
			roleAtLogin: input.user.role,
			refreshTokenHash: this.hash(refreshToken),
			refreshFamilyId: `fam_${randomUUID()}`,
			rotationCounter: 0,
			previousRefreshTokenHash: null,
			replacedBySessionId: null,
			csrfSecretHash: this.hash(csrfToken),
			device: {
				userAgentHash: this.hashHeader(input.request.headers['user-agent']),
				ipHash: this.hashHeader(input.request.ip),
				country: null,
				label: null,
			},
			createdAt: new Date(nowMs).toISOString(),
			lastSeenAt: new Date(nowMs).toISOString(),
			expiresAt: new Date(nowMs + IDLE_TTL_SECONDS[input.audience] * 1000).toISOString(),
			absoluteExpiresAt: new Date(nowMs + ABSOLUTE_TTL_SECONDS[input.audience] * 1000).toISOString(),
			revokedAt: null,
			revokeReason: null,
		};

		await this.sessions.create(session);
		await this.writeCookies({ session, refreshToken, csrfToken, user: input.user, reply: input.reply });
		return { session, csrfToken };
	}

	/**
	 * Rotates a refresh token, with reuse detection.
	 *
	 * Three outcomes:
	 *  - the token matches a live session       → rotate and re-issue;
	 *  - the token matches a session's PREVIOUS hash → it was already rotated away, so it
	 *    leaked: revoke the entire family and refuse. This is the whole point of storing
	 *    the previous hash;
	 *  - no match → refuse.
	 *
	 * The conditional update in the repository is what makes two concurrent refreshes with
	 * the same token safe: one wins, the loser is treated as reuse.
	 */
	/**
	 * Revokes the whole refresh family when the presented token was already rotated away.
	 *
	 * Separated from `refresh()` so it can run BEFORE the CSRF check rather than after it.
	 * Presenting a token that a previous rotation replaced is proof of compromise regardless
	 * of how the request is shaped: only someone who captured that value can produce it,
	 * because the browser holds the current one. Deciding that behind CSRF meant an attacker
	 * with a stolen refresh cookie and no CSRF token received a quiet 403 while the
	 * legitimate session carried on and nothing was recorded — the block held, the alarm did
	 * not sound.
	 *
	 * This cannot be turned into a denial-of-service by a cross-site page: such a request
	 * carries whatever cookie the browser currently holds, which is the CURRENT token, and a
	 * current token is not a previous one. Reaching this branch requires a 256-bit value that
	 * matches a stored previous-token hash.
	 *
	 * Returns `true` when reuse was detected and the family revoked; the caller decides how
	 * to answer. Cookies are cleared either way, because the browser holding them is either
	 * compromised or hopelessly stale.
	 */
	async revokeFamilyIfRefreshReused(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
		const presented = this.readCookie(request, cookieNames(this.config).refresh);
		if (!presented) return false;

		const compromised = await this.sessions.findByPreviousRefreshTokenHash(this.hash(presented));
		if (!compromised) return false;

		const revoked = await this.sessions.revokeFamily(
			compromised.refreshFamilyId,
			'reuse_detected',
			new Date().toISOString(),
		);
		this.logger.warn(
			`Refresh token reuse detected for session ${compromised.id}; revoked ${revoked} session(s) in family ${compromised.refreshFamilyId}`,
		);
		this.clearCookies(reply);
		return true;
	}

	async refresh(input: {
		request: FastifyRequest;
		reply: FastifyReply;
		audience: SessionAudience;
	}): Promise<EstablishedSession> {
		const names = cookieNames(this.config);
		const presented = this.readCookie(input.request, names.refresh);
		if (!presented) throw new UnauthorizedException('No refresh token');

		const presentedHash = this.hash(presented);

		// Normally already handled by `RefreshReuseGuard` before CSRF ran. Kept here so the
		// use case is safe on its own terms: a caller that reaches this method by another
		// path must not be able to rotate with a token that was already replaced.
		if (await this.revokeFamilyIfRefreshReused(input.request, input.reply)) {
			throw new UnauthorizedException('Session revoked');
		}

		const current = await this.sessions.findByRefreshTokenHash(presentedHash);
		if (!current || current.revokedAt || current.audience !== input.audience) {
			this.clearCookies(input.reply);
			throw new UnauthorizedException('Invalid session');
		}

		const nowMs = Date.now();
		if (new Date(current.absoluteExpiresAt).getTime() <= nowMs || new Date(current.expiresAt).getTime() <= nowMs) {
			await this.sessions.revoke(current.id, 'logout', new Date(nowMs).toISOString());
			this.clearCookies(input.reply);
			throw new UnauthorizedException('Session expired');
		}

		const nextRefresh = this.opaqueToken();
		const csrfToken = this.opaqueToken();
		const rotated = await this.sessions.rotate({
			sessionId: current.id,
			nextRefreshTokenHash: this.hash(nextRefresh),
			previousRefreshTokenHash: presentedHash,
			// Rotated in the same update as the refresh token, so cookie and stored hash
			// can never drift apart.
			nextCsrfSecretHash: this.hash(csrfToken),
			expiresAt: new Date(nowMs + IDLE_TTL_SECONDS[current.audience] * 1000).toISOString(),
			lastSeenAt: new Date(nowMs).toISOString(),
		});

		if (!rotated) {
			// Lost the race: another request already rotated this token, so this one is a replay.
			await this.sessions.revokeFamily(current.refreshFamilyId, 'reuse_detected', new Date(nowMs).toISOString());
			this.clearCookies(input.reply);
			throw new UnauthorizedException('Session revoked');
		}

		/**
		 * Re-read the user on every refresh. A refresh is the moment to notice that an
		 * account was disabled or its versions were bumped — minting a new token from stale
		 * in-memory values would let a revoked account keep renewing itself indefinitely.
		 */
		const user = await this.authUsers.findAuthStateById(rotated.userId);
		if (!user || user.status !== 'active') {
			await this.sessions.revokeAllForUser(rotated.userId, 'disabled_user', new Date(nowMs).toISOString());
			this.clearCookies(input.reply);
			throw new UnauthorizedException('Account is not active');
		}

		await this.writeCookies({
			session: rotated,
			refreshToken: nextRefresh,
			csrfToken,
			user: {
				id: user.id,
				role: user.role,
				tokenVersion: user.tokenVersion,
				permissionsVersion: user.permissionsVersion,
			},
			reply: input.reply,
		});
		return { session: rotated, csrfToken };
	}

	async revoke(request: FastifyRequest, reply: FastifyReply, reason: SessionRevokeReason = 'logout'): Promise<void> {
		const presented = this.readCookie(request, cookieNames(this.config).refresh);
		if (presented) {
			const session = await this.sessions.findByRefreshTokenHash(this.hash(presented));
			if (session) await this.sessions.revoke(session.id, reason, new Date().toISOString());
		} else {
			// Access-only logout: still revoke the sid so the access JWT dies immediately.
			const access = this.readCookie(request, cookieNames(this.config).access);
			if (access) {
				try {
					const claims = (await this.auth.verifyToken(access)) as unknown as Record<string, unknown>;
					const sessionId = String(claims.sid ?? '');
					if (sessionId) await this.sessions.revoke(sessionId, reason, new Date().toISOString());
				} catch {
					// Invalid access token — nothing left to revoke server-side.
				}
			}
		}
		this.clearCookies(reply);
	}

	/** Revokes every session a user holds — used by password change, disable, and logout-all. */
	async revokeAllForUser(userId: string, reason: SessionRevokeReason): Promise<number> {
		return this.sessions.revokeAllForUser(userId, reason, new Date().toISOString());
	}

	/**
	 * Verifies that a presented CSRF token belongs to THIS session.
	 *
	 * The Chunk C guard only proved cookie and header agreed, which stops a cross-site
	 * forgery but not a token lifted from another session. Comparing against the session's
	 * stored secret hash closes that.
	 */
	verifyCsrfForSession(session: Pick<AuthSession, 'csrfSecretHash'>, presentedToken: string): boolean {
		const expected = Buffer.from(session.csrfSecretHash, 'utf8');
		const actual = Buffer.from(this.hash(presentedToken), 'utf8');
		return expected.length === actual.length && timingSafeEqual(expected, actual);
	}

	async findByRefreshCookie(request: FastifyRequest): Promise<AuthSession | null> {
		const presented = this.readCookie(request, cookieNames(this.config).refresh);
		return presented ? this.sessions.findByRefreshTokenHash(this.hash(presented)) : null;
	}

	private hashHeader(value: unknown): string | null {
		const text = Array.isArray(value) ? value[0] : value;
		return typeof text === 'string' && text.length > 0 ? this.hash(text) : null;
	}

	private readCookie(request: FastifyRequest, name: string): string | undefined {
		return (request as FastifyRequest & { cookies?: Record<string, string> }).cookies?.[name];
	}

	/**
	 * Writes the access, refresh, and CSRF cookies.
	 *
	 * The access token is a short-lived JWT carrying `sid`, `tokenVersion`, and
	 * `permissionsVersion`. SessionGuard still loads the AuthSession by `sid` so logout
	 * and family revocation take effect immediately without bumping every other session's
	 * tokenVersion.
	 */
	private async writeCookies(input: {
		session: AuthSession;
		refreshToken: string;
		csrfToken: string;
		user: SessionUser;
		reply: FastifyReply;
	}): Promise<void> {
		const names = cookieNames(this.config);
		const claims: Omit<AccessTokenClaims, 'iat' | 'exp'> = {
			iss: 'saha-textile-api',
			aud: input.session.audience,
			sub: input.session.userId,
			sid: input.session.id,
			role: input.session.roleAtLogin,
			tokenVersion: input.user.tokenVersion,
			permissionsVersion: input.user.permissionsVersion,
			jti: randomUUID(),
		};

		const accessToken = await this.auth.signAccessToken(
			claims as unknown as Parameters<AuthPort['signAccessToken']>[0],
		);
		const idleSeconds = Math.max(1, Math.floor((new Date(input.session.expiresAt).getTime() - Date.now()) / 1000));

		void input.reply
			.setCookie(names.access, accessToken, sessionCookieOptions(this.config, idleSeconds))
			.setCookie(names.refresh, input.refreshToken, sessionCookieOptions(this.config, idleSeconds))
			.setCookie(names.csrf, input.csrfToken, csrfCookieOptions(this.config));
	}

	clearCookies(reply: FastifyReply): void {
		const names = cookieNames(this.config);
		const options = sessionCookieOptions(this.config, 0);
		void reply
			.setCookie(names.access, '', options)
			.setCookie(names.refresh, '', options)
			.setCookie(names.csrf, '', csrfCookieOptions(this.config));
	}
}
