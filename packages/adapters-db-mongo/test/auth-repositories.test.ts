import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import {
	AdminInviteModel,
	AdminUserModel,
	AuthRateLimitModel,
	AuthSessionModel,
	CustomerModel,
	EmailVerificationTokenModel,
	OAuthStateModel,
	OtpChallengeModel,
	PasswordCredentialModel,
	PasswordResetTokenModel,
	PinCredentialModel,
	pinCredentialId,
} from '../src/models/index';
import {
	MongoAdminInviteRepository,
	MongoAdminUserAuthRepository,
	MongoAuthRateLimitRepository,
	MongoAuthSessionRepository,
	MongoCustomerAuthRepository,
	MongoEmailVerificationTokenRepository,
	MongoOAuthStateRepository,
	MongoOtpChallengeRepository,
	MongoPasswordResetTokenRepository,
} from '../src/repositories/index';
import { hasMongoEnv, insertRaw, runPrefix } from './mongo-test-env';

const P = runPrefix('auth');
const at = '2026-11-06T00:00:00.000Z';
const future = '2099-01-01T00:00:00.000Z';
const past = '2000-01-01T00:00:00.000Z';
const date = new Date(at);

describe.skipIf(!hasMongoEnv())('auth repositories (integration, rs0)', () => {
	beforeAll(async () => {
		await connectMongo();
		await Promise.all([
			OtpChallengeModel.syncIndexes(),
			AuthRateLimitModel.syncIndexes(),
			CustomerModel.syncIndexes(),
		]);
	});

	afterAll(async () => {
		const byId = { _id: { $regex: `^${P}` } };
		await Promise.all([
			AdminInviteModel.deleteMany(byId),
			AdminUserModel.deleteMany(byId),
			AuthRateLimitModel.deleteMany(byId),
			AuthSessionModel.deleteMany(byId),
			CustomerModel.deleteMany(byId),
			EmailVerificationTokenModel.deleteMany(byId),
			OAuthStateModel.deleteMany(byId),
			OtpChallengeModel.deleteMany(byId),
			PasswordCredentialModel.deleteMany({ subjectId: { $regex: `^${P}` } }),
			PasswordResetTokenModel.deleteMany(byId),
			PinCredentialModel.deleteMany({ adminUserId: { $regex: `^${P}` } }),
		]);
		await disconnectMongo();
	});

	describe('sessions', () => {
		const repo = new MongoAuthSessionRepository();
		const session = (name: string, overrides: Record<string, unknown> = {}) =>
			({
				id: `${P}${name}`,
				userId: `${P}user`,
				audience: 'storefront',
				roleAtLogin: null,
				refreshTokenHash: `${P}${name}_r`,
				refreshFamilyId: `${P}family`,
				rotationCounter: 0,
				previousRefreshTokenHash: null,
				replacedBySessionId: null,
				csrfSecretHash: 'c',
				device: { userAgentHash: null, ipHash: null, country: null, label: null },
				persistent: true,
				createdAt: at,
				lastSeenAt: at,
				expiresAt: future,
				absoluteExpiresAt: future,
				revokedAt: null,
				revokeReason: null,
				...overrides,
			}) as never;

		it('creates and finds', async () => {
			await repo.create(session('s1'));
			await repo.create(
				session('s2', { audience: 'admin', roleAtLogin: 'admin', revokedAt: at, revokeReason: 'logout' }),
			);
			expect((await repo.findById(`${P}s1`))?.roleAtLogin).toBeNull();
			expect(await repo.findById(`${P}s2`)).toMatchObject({
				roleAtLogin: 'admin',
				revokedAt: at,
				revokeReason: 'logout',
			});
			expect(await repo.findById(`${P}none`)).toBeNull();
			expect((await repo.findByRefreshTokenHash(`${P}s1_r`))?.id).toBe(`${P}s1`);
			expect(await repo.findByRefreshTokenHash(`${P}none`)).toBeNull();
		});

		it('fills the gaps in an old row', async () => {
			await insertRaw(AuthSessionModel, {
				_id: `${P}old`,
				userId: `${P}old_user`,
				audience: 'storefront',
				roleAtLogin: 'customer',
				refreshTokenHash: `${P}old_r`,
				refreshFamilyId: `${P}old_family`,
				csrfSecretHash: 'c',
				createdAt: date,
				lastSeenAt: date,
				expiresAt: date,
				absoluteExpiresAt: date,
			});
			expect(await repo.findById(`${P}old`)).toMatchObject({
				roleAtLogin: null,
				rotationCounter: 0,
				previousRefreshTokenHash: null,
				replacedBySessionId: null,
				device: { label: null },
				persistent: true,
				revokedAt: null,
				revokeReason: null,
			});
		});

		it('lists live sessions, with or without an audience', async () => {
			expect((await repo.listActiveForUser(`${P}user`)).map((row) => row.id)).toEqual([`${P}s1`]);
			expect(await repo.listActiveForUser(`${P}user`, 'admin')).toEqual([]);
			expect(await repo.listActiveForUser(`${P}user`, 'storefront')).toHaveLength(1);
		});

		it('rotates once, then finds the old token', async () => {
			const rotate = () =>
				repo.rotate({
					sessionId: `${P}s1`,
					nextRefreshTokenHash: `${P}s1_next`,
					previousRefreshTokenHash: `${P}s1_r`,
					nextCsrfSecretHash: 'c2',
					expiresAt: future,
					lastSeenAt: at,
				});
			expect((await rotate())?.rotationCounter).toBe(1);
			expect(await rotate()).toBeNull();
			expect((await repo.findByPreviousRefreshTokenHash(`${P}s1_r`))?.id).toBe(`${P}s1`);
			expect(await repo.findByPreviousRefreshTokenHash(`${P}none`)).toBeNull();
		});

		it('touches, labels, and changes the CSRF secret', async () => {
			await repo.touch(`${P}s1`, future);
			await repo.updateDeviceLabel(`${P}s1`, 'Chrome');
			expect(await repo.findById(`${P}s1`)).toMatchObject({ lastSeenAt: future, device: { label: 'Chrome' } });
			expect((await repo.updateCsrfSecretHash(`${P}s1`, 'c3'))?.csrfSecretHash).toBe('c3');
			expect(await repo.updateCsrfSecretHash(`${P}none`, 'c3')).toBeNull();
		});

		it('revokes one, a family, and a user', async () => {
			await repo.create(session('s3'));
			await repo.create(session('s4', { refreshFamilyId: `${P}other` }));
			await repo.revoke(`${P}s1`, 'logout', at);
			expect((await repo.findById(`${P}s1`))?.revokeReason).toBe('logout');
			expect(await repo.revokeFamily(`${P}family`, 'reuse_detected', at)).toBe(1);
			expect(await repo.revokeAllForUser(`${P}user`, 'password_changed', at)).toBe(1);
		});
	});

	describe('OTP challenges', () => {
		const repo = new MongoOtpChallengeRepository();
		const challenge = (name: string, overrides: Record<string, unknown> = {}) =>
			({
				id: `${P}${name}`,
				identifier: `${P}${name}_i`,
				purpose: 'login',
				channel: 'email',
				codeHash: 'h',
				userId: null,
				attempts: 0,
				maxAttempts: 5,
				resendCount: 0,
				lastSentAt: null,
				ipHash: null,
				userAgentHash: null,
				createdAt: at,
				expiresAt: future,
				consumedAt: null,
				blockedAt: null,
				...overrides,
			}) as never;

		it('replaces an active challenge and finds it', async () => {
			await repo.upsertActive(challenge('o1'));
			await repo.upsertActive(challenge('o2', { identifier: `${P}o1_i`, lastSentAt: at }));
			expect(await repo.findActive(`${P}o1_i`, 'login')).toMatchObject({ id: `${P}o2`, lastSentAt: at });
			expect(await repo.findActive(`${P}none`, 'login')).toBeNull();
		});

		it('stores consumed and blocked dates', async () => {
			await repo.upsertActive(challenge('o3', { consumedAt: at, blockedAt: at }));
			expect(await repo.findActive(`${P}o3_i`, 'login')).toBeNull();
		});

		it('fills the gaps in an old row', async () => {
			await insertRaw(OtpChallengeModel, {
				_id: `${P}old`,
				identifier: `${P}old_i`,
				purpose: 'login',
				channel: 'email',
				codeHash: 'h',
				createdAt: date,
				expiresAt: new Date(future),
				consumedAt: null,
			});
			expect(await repo.findActive(`${P}old_i`, 'login')).toMatchObject({
				userId: null,
				attempts: 0,
				maxAttempts: 5,
				resendCount: 0,
				ipHash: null,
				userAgentHash: null,
			});
		});

		it('keeps a complete row', async () => {
			await repo.upsertActive(
				challenge('o4', {
					userId: 'u',
					attempts: 1,
					maxAttempts: 3,
					resendCount: 2,
					ipHash: 'i',
					userAgentHash: 'a',
				}),
			);
			expect(await repo.findActive(`${P}o4_i`, 'login')).toMatchObject({
				userId: 'u',
				attempts: 1,
				maxAttempts: 3,
				resendCount: 2,
				ipHash: 'i',
				userAgentHash: 'a',
			});
		});

		it('counts attempts, and answers 0 for a stranger', async () => {
			expect(await repo.incrementAttempts(`${P}o2`)).toBe(1);
			expect(await repo.incrementAttempts(`${P}none`)).toBe(0);
		});

		it('consumes once', async () => {
			expect(await repo.consume(`${P}o2`, at)).toBe(true);
			expect(await repo.consume(`${P}o2`, at)).toBe(false);
		});

		it('revokes what is open for a person', async () => {
			await repo.upsertActive(challenge('o5', { userId: `${P}u5` }));
			expect(await repo.revokeOpenFor({ userId: `${P}u5`, identifiers: [] }, at)).toBe(1);
		});

		it('deletes what has expired, and copes with a missing count', async () => {
			await repo.upsertActive(challenge('o6', { expiresAt: past }));
			expect(await repo.deleteExpired(past)).toBeGreaterThanOrEqual(1);
			const spy = vi.spyOn(OtpChallengeModel, 'deleteMany').mockReturnValue({ exec: async () => ({}) } as never);
			expect(await repo.deleteExpired(past)).toBe(0);
			spy.mockRestore();
		});
	});

	describe('OAuth states', () => {
		const repo = new MongoOAuthStateRepository();
		const state = (name: string, overrides: Record<string, unknown> = {}) =>
			({
				id: `${P}${name}`,
				provider: 'google',
				audience: 'storefront',
				stateHash: `${P}${name}_h`,
				nonceHash: null,
				codeVerifierHash: null,
				redirectAfterLogin: null,
				guestCartId: null,
				ipHash: null,
				userAgentHash: null,
				createdAt: at,
				expiresAt: future,
				consumedAt: null,
				...overrides,
			}) as never;

		it('consumes once', async () => {
			await repo.create(state('a1'));
			expect(await repo.consume(`${P}a1_h`)).toMatchObject({ id: `${P}a1`, nonceHash: null, ipHash: null });
			expect(await repo.consume(`${P}a1_h`)).toBeNull();
		});

		it('keeps a complete row, and stores a consumed one', async () => {
			await repo.create(
				state('a2', {
					nonceHash: 'n',
					codeVerifierHash: 'v',
					redirectAfterLogin: '/x',
					guestCartId: 'g',
					ipHash: 'i',
					userAgentHash: 'a',
				}),
			);
			expect(await repo.consume(`${P}a2_h`)).toMatchObject({
				nonceHash: 'n',
				codeVerifierHash: 'v',
				guestCartId: 'g',
			});
			await repo.create(state('a3', { consumedAt: at }));
			expect(await repo.consume(`${P}a3_h`)).toBeNull();
		});

		it('fills the gaps in an old row', async () => {
			await insertRaw(OAuthStateModel, {
				_id: `${P}old`,
				provider: 'google',
				audience: 'storefront',
				stateHash: `${P}old_h`,
				createdAt: date,
				expiresAt: new Date(future),
				consumedAt: null,
			});
			expect(await repo.consume(`${P}old_h`)).toMatchObject({
				nonceHash: null,
				codeVerifierHash: null,
				redirectAfterLogin: null,
				guestCartId: null,
				ipHash: null,
				userAgentHash: null,
			});
		});

		it('deletes what has expired, and copes with a missing count', async () => {
			await repo.create(state('a4', { expiresAt: past }));
			expect(await repo.deleteExpired(past)).toBeGreaterThanOrEqual(1);
			const spy = vi.spyOn(OAuthStateModel, 'deleteMany').mockReturnValue({ exec: async () => ({}) } as never);
			expect(await repo.deleteExpired(past)).toBe(0);
			spy.mockRestore();
		});
	});

	describe('password reset tokens', () => {
		const repo = new MongoPasswordResetTokenRepository();
		const token = (name: string, overrides: Record<string, unknown> = {}) =>
			({
				id: `${P}${name}`,
				userId: `${P}reset_user`,
				tokenHash: `${P}${name}_t`,
				audience: 'storefront',
				ipHash: 'i',
				userAgentHash: 'a',
				createdAt: at,
				expiresAt: future,
				consumedAt: null,
				...overrides,
			}) as never;

		it('consumes once', async () => {
			await repo.create(token('t1'));
			expect(await repo.consume(`${P}t1_t`, at)).toMatchObject({
				ipHash: 'i',
				userAgentHash: 'a',
				consumedAt: at,
			});
			expect(await repo.consume(`${P}t1_t`, at)).toBeNull();
		});

		it('stores a spent token and reads a row with no hashes', async () => {
			await repo.create(token('t2', { consumedAt: at }));
			expect(await repo.consume(`${P}t2_t`, at)).toBeNull();
			await repo.create(token('t3', { ipHash: null, userAgentHash: null }));
			expect(await repo.consume(`${P}t3_t`, at)).toMatchObject({ ipHash: null, userAgentHash: null });
		});

		it('revokes all and deletes what has expired', async () => {
			await repo.create(token('t4'));
			expect(await repo.revokeAllForUser(`${P}reset_user`, at)).toBe(1);
			await repo.create(token('t5', { expiresAt: past }));
			expect(await repo.deleteExpired(past)).toBeGreaterThanOrEqual(1);
			const spy = vi
				.spyOn(PasswordResetTokenModel, 'deleteMany')
				.mockReturnValue({ exec: async () => ({}) } as never);
			expect(await repo.deleteExpired(past)).toBe(0);
			spy.mockRestore();
		});
	});

	describe('email verification tokens', () => {
		const repo = new MongoEmailVerificationTokenRepository();
		const token = (name: string, overrides: Record<string, unknown> = {}) =>
			({
				id: `${P}${name}`,
				userId: `${P}verify_user`,
				emailNormalized: 'a@example.test',
				tokenHash: `${P}${name}_t`,
				createdAt: at,
				expiresAt: future,
				consumedAt: null,
				...overrides,
			}) as never;

		it('consumes once, and stores a spent token', async () => {
			await repo.create(token('e1'));
			expect((await repo.consume(`${P}e1_t`, at))?.consumedAt).toBe(at);
			expect(await repo.consume(`${P}e1_t`, at)).toBeNull();
			await repo.create(token('e2', { consumedAt: at }));
			expect(await repo.consume(`${P}e2_t`, at)).toBeNull();
		});

		it('revokes all and deletes what has expired', async () => {
			await repo.create(token('e3'));
			expect(await repo.revokeAllForUser(`${P}verify_user`, at)).toBe(1);
			await repo.create(token('e4', { expiresAt: past }));
			expect(await repo.deleteExpired(past)).toBeGreaterThanOrEqual(1);
			const spy = vi
				.spyOn(EmailVerificationTokenModel, 'deleteMany')
				.mockReturnValue({ exec: async () => ({}) } as never);
			expect(await repo.deleteExpired(past)).toBe(0);
			spy.mockRestore();
		});
	});

	describe('admin invites', () => {
		const repo = new MongoAdminInviteRepository();
		const invite = (name: string, overrides: Record<string, unknown> = {}) =>
			({
				id: `${P}${name}`,
				emailNormalized: `${P}${name}@example.test`.toLowerCase(),
				role: 'staff',
				permissions: ['catalog.read'],
				invitedByUserId: 'u',
				tokenHash: `${P}${name}_t`,
				createdAt: at,
				expiresAt: future,
				acceptedAt: null,
				revokedAt: null,
				...overrides,
			}) as never;

		it('finds, lists and consumes once', async () => {
			await repo.create(invite('i1'));
			expect((await repo.findByTokenHash(`${P}i1_t`))?.permissions).toEqual(['catalog.read']);
			expect(await repo.findByTokenHash(`${P}none`)).toBeNull();
			expect((await repo.listPending()).map((row) => row.id)).toContain(`${P}i1`);
			expect((await repo.consume(`${P}i1_t`, at))?.acceptedAt).toBe(at);
			expect(await repo.consume(`${P}i1_t`, at)).toBeNull();
		});

		it('stores answered invites and reads a row with no permissions', async () => {
			await repo.create(invite('i2', { acceptedAt: at, revokedAt: at }));
			expect(await repo.findByTokenHash(`${P}i2_t`)).toMatchObject({ acceptedAt: at, revokedAt: at });
			await insertRaw(AdminInviteModel, {
				_id: `${P}raw`,
				emailNormalized: `${P}raw@example.test`.toLowerCase(),
				role: 'staff',
				tokenHash: `${P}raw_t`,
				createdAt: date,
				expiresAt: date,
			});
			expect((await repo.findByTokenHash(`${P}raw_t`))?.permissions).toEqual([]);
		});

		it('revokes', async () => {
			await repo.create(invite('i3'));
			await repo.revoke(`${P}i3`, at);
			expect((await repo.findByTokenHash(`${P}i3_t`))?.revokedAt).toBe(at);
		});
	});

	describe('rate limits', () => {
		const repo = new MongoAuthRateLimitRepository();

		it('counts hits, peeks, and resets', async () => {
			const key = `${P}ip:login:h1`;
			expect(await repo.hit(key, 60, at)).toBe(1);
			expect(await repo.hit(key, 60, at)).toBe(2);
			expect(await repo.peek(key, at)).toBe(2);
			expect(await repo.peek(key, future)).toBe(0);
			await repo.reset(key);
			expect(await repo.peek(key, at)).toBe(0);
		});

		it('takes a key with no action', async () => {
			expect(await repo.hit(`${P}bare`, 60, at)).toBe(1);
		});

		it('reads a counter with no expiry', async () => {
			await insertRaw(AuthRateLimitModel, { _id: `${P}open`, count: 4, expiresAt: null });
			expect(await repo.peek(`${P}open`, future)).toBe(4);
		});

		const answers = (results: unknown[]) => {
			const queue = [...results];
			return vi.spyOn(AuthRateLimitModel, 'findOneAndUpdate').mockImplementation(
				() =>
					({
						lean: () => ({
							exec: async () => {
								const next = queue.shift();
								if (next instanceof Error) throw next;
								return next;
							},
						}),
					}) as never,
			);
		};
		const duplicate = Object.assign(new Error('E11000'), { code: 11000 });

		it('retries a lost insert race as an update', async () => {
			const spy = answers([duplicate, { count: 7 }]);
			expect(await repo.hit('k', 60, at)).toBe(7);
			spy.mockRestore();
		});

		it('counts one when the row vanishes', async () => {
			const first = answers([null]);
			expect(await repo.hit('k', 60, at)).toBe(1);
			first.mockRestore();
			const second = answers([duplicate, null]);
			expect(await repo.hit('k', 60, at)).toBe(1);
			second.mockRestore();
		});

		it('passes on any other failure', async () => {
			const spy = answers([new Error('disk full')]);
			await expect(repo.hit('k', 60, at)).rejects.toThrow('disk full');
			spy.mockRestore();
		});
	});

	describe('customer auth', () => {
		const repo = new MongoCustomerAuthRepository();
		const id = `${P}cust`;
		const email = `${P}c@example.test`.toLowerCase();
		const phone = `+9198${Date.now().toString().slice(-8)}`;

		beforeAll(async () => {
			await CustomerModel.create({ _id: id, email, phone, displayName: 'C', status: 'active' } as never);
			await insertRaw(CustomerModel, { _id: `${P}bare`, status: 'active', displayName: 'B' });
		});

		it('finds by id, identifier and email', async () => {
			expect((await repo.findAuthStateById(id))?.email).toBe(email);
			expect(await repo.findAuthStateById(`${P}none`)).toBeNull();
			expect((await repo.findAuthStateByIdentifier(` ${email.toUpperCase()} `))?.id).toBe(id);
			expect((await repo.findAuthStateByIdentifier(phone))?.id).toBe(id);
			expect(await repo.findAuthStateByIdentifier(`${P}none@example.test`)).toBeNull();
			expect((await repo.findAuthStateByEmail(email))?.id).toBe(id);
			expect(await repo.findAuthStateByEmail(`${P}none@example.test`)).toBeNull();
		});

		it('fills the gaps in an old row', async () => {
			expect(await repo.findAuthStateById(`${P}bare`)).toMatchObject({
				email: null,
				emailVerified: false,
				passwordHash: null,
				tokenVersion: 0,
				failedLoginAttempts: 0,
			});
		});

		it('sets a password and bumps the token version', async () => {
			await repo.setPasswordHash(id, 'hash');
			expect(await repo.findAuthStateById(id)).toMatchObject({ passwordHash: 'hash', tokenVersion: 1 });
			expect(await repo.bumpTokenVersion(id)).toBe(2);
			expect(await repo.bumpTokenVersion(`${P}none`)).toBe(0);
		});

		it('marks contact details verified', async () => {
			await repo.markEmailVerified(id, email);
			await repo.markPhoneVerified(id, phone);
			const stored = await CustomerModel.findById(id).lean<{ emailVerified: boolean; phoneVerified: boolean }>();
			expect(stored).toMatchObject({ emailVerified: true, phoneVerified: true });
		});

		it('translates a lost race and passes on anything else', async () => {
			const rejecting = (error: unknown) =>
				vi.spyOn(CustomerModel, 'updateOne').mockReturnValue({
					exec: async () => {
						throw error;
					},
				} as never);
			const duplicate = (field: string) => ({ code: 11000, keyPattern: { [field]: 1 } });
			let spy = rejecting(duplicate('email'));
			await expect(repo.markEmailVerified(id, email)).rejects.toMatchObject({ field: 'email' });
			spy.mockRestore();
			spy = rejecting(duplicate('phone'));
			await expect(repo.markPhoneVerified(id, phone)).rejects.toMatchObject({ field: 'phone' });
			spy.mockRestore();
			spy = rejecting(new Error('disk full'));
			await expect(repo.markEmailVerified(id, email)).rejects.toThrow('disk full');
			await expect(repo.markPhoneVerified(id, phone)).rejects.toThrow('disk full');
			spy.mockRestore();
		});

		it('sets a status and records a login', async () => {
			await repo.setStatus(id, 'locked');
			await repo.recordSuccessfulLogin(id, at);
			expect((await repo.findAuthStateById(id))?.status).toBe('locked');
		});
	});

	describe('admin auth', () => {
		const repo = new MongoAdminUserAuthRepository();
		const id = `${P}admin`;
		const email = `${P}a@example.test`.toLowerCase();

		beforeAll(async () => {
			await AdminUserModel.create({
				_id: id,
				email,
				username: `${P}name`,
				displayName: 'A',
				role: 'staff',
				status: 'active',
			} as never);
			await insertRaw(AdminUserModel, { _id: `${P}bare`, role: 'staff', status: 'active', displayName: 'B' });
		});

		it('finds by id and by either identifier', async () => {
			expect((await repo.findAuthStateById(id))?.username).toBe(`${P}name`);
			expect(await repo.findAuthStateById(`${P}none`)).toBeNull();
			expect((await repo.findAuthStateByIdentifier(email))?.id).toBe(id);
			expect((await repo.findAuthStateByIdentifier(`${P}name`))?.id).toBe(id);
			expect(await repo.findAuthStateByIdentifier(`${P}none`)).toBeNull();
		});

		it('fills the gaps in an old row', async () => {
			expect(await repo.findAuthStateById(`${P}bare`)).toMatchObject({
				email: null,
				emailVerified: false,
				username: null,
				pinHash: null,
				preferredLoginMethod: 'password',
				permissions: [],
				tokenVersion: 0,
				permissionsVersion: 0,
				failedLoginAttempts: 0,
				failedPinAttempts: 0,
				pinLockedUntil: null,
				pinRevalidationRequiredAt: null,
			});
		});

		it('sets a password, a PIN and a login method', async () => {
			await repo.setPasswordHash(id, 'hash');
			await repo.setPinHash(id, 'pin-hash');
			await repo.setPreferredLoginMethod(id, 'pin');
			expect(await repo.findAuthStateById(id)).toMatchObject({
				passwordHash: 'hash',
				pinHash: 'pin-hash',
				preferredLoginMethod: 'pin',
				tokenVersion: 1,
			});
		});

		it('locks a PIN, counts failures, and clears the lock', async () => {
			expect(await repo.recordFailedPinAttempt(id)).toBe(1);
			expect(await repo.recordFailedPinAttempt(`${P}none`)).toBe(0);
			await repo.lockPinUntil(id, future);
			await repo.setPinRevalidationRequired(id, at);
			expect(await repo.findAuthStateById(id)).toMatchObject({
				failedPinAttempts: 1,
				pinLockedUntil: future,
				pinRevalidationRequiredAt: at,
			});
			await repo.clearPinLock(id);
			await repo.setPinRevalidationRequired(id, null);
			expect(await repo.findAuthStateById(id)).toMatchObject({
				failedPinAttempts: 0,
				pinLockedUntil: null,
				pinRevalidationRequiredAt: null,
			});
		});

		it('clears PIN trouble on a good login', async () => {
			await repo.lockPinUntil(id, future);
			await repo.recordSuccessfulLogin(id, at);
			expect((await repo.findAuthStateById(id))?.pinLockedUntil).toBeNull();
		});

		it('removes a PIN', async () => {
			await repo.setPinHash(id, null);
			expect(await PinCredentialModel.findById(pinCredentialId(id))).toBeNull();
		});

		it('marks an email, sets a status, and bumps versions', async () => {
			await repo.markEmailVerified(id, email);
			await repo.setStatus(id, 'locked');
			expect(await repo.findAuthStateById(id)).toMatchObject({ emailVerified: true, status: 'locked' });
			expect(await repo.bumpTokenVersion(id)).toBe(2);
			expect(await repo.bumpTokenVersion(`${P}none`)).toBe(0);
			expect(await repo.bumpPermissionsVersion(id)).toBe(1);
			expect(await repo.bumpPermissionsVersion(`${P}none`)).toBe(0);
		});
	});
});
