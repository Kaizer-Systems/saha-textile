import { afterEach, describe, expect, it, vi } from 'vitest';

import { cfWrites } from './cf-writes.js';

const API = 'https://api.cloudflare.com/client/v4';
const ACCOUNT = 'account-1';

/** Cloudflare answers made up for the test, by method and path; records what was sent. No real key. */
function cloudflare(routes: Record<string, unknown>) {
	const sent: Array<{ method: string; path: string; body: unknown }> = [];
	const fn = vi.fn(async (url: string, init?: RequestInit) => {
		const method = init?.method ?? 'GET';
		const path = url.slice(API.length);
		sent.push({ method, path, body: init?.body ? (JSON.parse(String(init.body)) as unknown) : null });
		const result = routes[`${method} ${path}`];
		if (result === undefined) return new Response(JSON.stringify({ success: false, errors: [] }), { status: 404 });
		return new Response(JSON.stringify({ success: true, result }), { status: 200 });
	});
	vi.stubGlobal('fetch', fn);
	return sent;
}

afterEach(() => vi.unstubAllGlobals());

describe('Cloudflare Zero Trust writes for a new server', () => {
	it('adds sign-in by email code when the account has only Cloudflare sign-in', async () => {
		const sent = cloudflare({
			[`GET /accounts/${ACCOUNT}/access/identity_providers`]: [{ id: 'idp-1', type: 'cloudflare', name: '' }],
			[`POST /accounts/${ACCOUNT}/access/identity_providers`]: { id: 'idp-2' },
		});
		expect(await cfWrites.emailCodeSignIn('example-key', ACCOUNT)).toBe(true);
		expect(sent.at(-1)).toEqual({
			method: 'POST',
			path: `/accounts/${ACCOUNT}/access/identity_providers`,
			body: { name: 'One-time PIN', type: 'onetimepin', config: {} },
		});
	});

	it('leaves sign-in alone when email codes are already there', async () => {
		const sent = cloudflare({
			[`GET /accounts/${ACCOUNT}/access/identity_providers`]: [{ id: 'idp-3', type: 'onetimepin' }],
		});
		expect(await cfWrites.emailCodeSignIn('example-key', ACCOUNT)).toBe(false);
		expect(sent.map((s) => s.method)).toEqual(['GET']);
	});

	it('switches WARP to include mode with the server’s address and checks it took', async () => {
		const sent = cloudflare({
			[`GET /accounts/${ACCOUNT}/devices/policy/include`]: null,
			[`PUT /accounts/${ACCOUNT}/devices/policy/include`]: [{ address: '10.122.0.4/32' }],
			[`GET /accounts/${ACCOUNT}/devices/policy`]: { include: [{ address: '10.122.0.4/32' }] },
		});
		await cfWrites.warpInclude('example-key', ACCOUNT, ['10.122.0.4/32']);
		expect(sent.find((s) => s.method === 'PUT')?.body).toEqual([
			{ address: '10.122.0.4/32', description: 'Release Console: servers' },
		]);
	});

	it('stops when the device profile is still in exclude mode', async () => {
		cloudflare({
			[`GET /accounts/${ACCOUNT}/devices/policy/include`]: [{ address: '10.122.0.4/32', description: 'x' }],
			[`GET /accounts/${ACCOUNT}/devices/policy`]: { exclude: [{ address: '10.0.0.0/8' }] },
		});
		await expect(cfWrites.warpInclude('example-key', ACCOUNT, ['10.122.0.4/32'])).rejects.toThrow(
			/still in exclude mode/,
		);
	});
});
