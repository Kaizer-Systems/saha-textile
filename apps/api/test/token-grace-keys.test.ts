import { randomBytes } from 'node:crypto';

import type { Cart } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { TokenHasher } from '../src/auth/token-hasher';
import { CartService } from '../src/cart/cart.service';
import { loadConfig } from '../src/config/app-config';
import { Argon2JwtAuth } from '../src/infra/argon2-jwt.auth';

/**
 * Grace keys (Release Path brief, owner 2026-11-23): for 30 days after a planned change the previous
 * sign-in, CSRF and mailbox keys are still accepted, so nobody is signed out; new tokens and hashes
 * always use the current key.
 */
const base = {
	JWT_ACCESS_SECRET: 'access-current-'.padEnd(40, 'a'),
	JWT_REFRESH_SECRET: 'refresh-current-'.padEnd(40, 'r'),
	CSRF_SECRET: 'csrf-current-'.padEnd(40, 'c'),
};
const load = (overrides: Record<string, string | undefined> = {}) =>
	loadConfig({ ...base, ...overrides } as NodeJS.ProcessEnv);

describe('TokenHasher', () => {
	it('hashes with the current key and has one candidate when nothing is kept', () => {
		const tokens = new TokenHasher(load());
		expect(tokens.candidates('abc')).toHaveLength(1);
		expect(tokens.hash('abc')).toBe(tokens.candidates('abc')[0]);
		expect(tokens.matches('abc', tokens.hash('abc'))).toBe(true);
		expect(tokens.matches('abc', null)).toBe(false);
		expect(tokens.matches('abd', tokens.hash('abc'))).toBe(false);
	});

	it('matches hashes made with the previous CSRF key, and still writes with the current one', async () => {
		const before = new TokenHasher(load());
		const oldHash = before.hash('session-token');
		const after = new TokenHasher(
			load({ CSRF_SECRET: 'csrf-new-'.padEnd(40, 'n'), CSRF_SECRET_PREVIOUS: base.CSRF_SECRET }),
		);
		expect(after.hash('session-token')).not.toBe(oldHash);
		expect(after.candidates('session-token')).toEqual([after.hash('session-token'), oldHash]);
		expect(after.matches('session-token', oldHash)).toBe(true);
		const lookup = vi.fn(async (hash: string) => (hash === oldHash ? { id: 's1' } : null));
		expect(await after.find('session-token', lookup)).toEqual({
			found: { id: 's1' },
			hash: oldHash,
			current: false,
		});
		expect(lookup).toHaveBeenCalledTimes(2);
		expect(await after.find('unknown', lookup)).toBeNull();
	});

	it('drops nothing-but-noise: a previous key equal to the current one, or the refresh key when CSRF is set', () => {
		expect(new TokenHasher(load({ CSRF_SECRET_PREVIOUS: base.CSRF_SECRET })).candidates('x')).toHaveLength(1);
		expect(
			new TokenHasher(load({ JWT_REFRESH_SECRET_PREVIOUS: 'refresh-old-'.padEnd(40, 'o') })).candidates('x'),
		).toHaveLength(1);
	});

	it('uses the previous refresh key as the token key only when there is no CSRF key', () => {
		const old = 'refresh-old-'.padEnd(40, 'o');
		const before = new TokenHasher(load({ CSRF_SECRET: undefined, JWT_REFRESH_SECRET: old }));
		const after = new TokenHasher(load({ CSRF_SECRET: undefined, JWT_REFRESH_SECRET_PREVIOUS: old }));
		expect(after.matches('t', before.hash('t'))).toBe(true);
	});

	it('after a leak (no previous key) the old hashes stop matching at once', () => {
		const oldHash = new TokenHasher(load()).hash('t');
		expect(new TokenHasher(load({ CSRF_SECRET: 'csrf-new-'.padEnd(40, 'n') })).matches('t', oldHash)).toBe(false);
	});
});

describe('Argon2JwtAuth with a previous key', () => {
	const claims = { sub: 'cus_1', sid: 's1' } as never;

	it('accepts a token signed with the previous access key, and signs only with the current one', async () => {
		const oldToken = await new Argon2JwtAuth(load()).signAccessToken(claims);
		const rotated = new Argon2JwtAuth(
			load({
				JWT_ACCESS_SECRET: 'access-new-'.padEnd(40, 'n'),
				JWT_ACCESS_SECRET_PREVIOUS: base.JWT_ACCESS_SECRET,
			}),
		);
		expect((await rotated.verifyToken(oldToken)).sub).toBe('cus_1');
		const fresh = await rotated.signAccessToken(claims);
		await expect(new Argon2JwtAuth(load()).verifyToken(fresh)).rejects.toThrow('invalid token');
		const leaked = new Argon2JwtAuth(load({ JWT_ACCESS_SECRET: 'access-new-'.padEnd(40, 'n') }));
		await expect(leaked.verifyToken(oldToken)).rejects.toThrow('invalid token');
	});

	it('accepts a refresh token signed with the previous refresh key', async () => {
		const oldToken = await new Argon2JwtAuth(load()).signRefreshToken(claims);
		const rotated = new Argon2JwtAuth(
			load({
				JWT_REFRESH_SECRET: 'refresh-new-'.padEnd(40, 'n'),
				JWT_REFRESH_SECRET_PREVIOUS: base.JWT_REFRESH_SECRET,
			}),
		);
		expect((await rotated.verifyRefreshToken(oldToken)).sub).toBe('cus_1');
	});
});

describe('guest carts across a key change', () => {
	const cart = (guestToken: string): Cart => ({ id: 'cart_g', userId: null, guestToken, currency: 'INR', lines: [] });

	it('finds a cart stored under the previous key and stores it again under the current one', async () => {
		const oldHash = new TokenHasher(load()).hash('guest-raw');
		const config = load({ CSRF_SECRET: 'csrf-new-'.padEnd(40, 'n'), CSRF_SECRET_PREVIOUS: base.CSRF_SECRET });
		const repo = {
			findByGuestToken: vi.fn(async (hash: string) => (hash === oldHash ? cart(oldHash) : null)),
			save: vi.fn(async (c: Cart) => c),
		};
		const service = new CartService(repo as never, config);
		const found = await service.findGuestCart('guest-raw');
		expect(found?.guestToken).toBe(service.hashGuestToken('guest-raw'));
		expect(repo.save).toHaveBeenCalledTimes(1);
		expect(() => service.assertCartAccess(cart(oldHash), { guestToken: 'guest-raw' } as never)).not.toThrow();
	});

	it('returns a cart found under the current key without saving it', async () => {
		const config = load();
		const hash = new TokenHasher(config).hash('guest-raw');
		const repo = { findByGuestToken: vi.fn(async () => cart(hash)), save: vi.fn() };
		const service = new CartService(repo as never, config);
		expect((await service.findGuestCart('guest-raw'))?.id).toBe('cart_g');
		expect(repo.save).not.toHaveBeenCalled();
		expect(
			await new CartService({ findByGuestToken: vi.fn(async () => null) } as never, config).findGuestCart('x'),
		).toBeNull();
	});
});

describe('previous-key settings', () => {
	it('maps the four names, and refuses a previous mailbox key without a current one', () => {
		const mailbox = randomBytes(32).toString('base64');
		const config = load({
			JWT_ACCESS_SECRET_PREVIOUS: 'p'.repeat(40),
			JWT_REFRESH_SECRET_PREVIOUS: 'q'.repeat(40),
			CSRF_SECRET_PREVIOUS: 's'.repeat(40),
		});
		expect(config.jwt.accessSecretPrevious).toBe('p'.repeat(40));
		expect(config.jwt.refreshSecretPrevious).toBe('q'.repeat(40));
		expect(config.cookies.csrfSecretPrevious).toBe('s'.repeat(40));
		expect(() => load({ MAILBOX_TOKEN_KEY_PREVIOUS: mailbox })).toThrow(
			/MAILBOX_TOKEN_KEY_PREVIOUS goes only with/,
		);
		expect(() => load({ MAILBOX_TOKEN_KEY_PREVIOUS: 'short' })).toThrow(/32 bytes/);
	});
});
