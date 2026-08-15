import type {
	AdminInvite,
	AdminUserAuthState,
	AuthSession,
	CustomerAuthState,
	EmailVerificationToken,
	OAuthState,
	OtpChallenge,
	OtpPurpose,
	PasswordResetToken,
	SessionAudience,
	SessionRevokeReason,
	UserStatus,
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
 *
 * `userId` may be a `cus_…` or `adm_…` id; audience on the session disambiguates the
 * population (`DEC-ACCOUNT-SEPARATION`).
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
	 * Persists a UA-derived device label (establish / refresh backfill).
	 * Does not invent hardware IDs — callers pass {@link labelFromUserAgent} output only.
	 */
	updateDeviceLabel(sessionId: string, label: string): Promise<void>;
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
	/**
	 * Current count in the window WITHOUT incrementing it, or 0 when nothing is recorded.
	 *
	 * Needed for failure counting: the decision to refuse has to be made before a credential
	 * is checked, while the counter may only advance once that check has actually failed.
	 * Using `hit` for the decision is what made every successful login spend budget it should
	 * never have touched.
	 */
	peek(key: string, now: string): Promise<number>;
	reset(key: string): Promise<void>;
}

/**
 * Auth-facing view of a storefront customer (`DEC-ACCOUNT-SEPARATION`).
 *
 * Deliberately separate from `CustomerRepository`, which deals in the PUBLIC `Customer`
 * shape. Credential material and version counters are only reachable through this port.
 * Operator credentials live on `AdminUserAuthRepository`.
 */
export interface CustomerAuthRepository {
	findAuthStateById(customerId: string): Promise<CustomerAuthState | null>;
	/** Normalized email lookup for storefront login/reset. Population-scoped (D1). */
	findAuthStateByEmail(emailNormalized: string): Promise<CustomerAuthState | null>;
	setPasswordHash(customerId: string, passwordHash: string): Promise<void>;
	markEmailVerified(customerId: string, emailNormalized: string): Promise<void>;
	/**
	 * Sets the account lifecycle status.
	 *
	 * Offboarding is a status change to `disabled`, never a delete: an audit trail that can
	 * lose its subject is not an audit trail, and a deleted row would also free the email for
	 * re-registration by somebody else.
	 */
	setStatus(customerId: string, status: UserStatus): Promise<void>;
	/** Invalidates every existing access token for this customer. */
	bumpTokenVersion(customerId: string): Promise<number>;
	recordSuccessfulLogin(customerId: string, at: string): Promise<void>;
}

/**
 * Auth-facing view of a back-office operator (`DEC-ACCOUNT-SEPARATION`).
 *
 * PIN, preferred login method, and permissions-version invalidation are operator-only.
 * Identifier lookup is email OR username (admin login).
 */
export interface AdminUserAuthRepository {
	findAuthStateById(adminUserId: string): Promise<AdminUserAuthState | null>;
	/** Admin login accepts email OR username in one field. Population-scoped (D1). */
	findAuthStateByIdentifier(identifier: string): Promise<AdminUserAuthState | null>;
	setPasswordHash(adminUserId: string, passwordHash: string): Promise<void>;
	setPinHash(adminUserId: string, pinHash: string | null): Promise<void>;
	setPreferredLoginMethod(adminUserId: string, method: 'password' | 'pin'): Promise<void>;
	markEmailVerified(adminUserId: string, emailNormalized: string): Promise<void>;
	setStatus(adminUserId: string, status: UserStatus): Promise<void>;
	bumpTokenVersion(adminUserId: string): Promise<number>;
	/** Invalidates every existing token's cached permission set. */
	bumpPermissionsVersion(adminUserId: string): Promise<number>;
	recordSuccessfulLogin(adminUserId: string, at: string): Promise<void>;
	/** Returns the new failure count so the caller can apply lockout policy. */
	recordFailedPinAttempt(adminUserId: string): Promise<number>;
	lockPinUntil(adminUserId: string, until: string): Promise<void>;
	clearPinLock(adminUserId: string): Promise<void>;
	/**
	 * Suspends PIN use after a privileged password reset, and clears that suspension.
	 *
	 * Kept separate from `lockPinUntil`/`clearPinLock` on purpose: the brute-force lock is
	 * time-bounded and self-healing, while this one persists until the administrator proves
	 * the NEW password. Collapsing them would let a fifteen-minute timer silently restore a
	 * credential that a suspected compromise had suspended.
	 */
	setPinRevalidationRequired(adminUserId: string, at: string | null): Promise<void>;
}
