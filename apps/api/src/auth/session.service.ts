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
	private hash(value: string): string {
		return createHmac('sha256', this.tokenPepper()).update(value).digest('hex');
	}

	private tokenPepper(): string {
		return this.config.cookies.csrfSecret ?? this.config.jwt.refreshSecret;
	}

	/** 256 bits of CSPRNG entropy — refresh tokens are opaque, never JWTs. */
	private opaqueToken(): string {
		return randomBytes(32).toString('base64url');
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
	async refresh(input: {
		request: FastifyRequest;
		reply: FastifyReply;
		audience: SessionAudience;
	}): Promise<EstablishedSession> {
		const names = cookieNames(this.config);
		const presented = this.readCookie(input.request, names.refresh);
		if (!presented) throw new UnauthorizedException('No refresh token');

		const presentedHash = this.hash(presented);

		const compromised = await this.sessions.findByPreviousRefreshTokenHash(presentedHash);
		if (compromised) {
			const revoked = await this.sessions.revokeFamily(
				compromised.refreshFamilyId,
				'reuse_detected',
				new Date().toISOString(),
			);
			this.logger.warn(
				`Refresh token reuse detected for session ${compromised.id}; revoked ${revoked} session(s) in family ${compromised.refreshFamilyId}`,
			);
			this.clearCookies(input.reply);
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
	 * `permissionsVersion` so the guard can reject a stale token without a database read
	 * on the hot path, while a password or role change still takes effect immediately.
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
