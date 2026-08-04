import { createHmac, randomInt, randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { OtpPurpose, SessionAudience, User, UserAuthState } from '@saha-textile/contracts';
import {
	AUTH_RATE_LIMIT_POLICY,
	type AuthRateLimitAction,
	type RateLimitDecision,
	decideRateLimit,
	rateLimitClientScope,
} from '@saha-textile/core-domain';
import type {
	AuthPort,
	AuthRateLimitRepository,
	AuthUserRepository,
	EmailVerificationTokenRepository,
	NotificationPort,
	OtpChallengeRepository,
	PasswordResetTokenRepository,
	UserRepository,
} from '@saha-textile/core-domain';

import { APP_CONFIG, type AppConfig } from '../config/app-config';
import {
	AUTH_PORT,
	AUTH_RATE_LIMIT_REPOSITORY,
	AUTH_USER_REPOSITORY,
	EMAIL_VERIFICATION_TOKEN_REPOSITORY,
	NOTIFICATION_PORT,
	OTP_CHALLENGE_REPOSITORY,
	PASSWORD_RESET_TOKEN_REPOSITORY,
	USER_REPOSITORY,
} from '../infra/tokens';

/** Owner lock: five failed PIN attempts lock PIN use for fifteen minutes. */
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCK_MINUTES = 15;

/**
 * A real argon2id hash, used only to spend comparable time when an account does not
 * exist. Without it, "no such user" returns measurably faster than "wrong password" and
 * leaks which addresses are registered — timing is an enumeration channel too.
 */
const DUMMY_ARGON2_HASH =
	'$argon2id$v=19$m=65536,t=3,p=4$c2FoYXRleHRpbGVkdW1teQ$2ZBQm5oWLMlqmZ0PBnVQAvUyEO0Zx8vJZ0Gz0k1p9dI';

/** The two keys an auth action is counted against. `identifier` is absent where none exists. */
export interface RateLimitScopes {
	identifier?: string;
	ip: string;
}

@Injectable()
export class AuthService {
	private readonly logger = new Logger(AuthService.name);

	constructor(
		@Inject(APP_CONFIG) private readonly config: AppConfig,
		@Inject(AUTH_PORT) private readonly auth: AuthPort,
		@Inject(AUTH_USER_REPOSITORY) private readonly authUsers: AuthUserRepository,
		@Inject(USER_REPOSITORY) private readonly users: UserRepository,
		@Inject(OTP_CHALLENGE_REPOSITORY) private readonly otps: OtpChallengeRepository,
		@Inject(PASSWORD_RESET_TOKEN_REPOSITORY) private readonly resets: PasswordResetTokenRepository,
		@Inject(EMAIL_VERIFICATION_TOKEN_REPOSITORY) private readonly verifications: EmailVerificationTokenRepository,
		@Inject(AUTH_RATE_LIMIT_REPOSITORY) private readonly rateLimits: AuthRateLimitRepository,
		@Inject(NOTIFICATION_PORT) private readonly notifications: NotificationPort,
	) {}

	/** Emails match case-insensitively; storing the normalized form keeps lookups exact. */
	normalizeEmail(email: string): string {
		return email.trim().toLowerCase();
	}

	private pepper(): string {
		return this.config.cookies.csrfSecret ?? this.config.jwt.refreshSecret;
	}

	/** HMAC with a server pepper — a database dump alone cannot verify guesses offline. */
	hash(value: string): string {
		return createHmac('sha256', this.pepper()).update(value).digest('hex');
	}

	/**
	 * Reads the current standing WITHOUT consuming anything.
	 *
	 * For failure-counted actions: the decision to refuse has to be made before a credential
	 * is verified, while the counter may only advance once that check has actually failed.
	 * Consuming here is what made every successful login spend budget — and behind
	 * carrier-grade NAT, where thousands of Indian subscribers share one IPv4 address, the
	 * honest majority exhausted it long before an attacker would have.
	 */
	async checkRateLimit(action: AuthRateLimitAction, scopes: RateLimitScopes): Promise<RateLimitDecision> {
		const policy = AUTH_RATE_LIMIT_POLICY[action];
		const now = new Date().toISOString();

		return decideRateLimit(policy, {
			identifier:
				policy.identifier && scopes.identifier !== undefined
					? await this.rateLimits.peek(this.rateLimitKey('identifier', action, scopes.identifier), now)
					: undefined,
			ip: policy.ip ? await this.rateLimits.peek(this.rateLimitKey('ip', action, scopes.ip), now) : undefined,
		});
	}

	/**
	 * Checks and consumes in one step, for actions that spend a real resource on success —
	 * an email sent, an account created. Failure counting cannot protect those, because the
	 * cost lands whether or not the caller was honest.
	 */
	async consumeRateLimit(action: AuthRateLimitAction, scopes: RateLimitScopes): Promise<RateLimitDecision> {
		const decision = await this.checkRateLimit(action, scopes);
		if (!decision.allowed) return decision;
		await this.recordRateLimitEvent(action, scopes);
		return decision;
	}

	/** Records a refused credential attempt against both scopes. */
	async recordRateLimitFailure(action: AuthRateLimitAction, scopes: RateLimitScopes): Promise<void> {
		await this.recordRateLimitEvent(action, scopes);
	}

	/**
	 * Clears the identifier's budget after a successful authentication.
	 *
	 * Deliberately NOT the address budget. Resetting that on success would let an attacker
	 * interleave one login to an account they control and wipe the failure history they had
	 * just accumulated against everyone else's.
	 */
	async clearRateLimitIdentifier(action: AuthRateLimitAction, identifier: string): Promise<void> {
		if (!AUTH_RATE_LIMIT_POLICY[action].identifier) return;
		await this.rateLimits.reset(this.rateLimitKey('identifier', action, identifier));
	}

	private async recordRateLimitEvent(action: AuthRateLimitAction, scopes: RateLimitScopes): Promise<void> {
		const policy = AUTH_RATE_LIMIT_POLICY[action];
		const now = new Date().toISOString();

		if (policy.identifier && scopes.identifier !== undefined) {
			await this.rateLimits.hit(
				this.rateLimitKey('identifier', action, scopes.identifier),
				policy.identifier.windowSeconds,
				now,
			);
		}
		if (policy.ip) {
			await this.rateLimits.hit(this.rateLimitKey('ip', action, scopes.ip), policy.ip.windowSeconds, now);
		}
	}

	/**
	 * Keyed by a HASHED value so the counter collection never becomes a list of who tried to
	 * sign in. The address is first reduced to its rate-limit scope, which collapses an IPv6
	 * address to the /64 its subscriber owns.
	 */
	private rateLimitKey(scope: 'identifier' | 'ip', action: AuthRateLimitAction, value: string): string {
		return `${scope}:${action}:${this.hash(scope === 'ip' ? rateLimitClientScope(value) : value)}`;
	}

	/** Verifies a password, spending equivalent time when the account has none. */
	async verifyPassword(user: UserAuthState | null, plain: string): Promise<boolean> {
		if (!user?.passwordHash) {
			await this.auth.verifyPassword(plain, DUMMY_ARGON2_HASH).catch(() => false);
			return false;
		}
		return this.auth.verifyPassword(plain, user.passwordHash);
	}

	hashPassword(plain: string): Promise<string> {
		return this.auth.hashPassword(plain);
	}

	/**
	 * Issues an OTP challenge and dispatches it.
	 *
	 * Owner lock: WE generate, store and verify the code — no provider OTP widget. The
	 * code is CSPRNG, persisted only as an HMAC, and never logged or returned in a body.
	 */
	async issueOtp(input: {
		identifier: string;
		purpose: OtpPurpose;
		channel: 'email' | 'sms' | 'whatsapp';
		userId?: string | null;
	}): Promise<void> {
		const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
		const nowMs = Date.now();

		await this.otps.upsertActive({
			id: `otp_${randomUUID()}`,
			identifier: this.hash(input.identifier),
			purpose: input.purpose,
			channel: input.channel,
			codeHash: this.hash(code),
			userId: input.userId ?? null,
			attempts: 0,
			maxAttempts: this.config.otp.maxAttempts,
			resendCount: 0,
			lastSentAt: new Date(nowMs).toISOString(),
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date(nowMs).toISOString(),
			expiresAt: new Date(nowMs + this.config.otp.ttlSeconds * 1000).toISOString(),
			consumedAt: null,
			blockedAt: null,
		});

		await this.notifications.send({
			channel: input.channel,
			category: 'transactional',
			templateKey: `otp_${input.purpose}`,
			destination: input.identifier,
			variables: { code },
		});
	}

	/**
	 * Verifies an OTP: single active challenge, attempt-capped, atomically consumed.
	 * Returns null on ANY failure so the caller can answer generically.
	 */
	async verifyOtp(input: {
		identifier: string;
		purpose: OtpPurpose;
		code: string;
	}): Promise<{ userId: string | null } | null> {
		const challenge = await this.otps.findActive(this.hash(input.identifier), input.purpose);
		if (!challenge || challenge.attempts >= challenge.maxAttempts) return null;

		const attempts = await this.otps.incrementAttempts(challenge.id);
		if (attempts > challenge.maxAttempts) return null;
		if (this.hash(input.code) !== challenge.codeHash) return null;

		const consumed = await this.otps.consume(challenge.id, new Date().toISOString());
		if (!consumed) return null;

		return { userId: challenge.userId };
	}

	/**
	 * Starts a password reset. Behaves identically whether or not the address exists —
	 * the caller returns the same generic response either way.
	 */
	async startPasswordReset(email: string, audience: SessionAudience): Promise<void> {
		const normalized = this.normalizeEmail(email);
		const user = await this.authUsers.findAuthStateByEmail(normalized);
		if (!user || user.status !== 'active') return;

		await this.issueResetToken(user.id, normalized, audience);
	}

	/**
	 * Starts admin recovery from an email OR username, mirroring admin login.
	 *
	 * Deliberately NOT an OTP challenge: the owner lock marks admin OTP login
	 * `DO NOT BUILD AS LOGIN`, so recovery issues a single-use, short-lived, hash-only
	 * token delivered by email and nothing else.
	 *
	 * Every rejection returns silently, exactly like the success path, because the caller
	 * answers generically either way. A customer account is refused here for the same
	 * reason it cannot open an admin session at all.
	 */
	async startAdminPasswordReset(identifier: string): Promise<void> {
		const user = await this.authUsers.findAuthStateByIdentifier(identifier.trim().toLowerCase());
		if (!user || user.status !== 'active' || user.role === 'customer') return;
		// The token travels by email. An admin without a recorded address has no recovery
		// channel, and inventing one is not something an unauthenticated request may do.
		if (!user.email) return;

		await this.issueResetToken(user.id, this.normalizeEmail(user.email), 'admin');
	}

	/** Creates the hash-only reset token and dispatches it. The plaintext never persists. */
	private async issueResetToken(userId: string, destination: string, audience: SessionAudience): Promise<void> {
		const token = `${randomUUID()}${randomUUID()}`.replace(/-/g, '');
		const nowMs = Date.now();

		await this.resets.create({
			id: `prt_${randomUUID()}`,
			userId,
			tokenHash: this.hash(token),
			audience,
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date(nowMs).toISOString(),
			expiresAt: new Date(nowMs + 30 * 60 * 1000).toISOString(),
			consumedAt: null,
		});

		await this.notifications.send({
			channel: 'email',
			category: 'transactional',
			templateKey: 'password_reset',
			destination,
			variables: { token },
		});
	}

	/**
	 * Completes a password reset. `setPasswordHash` bumps `tokenVersion` in the same write,
	 * and the caller revokes every session: a reset is the response to a suspected
	 * compromise, so whoever else was signed in must be signed out.
	 */
	async completePasswordReset(
		token: string,
		newPassword: string,
		expectedAudience?: SessionAudience,
	): Promise<{ userId: string } | null> {
		const consumed = await this.resets.consume(this.hash(token), new Date().toISOString());
		if (!consumed) return null;

		// A storefront recovery token must not reset an admin password, or vice versa. The
		// token is consumed either way — it is single-use by construction, and returning it
		// to the pool after an audience mismatch would let it be retried against the right
		// surface.
		if (expectedAudience && consumed.audience !== expectedAudience) return null;

		const passwordHash = await this.auth.hashPassword(newPassword);
		await this.authUsers.setPasswordHash(consumed.userId, passwordHash);
		return { userId: consumed.userId };
	}

	/**
	 * Suspends PIN use after a privileged reset. The hash is kept, not deleted: the owner
	 * decision requires an explicit revalidation state whose transitions can be audited.
	 */
	async requirePinRevalidation(userId: string): Promise<void> {
		await this.authUsers.setPinRevalidationRequired(userId, new Date().toISOString());
	}

	async issueEmailVerification(userId: string, email: string): Promise<void> {
		const normalized = this.normalizeEmail(email);
		const token = `${randomUUID()}${randomUUID()}`.replace(/-/g, '');
		const nowMs = Date.now();

		await this.verifications.create({
			id: `evt_${randomUUID()}`,
			userId,
			emailNormalized: normalized,
			tokenHash: this.hash(token),
			createdAt: new Date(nowMs).toISOString(),
			expiresAt: new Date(nowMs + 24 * 60 * 60 * 1000).toISOString(),
			consumedAt: null,
		});

		await this.notifications.send({
			channel: 'email',
			category: 'transactional',
			templateKey: 'verify_email',
			destination: normalized,
			variables: { token },
		});
	}

	async completeEmailVerification(token: string): Promise<boolean> {
		const consumed = await this.verifications.consume(this.hash(token), new Date().toISOString());
		if (!consumed) return false;
		await this.authUsers.markEmailVerified(consumed.userId, consumed.emailNormalized);
		return true;
	}

	/**
	 * Verifies an admin PIN under the locked policy: five failures lock PIN use for fifteen
	 * minutes. Password login stays available throughout — the lock is on the METHOD, not
	 * the account.
	 */
	async verifyAdminPin(
		user: UserAuthState,
		pin: string,
	): Promise<'ok' | 'locked' | 'revalidation_required' | 'invalid'> {
		// Checked BEFORE the brute-force lock and before the hash: a password reset answered
		// a suspected compromise, so the PIN must not be usable again — for full login or for
		// quick-resume — until the new password has actually been used once.
		if (user.pinRevalidationRequiredAt) return 'revalidation_required';
		if (user.pinLockedUntil && new Date(user.pinLockedUntil).getTime() > Date.now()) return 'locked';
		if (!user.pinHash) return 'invalid';

		if (await this.auth.verifyPassword(pin, user.pinHash)) {
			await this.authUsers.clearPinLock(user.id);
			return 'ok';
		}

		const attempts = await this.authUsers.recordFailedPinAttempt(user.id);
		if (attempts >= PIN_MAX_ATTEMPTS) {
			await this.authUsers.lockPinUntil(
				user.id,
				new Date(Date.now() + PIN_LOCK_MINUTES * 60 * 1000).toISOString(),
			);
			this.logger.warn(`PIN locked for user ${user.id} after ${attempts} failed attempts`);
			return 'locked';
		}
		return 'invalid';
	}

	findAuthUserByEmail(email: string): Promise<UserAuthState | null> {
		return this.authUsers.findAuthStateByEmail(this.normalizeEmail(email));
	}

	findAuthUserByIdentifier(identifier: string): Promise<UserAuthState | null> {
		return this.authUsers.findAuthStateByIdentifier(identifier.trim().toLowerCase());
	}

	findAuthUserById(userId: string): Promise<UserAuthState | null> {
		return this.authUsers.findAuthStateById(userId);
	}

	/** Loads the PUBLIC user projection for a response body — never the auth state. */
	async publicUser(userId: string): Promise<User> {
		const user = await this.users.findById(userId);
		if (!user) throw new UnauthorizedException('Account not found');
		return user;
	}

	get userRepository(): UserRepository {
		return this.users;
	}

	get authUserRepository(): AuthUserRepository {
		return this.authUsers;
	}
}
