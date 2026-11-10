import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkKey, githubExpiry, stateWithExpiry } from './key-checks.js';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('key checks', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('turns verified keys expiring two weeks before the end, then expired', () => {
		const now = Date.parse('2026-11-10T00:00:00Z');
		expect(stateWithExpiry('verified', '2026-12-31T00:00:00Z', now)).toBe('verified');
		expect(stateWithExpiry('verified', '2026-11-20T00:00:00Z', now)).toBe('expiring');
		expect(stateWithExpiry('expiring', '2026-11-01T00:00:00Z', now)).toBe('expired');
		expect(stateWithExpiry('failed', '2026-11-01T00:00:00Z', now)).toBe('failed');
	});

	it('reads GitHub’s expiry header', () => {
		expect(githubExpiry('2026-12-01 00:00:00 UTC')).toBe('2026-12-01T00:00:00.000Z');
		expect(githubExpiry(null)).toBeNull();
	});

	it('verifies a GitHub key and its access to each repository', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) =>
				url.endsWith('/user')
					? json({ login: 'kaizer03' }, 200, { 'x-oauth-scopes': 'repo, workflow' })
					: url.endsWith('/hidden')
						? json({}, 404)
						: json({}),
			),
		);
		expect(await checkKey('github-token', 'test-value', ['Kaizer-Systems/saha-textile'])).toMatchObject({
			state: 'verified',
			account: 'kaizer03',
			rights: ['repo', 'workflow'],
		});
		expect(await checkKey('github-token', 'test-value', ['Kaizer-Systems/hidden'])).toMatchObject({
			state: 'failed',
		});
	});

	it('falls back to the account endpoint for a Cloudflare account token', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				if (url.includes('/zones'))
					return json({
						success: true,
						result: [{ name: 'sahatextile.com', account: { id: 'acc1', name: 'Second account' } }],
					});
				if (url.includes('/user/tokens/verify')) return json({ success: false }, 401);
				if (url.includes('/accounts/acc1/tokens/verify'))
					return json({ success: true, result: { status: 'active', expires_on: '2027-01-01T00:00:00Z' } });
				return json({}, 404);
			}),
		);
		expect(await checkKey('cf-read', 'test-value', [])).toMatchObject({
			state: 'verified',
			account: 'Second account',
			rights: ['sees sahatextile.com'],
			expiresAt: '2027-01-01T00:00:00.000Z',
		});
	});

	it('marks a refused DigitalOcean token failed and survives a network error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => json({ id: 'unauthorized' }, 401)),
		);
		expect((await checkKey('do-read', 'test-value', [])).state).toBe('failed');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Promise.reject(new Error('offline'))),
		);
		expect(await checkKey('do-read', 'test-value', [])).toMatchObject({
			state: 'failed',
			note: expect.stringContaining('offline'),
		});
	});
});
