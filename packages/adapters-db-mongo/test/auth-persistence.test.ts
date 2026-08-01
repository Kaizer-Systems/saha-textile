import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildMongoConfig } from '../src/config';
import { connectMongo, disconnectMongo } from '../src/connection';
import {
	AdminInviteModel,
	AuthRateLimitModel,
	AuthSessionModel,
	OtpChallengeModel,
	PasswordResetTokenModel,
} from '../src/models/index';
import {
	MongoAdminInviteRepository,
	MongoAuthRateLimitRepository,
	MongoAuthSessionRepository,
	MongoOtpChallengeRepository,
	MongoPasswordResetTokenRepository,
} from '../src/repositories/auth.repository';

/**
 * Auth persistence against a REAL replica set. These assert the properties the auth locks
 * actually depend on — atomic single-use consumption, reuse detection, family revocation,
 * one-active-OTP, and race-safe counters — because each of them is the kind of thing that
 * looks fine in a unit test with a fake and fails under concurrency.
 *
 *   RUN_DB_IT=1 pnpm --filter @saha-textile/adapters-db-mongo test
 */
function hasMongoEnv(): boolean {
	if (process.env.RUN_DB_IT !== '1') return false;
	try {
		buildMongoConfig();
		return true;
	} catch {
		return false;
	}
}

const future = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
const past = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const now = () => new Date().toISOString();

const sessionFixture = (overrides: Record<string, unknown> = {}) => ({
	id: `sess_${randomUUID()}`,
	userId: 'user_auth_it',
	audience: 'storefront' as const,
	roleAtLogin: 'customer' as const,
	refreshTokenHash: `hash_${randomUUID()}`,
	refreshFamilyId: `family_${randomUUID()}`,
	rotationCounter: 0,
	previousRefreshTokenHash: null,
	replacedBySessionId: null,
	csrfSecretHash: `csrf_${randomUUID()}`,
	device: { userAgentHash: null, ipHash: null, country: null, label: null },
	createdAt: now(),
	lastSeenAt: now(),
	expiresAt: future(15),
	absoluteExpiresAt: future(60 * 24 * 30),
	revokedAt: null,
	revokeReason: null,
	...overrides,
});

describe.skipIf(!hasMongoEnv())('auth persistence (integration, rs0)', () => {
	const sessions = new MongoAuthSessionRepository();
	const otps = new MongoOtpChallengeRepository();
	const resets = new MongoPasswordResetTokenRepository();
	const invites = new MongoAdminInviteRepository();
	const limits = new MongoAuthRateLimitRepository();

	beforeAll(async () => {
		await connectMongo();
		// Indexes are declared on the schema; build them so the uniqueness tests are real.
		await Promise.all([
			AuthSessionModel.syncIndexes(),
			OtpChallengeModel.syncIndexes(),
			PasswordResetTokenModel.syncIndexes(),
			AdminInviteModel.syncIndexes(),
			AuthRateLimitModel.syncIndexes(),
		]);
	});

	afterAll(async () => {
		await Promise.all([
			AuthSessionModel.deleteMany({ userId: /^user_auth_it/ }).exec(),
			OtpChallengeModel.deleteMany({ identifier: /^it_/ }).exec(),
			PasswordResetTokenModel.deleteMany({ userId: /^user_auth_it/ }).exec(),
			AdminInviteModel.deleteMany({ emailNormalized: /^it_/ }).exec(),
			AuthRateLimitModel.deleteMany({ key: /^ip:login:it_/ }).exec(),
		]);
		await disconnectMongo();
	});

	describe('sessions', () => {
		it('never exposes credential hashes to an unqualified read', async () => {
			const session = sessionFixture();
			await sessions.create(session);

			const raw = await AuthSessionModel.findById(session.id).lean().exec();
			expect(raw).not.toBeNull();
			expect(raw).not.toHaveProperty('refreshTokenHash');
			expect(raw).not.toHaveProperty('csrfSecretHash');

			// The repository asks for them explicitly, so its own reads still work.
			expect((await sessions.findById(session.id))?.refreshTokenHash).toBe(session.refreshTokenHash);
		});

		it('rotates atomically and records the previous hash for reuse detection', async () => {
			const session = sessionFixture();
			await sessions.create(session);

			const nextHash = `hash_${randomUUID()}`;
			const rotated = await sessions.rotate({
				sessionId: session.id,
				nextRefreshTokenHash: nextHash,
				previousRefreshTokenHash: session.refreshTokenHash,
				nextCsrfSecretHash: `csrf_${randomUUID()}`,
				expiresAt: future(15),
				lastSeenAt: now(),
			});

			expect(rotated?.refreshTokenHash).toBe(nextHash);
			expect(rotated?.previousRefreshTokenHash).toBe(session.refreshTokenHash);
			expect(rotated?.rotationCounter).toBe(1);
		});

		it('refuses a second rotation with the same token — the replay loses', async () => {
			const session = sessionFixture();
			await sessions.create(session);

			const first = await sessions.rotate({
				sessionId: session.id,
				nextRefreshTokenHash: `hash_${randomUUID()}`,
				previousRefreshTokenHash: session.refreshTokenHash,
				nextCsrfSecretHash: `csrf_${randomUUID()}`,
				expiresAt: future(15),
				lastSeenAt: now(),
			});
			const replay = await sessions.rotate({
				sessionId: session.id,
				nextRefreshTokenHash: `hash_${randomUUID()}`,
				previousRefreshTokenHash: session.refreshTokenHash,
				nextCsrfSecretHash: `csrf_${randomUUID()}`,
				expiresAt: future(15),
				lastSeenAt: now(),
			});

			expect(first).not.toBeNull();
			expect(replay).toBeNull();
		});

		it('finds a rotated-away token, which is how reuse is detected', async () => {
			const session = sessionFixture();
			await sessions.create(session);
			await sessions.rotate({
				sessionId: session.id,
				nextRefreshTokenHash: `hash_${randomUUID()}`,
				previousRefreshTokenHash: session.refreshTokenHash,
				nextCsrfSecretHash: `csrf_${randomUUID()}`,
				expiresAt: future(15),
				lastSeenAt: now(),
			});

			const compromised = await sessions.findByPreviousRefreshTokenHash(session.refreshTokenHash);
			expect(compromised?.id).toBe(session.id);
		});

		it('revokes an entire refresh family at once', async () => {
			const familyId = `family_${randomUUID()}`;
			await sessions.create(sessionFixture({ refreshFamilyId: familyId }));
			await sessions.create(sessionFixture({ refreshFamilyId: familyId }));
			await sessions.create(sessionFixture());

			const revoked = await sessions.revokeFamily(familyId, 'reuse_detected', now());
			expect(revoked).toBe(2);

			const stillActive = await AuthSessionModel.countDocuments({
				refreshFamilyId: familyId,
				revokedAt: null,
			}).exec();
			expect(stillActive).toBe(0);
		});

		it('lists only active sessions, scoped by audience', async () => {
			const userId = `user_auth_it_${randomUUID()}`;
			await sessions.create(sessionFixture({ userId }));
			await sessions.create(sessionFixture({ userId, audience: 'admin', roleAtLogin: 'admin' }));
			const revokedSession = sessionFixture({ userId });
			await sessions.create(revokedSession);
			await sessions.revoke(revokedSession.id, 'logout', now());

			expect(await sessions.listActiveForUser(userId)).toHaveLength(2);
			expect(await sessions.listActiveForUser(userId, 'admin')).toHaveLength(1);
			expect(await sessions.listActiveForUser(userId, 'storefront')).toHaveLength(1);
		});
	});

	describe('OTP challenges', () => {
		const challenge = (identifier: string, overrides: Record<string, unknown> = {}) => ({
			id: `otp_${randomUUID()}`,
			identifier,
			purpose: 'login' as const,
			channel: 'email' as const,
			codeHash: `hmac_${randomUUID()}`,
			userId: null,
			attempts: 0,
			maxAttempts: 5,
			resendCount: 0,
			lastSentAt: null,
			ipHash: null,
			userAgentHash: null,
			createdAt: now(),
			expiresAt: future(10),
			consumedAt: null,
			blockedAt: null,
			...overrides,
		});

		it('keeps a single active challenge per identifier and purpose', async () => {
			const identifier = `it_${randomUUID()}`;
			await otps.upsertActive(challenge(identifier));
			await otps.upsertActive(challenge(identifier));

			const active = await OtpChallengeModel.countDocuments({ identifier, consumedAt: null }).exec();
			expect(active).toBe(1);
		});

		it('consumes exactly once — a concurrent verify cannot also win', async () => {
			const identifier = `it_${randomUUID()}`;
			const created = challenge(identifier);
			await otps.upsertActive(created);

			const [first, second] = await Promise.all([
				otps.consume(created.id, now()),
				otps.consume(created.id, now()),
			]);
			expect([first, second].filter(Boolean)).toHaveLength(1);
		});

		it('counts attempts atomically', async () => {
			const created = challenge(`it_${randomUUID()}`);
			await otps.upsertActive(created);

			const counts = await Promise.all([
				otps.incrementAttempts(created.id),
				otps.incrementAttempts(created.id),
				otps.incrementAttempts(created.id),
			]);
			expect(Math.max(...counts)).toBe(3);
			expect(new Set(counts).size).toBe(3);
		});

		it('does not return an expired challenge as active', async () => {
			const identifier = `it_${randomUUID()}`;
			await otps.upsertActive(challenge(identifier, { expiresAt: past(1) }));
			expect(await otps.findActive(identifier, 'login')).toBeNull();
		});

		it('hides the code hash from an unqualified read', async () => {
			const created = challenge(`it_${randomUUID()}`);
			await otps.upsertActive(created);
			const raw = await OtpChallengeModel.findById(created.id).lean().exec();
			expect(raw).not.toHaveProperty('codeHash');
		});
	});

	describe('single-use tokens', () => {
		it('consumes a password-reset token exactly once', async () => {
			const token = {
				id: `prt_${randomUUID()}`,
				userId: 'user_auth_it',
				tokenHash: `hash_${randomUUID()}`,
				audience: 'storefront' as const,
				ipHash: null,
				userAgentHash: null,
				createdAt: now(),
				expiresAt: future(30),
				consumedAt: null,
			};
			await resets.create(token);

			expect(await resets.consume(token.tokenHash, now())).not.toBeNull();
			expect(await resets.consume(token.tokenHash, now())).toBeNull();
		});

		it('refuses an expired reset token', async () => {
			const token = {
				id: `prt_${randomUUID()}`,
				userId: 'user_auth_it',
				tokenHash: `hash_${randomUUID()}`,
				audience: 'storefront' as const,
				ipHash: null,
				userAgentHash: null,
				createdAt: past(60),
				expiresAt: past(1),
				consumedAt: null,
			};
			await resets.create(token);
			expect(await resets.consume(token.tokenHash, now())).toBeNull();
		});

		it('accepts an admin invite exactly once', async () => {
			const invite = {
				id: `inv_${randomUUID()}`,
				emailNormalized: `it_${randomUUID()}@example.com`,
				role: 'staff' as const,
				permissions: ['catalog.read'],
				invitedByUserId: 'user_auth_it',
				tokenHash: `hash_${randomUUID()}`,
				createdAt: now(),
				expiresAt: future(60 * 24),
				acceptedAt: null,
				revokedAt: null,
			};
			await invites.create(invite);

			expect((await invites.consume(invite.tokenHash, now()))?.role).toBe('staff');
			expect(await invites.consume(invite.tokenHash, now())).toBeNull();
		});
	});

	describe('rate limits', () => {
		it('increments atomically under concurrency', async () => {
			const key = `ip:login:it_${randomUUID()}`;
			const results = await Promise.all(Array.from({ length: 5 }, () => limits.hit(key, 60, now())));

			// Every parallel hit must observe a distinct count — that is what proves no
			// lost update. A read-then-write implementation would repeat values here.
			expect(new Set(results).size).toBe(5);
			expect(Math.max(...results)).toBe(5);
		});

		it('resets a counter', async () => {
			const key = `ip:login:it_${randomUUID()}`;
			await limits.hit(key, 60, now());
			await limits.reset(key);
			expect(await limits.hit(key, 60, now())).toBe(1);
		});
	});

	describe('TTL policy', () => {
		it('declares a TTL index on every transient auth collection', async () => {
			const ttlOn = async (model: { collection: { indexes: () => Promise<unknown[]> } }) => {
				const indexes = (await model.collection.indexes()) as Array<{ expireAfterSeconds?: number }>;
				return indexes.some((index) => index.expireAfterSeconds !== undefined);
			};

			expect(await ttlOn(AuthSessionModel)).toBe(true);
			expect(await ttlOn(OtpChallengeModel)).toBe(true);
			expect(await ttlOn(PasswordResetTokenModel)).toBe(true);
			expect(await ttlOn(AuthRateLimitModel)).toBe(true);
		});

		it('keeps admin invites OUT of TTL — they are audit evidence, not transient state', async () => {
			const indexes = (await AdminInviteModel.collection.indexes()) as Array<{ expireAfterSeconds?: number }>;
			expect(indexes.some((index) => index.expireAfterSeconds !== undefined)).toBe(false);
		});
	});
});
