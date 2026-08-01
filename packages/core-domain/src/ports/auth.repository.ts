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
	UserAuthState,
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
	/**
	 * Atomic rotation: consume the current token, issue the next one in the family, and
	 * rotate the session-bound CSRF secret in the SAME update.
	 *
	 * The CSRF secret must move with the token: re-issuing a CSRF cookie without updating
	 * the stored hash leaves the two permanently out of step, and every subsequent
	 * state-changing request fails validation.
	 */
	rotate(input: {
		sessionId: string;
		nextRefreshTokenHash: string;
		previousRefreshTokenHash: string;
		nextCsrfSecretHash: string;
		expiresAt: string;
		lastSeenAt: string;
	}): Promise<AuthSession | null>;
	revoke(sessionId: string, reason: SessionRevokeReason, at: string): Promise<void>;
	/** Reuse detection and password/role changes revoke a whole family at once. */
	revokeFamily(refreshFamilyId: string, reason: SessionRevokeReason, at: string): Promise<number>;
	revokeAllForUser(userId: string, reason: SessionRevokeReason, at: string): Promise<number>;
	touch(sessionId: string, lastSeenAt: string): Promise<void>;
	/**
	 * Rotates only the session-bound CSRF secret (recovery / explicit re-issue).
	 * Returns null when the session is missing or already revoked.
	 */
	updateCsrfSecretHash(sessionId: string, nextCsrfSecretHash: string): Promise<AuthSession | null>;
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

/**
 * Auth-facing view of a user account.
 *
 * Deliberately separate from `UserRepository`, which deals in the PUBLIC `User` shape.
 * Credential material and version counters are only reachable through this port, so a
 * feature repository cannot accidentally load — or return — a password hash.
 */
export interface AuthUserRepository {
	findAuthStateById(userId: string): Promise<UserAuthState | null>;
	/** Normalized email lookup for storefront login/reset. */
	findAuthStateByEmail(emailNormalized: string): Promise<UserAuthState | null>;
	/** Admin login accepts email OR username in one field. */
	findAuthStateByIdentifier(identifier: string): Promise<UserAuthState | null>;
	setPasswordHash(userId: string, passwordHash: string): Promise<void>;
	setPinHash(userId: string, pinHash: string | null): Promise<void>;
	setPreferredLoginMethod(userId: string, method: 'password' | 'pin'): Promise<void>;
	markEmailVerified(userId: string, emailNormalized: string): Promise<void>;
	/** Invalidates every existing access token for this user. */
	bumpTokenVersion(userId: string): Promise<number>;
	/** Invalidates every existing token's cached permission set. */
	bumpPermissionsVersion(userId: string): Promise<number>;
	recordSuccessfulLogin(userId: string, at: string): Promise<void>;
	/** Returns the new failure count so the caller can apply lockout policy. */
	recordFailedPinAttempt(userId: string): Promise<number>;
	lockPinUntil(userId: string, until: string): Promise<void>;
	clearPinLock(userId: string): Promise<void>;
}
