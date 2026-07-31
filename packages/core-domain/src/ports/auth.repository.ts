import type {
	AdminInvite,
	AuthSession,
	EmailVerificationToken,
	OAuthState,
	OtpChallenge,
	OtpPurpose,
	PasswordResetToken,
	SessionAudience,
	SessionRevokeReason,
} from '@saha-textile/contracts';

/**
 * Server-side session store (`authSessions`).
 *
 * Every lookup is by HASH, never by the token itself — opaque refresh tokens are stored
 * hashed, so a database read cannot reveal a usable credential.
 *
 * `findByRefreshTokenHash` is what makes reuse detection possible: if a presented token
 * matches a session's PREVIOUS hash, the whole refresh family is compromised and
 * `revokeFamily` must revoke every session sharing `refreshFamilyId`.
 */
export interface AuthSessionRepository {
	findById(sessionId: string): Promise<AuthSession | null>;
	findByRefreshTokenHash(hash: string): Promise<AuthSession | null>;
	/** Matches the token a session was rotated AWAY from — a hit means replay. */
	findByPreviousRefreshTokenHash(hash: string): Promise<AuthSession | null>;
	listActiveForUser(userId: string, audience?: SessionAudience): Promise<AuthSession[]>;
	create(session: AuthSession): Promise<AuthSession>;
	/** Atomic rotation: consume the current token and issue the next one in the family. */
	rotate(input: {
		sessionId: string;
		nextRefreshTokenHash: string;
		previousRefreshTokenHash: string;
		expiresAt: string;
		lastSeenAt: string;
	}): Promise<AuthSession | null>;
	revoke(sessionId: string, reason: SessionRevokeReason, at: string): Promise<void>;
	/** Reuse detection and password/role changes revoke a whole family at once. */
	revokeFamily(refreshFamilyId: string, reason: SessionRevokeReason, at: string): Promise<number>;
	revokeAllForUser(userId: string, reason: SessionRevokeReason, at: string): Promise<number>;
	touch(sessionId: string, lastSeenAt: string): Promise<void>;
}

/**
 * OTP challenge store (`otpChallenges`).
 *
 * Owner locks this port must make possible: a SINGLE active challenge per
 * (identifier × purpose), atomic attempt counting, and atomic consume — so two parallel
 * verifies cannot both succeed. Codes are stored as HMAC hashes and never logged.
 */
export interface OtpChallengeRepository {
	findActive(identifierHash: string, purpose: OtpPurpose): Promise<OtpChallenge | null>;
	/** Replaces any existing active challenge for the same (identifier × purpose). */
	upsertActive(challenge: OtpChallenge): Promise<OtpChallenge>;
	/** Atomically increments attempts and returns the new count (for lockout decisions). */
	incrementAttempts(challengeId: string): Promise<number>;
	/** Atomically marks consumed; returns false when another request won the race. */
	consume(challengeId: string, at: string): Promise<boolean>;
	deleteExpired(now: string): Promise<number>;
}

/** Short-lived OAuth state/nonce store guarding the provider round-trip against CSRF. */
export interface OAuthStateRepository {
	create(state: OAuthState): Promise<OAuthState>;
	/** Single-use: returns the state and deletes it in one atomic step. */
	consume(stateValue: string): Promise<OAuthState | null>;
	deleteExpired(now: string): Promise<number>;
}

/**
 * Single-use token stores for password reset and email verification.
 *
 * Tokens are persisted hashed; `consume` is atomic so a link cannot be replayed, and a
 * successful password reset revokes every session for that user.
 */
export interface PasswordResetTokenRepository {
	create(token: PasswordResetToken): Promise<PasswordResetToken>;
	consume(tokenHash: string, at: string): Promise<PasswordResetToken | null>;
	deleteExpired(now: string): Promise<number>;
}

export interface EmailVerificationTokenRepository {
	create(token: EmailVerificationToken): Promise<EmailVerificationToken>;
	consume(tokenHash: string, at: string): Promise<EmailVerificationToken | null>;
	deleteExpired(now: string): Promise<number>;
}

/** Admin invites — there is no admin self-registration (auth plan lock). */
export interface AdminInviteRepository {
	findByTokenHash(tokenHash: string): Promise<AdminInvite | null>;
	listPending(): Promise<AdminInvite[]>;
	create(invite: AdminInvite): Promise<AdminInvite>;
	consume(tokenHash: string, at: string): Promise<AdminInvite | null>;
	revoke(inviteId: string, at: string): Promise<void>;
}

/**
 * Rate-limit counter store for auth-sensitive actions (login, OTP request/verify, reset).
 *
 * `hit` must be atomic — a counter that can be raced is not a rate limit. Keys are hashed
 * identifiers or IP hashes, never raw addresses.
 */
export interface AuthRateLimitRepository {
	/** Increments the window counter and returns the count after this hit. */
	hit(key: string, windowSeconds: number, now: string): Promise<number>;
	reset(key: string): Promise<void>;
}
