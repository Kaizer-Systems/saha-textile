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

	it('checks a Spaces key by listing one object of its bucket, signed', async () => {
		const fetch = vi.fn(
			async (url: URL) =>
				new Response('<ListBucketResult/>', { status: url.pathname === '/saha-textile-media' ? 200 : 403 }),
		);
		vi.stubGlobal('fetch', fetch);
		expect(
			await checkKey('spaces-key', 'TESTACCESS:test/secret+value', [], 'sgp1/saha-textile-media'),
		).toMatchObject({
			state: 'verified',
			account: 'TESTACCESS',
			rights: ['lists saha-textile-media'],
		});
		const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
		expect(url.href).toBe('https://sgp1.digitaloceanspaces.com/saha-textile-media?list-type=2&max-keys=1');
		expect((init.headers as Record<string, string>)['authorization']).toMatch(
			/^AWS4-HMAC-SHA256 Credential=TESTACCESS\/\d{8}\/sgp1\/s3\/aws4_request/,
		);
		expect(await checkKey('spaces-key', 'TESTACCESS:x', [], 'sgp1/other')).toMatchObject({ state: 'failed' });
		expect(await checkKey('spaces-key', 'no-colon', [], 'sgp1/b')).toMatchObject({ state: 'failed' });
		expect(await checkKey('spaces-key', 'A:B', [], '')).toMatchObject({ state: 'failed' });
	});
});
