import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';

import { AdminSecurityService } from '../src/auth/admin-security.service';
import { Argon2JwtAuth } from '../src/infra/argon2-jwt.auth';

const config = {
	jwt: {
		accessSecret: 'access-secret-for-tests',
		refreshSecret: 'refresh-secret-for-tests',
		accessTtl: '5m',
		refreshTtl: '1h',
	},
} as never;

describe('Argon2JwtAuth', () => {
	const auth = new Argon2JwtAuth(config);
	const claims = { sub: 'cus_1', sid: 's1' } as never;

	it('hashes and verifies a password, and says no to junk', async () => {
		const hash = await auth.hashPassword('Strong-Pass-123!');
		expect(await auth.verifyPassword('Strong-Pass-123!', hash)).toBe(true);
		expect(await auth.verifyPassword('wrong', hash)).toBe(false);
		expect(await auth.verifyPassword('x', 'not-a-hash')).toBe(false);
	});

	it('signs and reads tokens with separate secrets', async () => {
		const access = await auth.signAccessToken(claims);
		const refresh = await auth.signRefreshToken(claims);
		expect((await auth.verifyToken(access)).sub).toBe('cus_1');
		expect((await auth.verifyRefreshToken(refresh)).sub).toBe('cus_1');
		await expect(auth.verifyToken(refresh)).rejects.toThrow('invalid token');
		await expect(auth.verifyRefreshToken(access)).rejects.toThrow('invalid refresh token');
	});

	it('refuses a token whose payload is plain text', async () => {
		const text = jwt.sign('just text', 'access-secret-for-tests');
		await expect(auth.verifyToken(text)).rejects.toThrow('invalid token');
		const refreshText = jwt.sign('just text', 'refresh-secret-for-tests');
		await expect(auth.verifyRefreshToken(refreshText)).rejects.toThrow('invalid refresh token');
	});

	it('passes on a signing failure, or says it failed', async () => {
		const bad = new Argon2JwtAuth({ jwt: { accessSecret: 'x', accessTtl: 'not a duration' } } as never);
		await expect(bad.signAccessToken(claims)).rejects.toBeDefined();
		const spy = vi.spyOn(jwt, 'sign').mockImplementation(((...args: unknown[]) => {
			(args.at(-1) as (error: null, token: undefined) => void)(null, undefined);
		}) as never);
		await expect(auth.signAccessToken(claims)).rejects.toThrow('failed to sign token');
		spy.mockRestore();
	});
});

describe('AdminSecurityService', () => {
	const user = {
		id: 'adm_1',
		pinHash: 'h',
		preferredLoginMethod: 'pin',
		pinLockedUntil: null,
		pinRevalidationRequiredAt: null,
		emailVerified: true,
	};
	const build = () => {
		const repo = {
			findAuthStateById: vi.fn(async () => user as unknown),
			setPinHash: vi.fn(async () => {}),
			setPreferredLoginMethod: vi.fn(async () => {}),
		};
		const auth = {
			adminAuthRepository: repo,
			verifyPassword: vi.fn(async () => true),
			hashPassword: vi.fn(async () => 'hashed'),
		};
		const sessions = { countActiveForUser: vi.fn(async () => 2) };
		const audit = { append: vi.fn(async () => {}) };
		return {
			service: new AdminSecurityService(auth as never, sessions as never, audit as never),
			repo,
			auth,
			audit,
		};
	};
	const action = (audit: { append: ReturnType<typeof vi.fn> }) =>
		audit.append.mock.calls.at(-1)?.[0] as { action: string; diffs: unknown[] };

	it('reports settings without the PIN', async () => {
		const { service, repo } = build();
		expect(await service.settings('adm_1')).toMatchObject({ hasPin: true, activeSessions: 2 });
		repo.findAuthStateById.mockResolvedValue({ ...user, pinHash: null });
		expect((await service.settings('adm_1')).hasPin).toBe(false);
		repo.findAuthStateById.mockResolvedValue(null);
		await expect(service.settings('adm_1')).rejects.toBeInstanceOf(UnauthorizedException);
	});

	it('sets and changes a PIN, with or without a login method', async () => {
		const { service, repo, audit } = build();
		await service.setPin(
			'adm_1',
			{ pin: '482915', currentPassword: 'p', preferredLoginMethod: 'pin' } as never,
			'r',
		);
		expect(repo.setPreferredLoginMethod).toHaveBeenCalledWith('adm_1', 'pin');
		expect(action(audit)).toMatchObject({ action: 'admin.security.pin.change' });
		expect(action(audit).diffs).toHaveLength(2);
		repo.findAuthStateById.mockResolvedValue({ ...user, pinHash: null });
		await service.setPin('adm_1', { pin: '482915', currentPassword: 'p' } as never, null);
		expect(action(audit)).toMatchObject({ action: 'admin.security.pin.set' });
		expect(action(audit).diffs).toHaveLength(1);
		expect(repo.setPreferredLoginMethod).toHaveBeenCalledTimes(1);
	});

	it('removes a PIN and returns to password login', async () => {
		const { service, repo } = build();
		await service.removePin('adm_1', 'p', null);
		expect(repo.setPinHash).toHaveBeenCalledWith('adm_1', null);
		expect(repo.setPreferredLoginMethod).toHaveBeenCalledWith('adm_1', 'password');
	});

	it('needs the password for every change', async () => {
		const { service, repo, auth } = build();
		auth.verifyPassword.mockResolvedValue(false);
		await expect(service.removePin('adm_1', 'p', null)).rejects.toBeInstanceOf(ForbiddenException);
		repo.findAuthStateById.mockResolvedValue(null);
		await expect(service.removePin('adm_1', 'p', null)).rejects.toBeInstanceOf(ForbiddenException);
	});
});
