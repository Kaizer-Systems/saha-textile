import { createHmac, randomInt, randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { OtpPurpose, SessionAudience, User, UserAuthState } from '@saha-textile/contracts';
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

/** Rate-limit windows for auth-sensitive actions (AGENTS §6: rate-limit auth/OTP). */
const RATE_LIMITS = {
	login: { max: 10, windowSeconds: 15 * 60 },
	otp_request: { max: 5, windowSeconds: 15 * 60 },
	otp_verify: { max: 10, windowSeconds: 15 * 60 },
	password_reset: { max: 5, windowSeconds: 60 * 60 },
	pin_login: { max: 5, windowSeconds: 15 * 60 },
} as const;

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
	 * Applies a rate limit, returning whether the caller is still under it. Keyed by a
	 * HASHED identifier so the counter collection never becomes a list of who tried to
	 * sign in.
	 */
	async withinRateLimit(
		action: keyof typeof RATE_LIMITS,
		scope: 'ip' | 'email',
		identifier: string,
	): Promise<boolean> {
		const limit = RATE_LIMITS[action];
		const key = `${scope}:${action}:${this.hash(identifier)}`;
		const count = await this.rateLimits.hit(key, limit.windowSeconds, new Date().toISOString());
		return count <= limit.max;
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

		const token = `${randomUUID()}${randomUUID()}`.replace(/-/g, '');
		const nowMs = Date.now();

		await this.resets.create({
			id: `prt_${randomUUID()}`,
			userId: user.id,
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
			destination: normalized,
			variables: { token },
		});
	}

	/**
	 * Completes a password reset. `setPasswordHash` bumps `tokenVersion` in the same write,
	 * and the caller revokes every session: a reset is the response to a suspected
	 * compromise, so whoever else was signed in must be signed out.
	 */
	async completePasswordReset(token: string, newPassword: string): Promise<{ userId: string } | null> {
		const consumed = await this.resets.consume(this.hash(token), new Date().toISOString());
		if (!consumed) return null;

		const passwordHash = await this.auth.hashPassword(newPassword);
		await this.authUsers.setPasswordHash(consumed.userId, passwordHash);
		return { userId: consumed.userId };
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
	async verifyAdminPin(user: UserAuthState, pin: string): Promise<'ok' | 'locked' | 'invalid'> {
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
