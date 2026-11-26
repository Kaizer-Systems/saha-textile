import { afterEach, describe, expect, it, vi } from 'vitest';

import { cfWrites } from './cf-writes.js';
import { doWrites, firewallBody } from './do-writes.js';

/**
 * Cloudflare and DigitalOcean answer locally, by method and the start of the path; the first match
 * wins. Each test sends made-up ids only.
 */
type Route = [string, number, unknown];
function vendor(routes: Route[]) {
	const sent: string[] = [];
	const fn = vi.fn(async (url: string, init?: RequestInit) => {
		const method = init?.method ?? 'GET';
		const path = url.replace(/^https:\/\/[^/]+\/(client\/v4|v2)/, '');
		sent.push(`${method} ${path}`);
		const hit = routes.find(([p]) => `${method} ${path}`.startsWith(p));
		const [, status, body] = hit ?? ['', 200, { success: true, result: null }];
		return new Response(JSON.stringify(body), { status });
	});
	vi.stubGlobal('fetch', fn);
	return sent;
}
const ok = (result: unknown) => ({ success: true, result });

afterEach(() => vi.unstubAllGlobals());

describe('Cloudflare writes', () => {
	it('finds no tunnel by another name, refuses an empty tunnel token, and keeps a record that is already right', async () => {
		vendor([['GET /accounts/a/cfd_tunnel?', 200, ok([{ id: 't', name: 'other' }])]]);
		expect(await cfWrites.tunnelNamed('k', 'a', 'mine')).toBeNull();
		expect(await cfWrites.tunnelNamed('k', 'a', 'other')).toEqual({ id: 't', name: 'other' });
		vendor([['GET /accounts/a/cfd_tunnel/t/token', 200, ok('')]]);
		await expect(cfWrites.tunnelToken('k', 'a', 't')).rejects.toThrow('gave no token');
		vendor([['GET /accounts/a/cfd_tunnel/t/token', 200, ok('example-token')]]);
		expect(await cfWrites.tunnelToken('k', 'a', 't')).toBe('example-token');
		vendor([['GET /zones/z/dns_records', 200, ok([{ type: 'A', content: '203.0.113.9' }])]]);
		expect(await cfWrites.pointHost('k', 'z', 'shop.example.com', '203.0.113.9')).toBe('kept');
		vendor([['GET /zones/z/dns_records', 200, ok([{ type: 'AAAA', content: '2001:db8::1' }])]]);
		await expect(cfWrites.pointHost('k', 'z', 'shop.example.com', '203.0.113.9')).rejects.toThrow(
			'does not overwrite',
		);
		vendor([['GET /zones/z/dns_records', 200, ok([{ type: 'CNAME', content: 't.cfargotunnel.com' }])]]);
		expect(await cfWrites.pointTunnel('k', 'z', 'ssh.example.com', 't')).toBe('kept');
		vendor([['GET /zones/z/dns_records', 200, ok([{ type: 'A', content: '203.0.113.9' }])]]);
		await expect(cfWrites.pointTunnel('k', 'z', 'ssh.example.com', 't')).rejects.toThrow('does not overwrite');
	});

	it('says Access is off when Cloudflare says so, and passes other refusals on', async () => {
		vendor([
			[
				'GET /accounts/a/access/organizations',
				400,
				{ success: false, errors: [{ message: 'access.api.error.not_enabled' }] },
			],
		]);
		expect(await cfWrites.accessEnabled('k', 'a')).toBe(false);
		vendor([['GET /accounts/a/access/organizations', 500, { success: false, errors: [] }]]);
		await expect(cfWrites.accessEnabled('k', 'a')).rejects.toThrow('Cloudflare answered 500.');
	});

	it('rewrites an Access app, a login wall and the WARP app in place when they exist', async () => {
		const sent = vendor([
			[
				'GET /accounts/a/access/apps?domain=',
				200,
				ok([
					{ id: 'app1', domain: 'ssh.example.com' },
					{ id: 'app2', domain: 'shop.example.com' },
				]),
			],
			['GET /accounts/a/access/apps?per_page', 200, ok([{ id: 'warp1', type: 'warp' }])],
			['PUT', 200, ok({ id: 'app1' })],
			['POST', 200, ok({ id: 'new' })],
		]);
		expect(
			await cfWrites.accessApp('k', 'a', {
				name: 'SSH',
				host: 'ssh.example.com',
				tokenId: null,
				emails: ['a@example.com'],
			}),
		).toBe('app1');
		expect(
			await cfWrites.loginWall('k', 'a', {
				name: 'Wall',
				hosts: ['shop.example.com'],
				emails: ['a@example.com'],
			}),
		).toBe('updated');
		await cfWrites.warpEnrollment('k', 'a', ['a@example.com']);
		expect(sent.filter((s) => s.startsWith('PUT /accounts/a/access/apps/')).length).toBe(3);
		vendor([
			['GET /accounts/a/access/apps', 200, ok([])],
			['POST', 200, ok({ id: 'new' })],
		]);
		expect(await cfWrites.loginWall('k', 'a', { name: 'Wall', hosts: ['shop.example.com'], emails: [] })).toBe(
			'created',
		);
		await expect(cfWrites.loginWall('k', 'a', { name: 'Wall', hosts: [], emails: [] })).rejects.toThrow(
			'at least one host',
		);
	});

	it('adds the strict rule beside others when the phase has none yet, and passes other refusals on', async () => {
		vendor([
			['GET /zones/z/rulesets/phases', 404, { success: false, errors: [] }],
			['PUT', 200, ok({})],
		]);
		expect(await cfWrites.sslStrictRule('k', 'z', 'shop SSL', ['shop.example.com'])).toBe('created');
		vendor([
			[
				'GET /zones/z/rulesets/phases',
				200,
				ok({
					rules: [
						{ id: 'r1', description: 'other', expression: 'x', extra: 1 },
						{ id: 'r2', description: 'shop SSL' },
					],
				}),
			],
			['PUT', 200, ok({})],
		]);
		expect(await cfWrites.sslStrictRule('k', 'z', 'shop SSL', ['shop.example.com'])).toBe('updated');
		vendor([['GET /zones/z/rulesets/phases', 500, { success: false, errors: [] }]]);
		await expect(cfWrites.sslStrictRule('k', 'z', 'shop SSL', [])).rejects.toThrow('Cloudflare answered 500.');
	});

	it('reads tokens, certificates, origin pulls, records, rules, routes and devices', async () => {
		vendor([
			[
				'GET /accounts/a/access/service_tokens',
				200,
				ok([
					{ id: 's1', name: 'deploy', expires_at: '' },
					{ id: 's2', name: 'x' },
				]),
			],
		]);
		expect(await cfWrites.serviceTokenOf('k', 'a', 'deploy')).toEqual({ id: 's1', expiresAt: null });
		expect(await cfWrites.serviceTokenOf('k', 'a', 'none')).toBeNull();
		expect(await cfWrites.serviceTokensNamed('k', 'a', 'deploy')).toEqual(['s1']);
		vendor([['POST /certificates', 200, ok({ certificate: 'nothing' })]]);
		await expect(cfWrites.originCertificate('k', 'csr', ['a'])).rejects.toThrow('returned no certificate');
		vendor([['POST /certificates', 200, ok({ certificate: '-----BEGIN CERTIFICATE-----' })]]);
		expect(await cfWrites.originCertificate('k', 'csr', ['a'])).toContain('BEGIN CERTIFICATE');
		vendor([
			[
				'GET /zones/z/origin_tls_client_auth/hostnames/certificates',
				200,
				ok([
					{ id: 'c1', status: 'active', uploaded_on: '2026-01-01' },
					{ id: 'c2', status: 'pending_deployment', uploaded_on: '2026-06-01' },
					{ id: 'c3', status: 'deleted', uploaded_on: '2026-12-01' },
				]),
			],
			['GET /zones/z/origin_tls_client_auth/hostnames/on.example.com', 200, ok({ enabled: true })],
			['GET /zones/z/origin_tls_client_auth/hostnames/', 500, { success: false, errors: [] }],
		]);
		expect(await cfWrites.originPullsCert('k', 'z')).toBe('c2');
		expect(await cfWrites.originPullsOn('k', 'z', ['on.example.com'])).toBe(true);
		expect(await cfWrites.originPullsOn('k', 'z', ['on.example.com', 'off.example.com'])).toBe(false);
		vendor([['GET /zones/z/origin_tls_client_auth/hostnames/certificates', 200, ok([])]]);
		expect(await cfWrites.originPullsCert('k', 'z')).toBeNull();
		vendor([
			[
				'GET /zones/z/dns_records',
				200,
				ok([
					{ type: 'A', content: '1.2.3.4', proxied: true },
					{ type: 'TXT', content: 'x' },
				]),
			],
		]);
		expect(await cfWrites.recordsOf('k', 'z', 'shop.example.com')).toEqual([
			{ type: 'A', content: '1.2.3.4', proxied: true },
		]);
		vendor([
			[
				'GET /zones/z/rulesets',
				200,
				ok({
					rules: [
						{ description: 'shop SSL', enabled: false, action_parameters: { ssl: 'strict' } },
						{ description: 'shop SSL', action_parameters: { ssl: 'full' } },
					],
				}),
			],
		]);
		expect(await cfWrites.sslRuleOn('k', 'z', 'shop SSL')).toBe(false);
		const sent = vendor([
			[
				'GET /zones/z/dns_records',
				200,
				ok([
					{ id: 'd1', content: 't.cfargotunnel.com' },
					{ id: 'd2', content: '1.2.3.4' },
				]),
			],
			['GET /accounts/a/teamnet/routes', 200, ok([{ id: 'r1', network: '10.0.0.2/32', tunnel_id: 't' }])],
			['DELETE', 200, ok(null)],
			['PUT', 200, ok({})],
		]);
		await cfWrites.setOriginPulls('k', 'z', ['shop.example.com'], 'c1', true);
		await cfWrites.setOriginPulls('k', 'z', ['shop.example.com'], null, false);
		expect(await cfWrites.unpointTunnel('k', 'z', 'ssh.example.com', 't')).toBe(1);
		expect(await cfWrites.unpointHost('k', 'z', 'shop.example.com', '1.2.3.4')).toBe(1);
		await cfWrites.privateRoute('k', 'a', 't', '10.0.0.2/32', 'ssh');
		expect(await cfWrites.deletePrivateRoutes('k', 'a', 't')).toBe(1);
		expect(sent.filter((s) => s.startsWith('POST'))).toEqual([]);
	});
});

describe('DigitalOcean writes', () => {
	it('words each refusal, and refuses a droplet answer without an id', async () => {
		vendor([['GET /account/keys', 401, {}]]);
		await expect(doWrites.publicKey('k', 1)).rejects.toThrow('refused the key (401)');
		vendor([['GET /account/keys', 403, {}]]);
		await expect(doWrites.publicKey('k', 1)).rejects.toThrow('needs write scope');
		vendor([['GET /account/keys', 422, { message: 'Bad id' }]]);
		await expect(doWrites.publicKey('k', 1)).rejects.toThrow('DigitalOcean answered 422: Bad id.');
		vendor([['GET /account/keys', 500, {}]]);
		await expect(doWrites.publicKey('k', 1)).rejects.toThrow('DigitalOcean answered 500.');
		vendor([['POST /droplets', 202, { droplet: {} }]]);
		await expect(doWrites.createDroplet('k', {})).rejects.toThrow('named no droplet');
		vendor([['POST /droplets', 202, { droplet: { id: 42 } }]]);
		expect(await doWrites.createDroplet('k', {})).toBe(42);
		expect(() => firewallBody('fw', 1, ['bad'], [])).toThrow('address ranges could not be read');
	});

	it('reads firewalls, domains and records, and keeps or refuses a host that exists', async () => {
		vendor([
			[
				'GET /firewalls',
				200,
				{
					firewalls: [
						{
							id: 'f1',
							name: 'web',
							inbound_rules: [{ ports: '443', sources: { addresses: ['1.1.1.0/24'] } }, { ports: '22' }],
						},
						{ id: 'f2', name: 'other' },
					],
				},
			],
			['GET /domains/example.org/records', 200, { domain_records: [{ type: 'A', data: '203.0.113.9' }] }],
			['GET /domains', 200, { domains: [{ name: 'example.org' }] }],
		]);
		expect(await doWrites.firewallsNamed('k', 'web')).toEqual(['f1']);
		expect(await doWrites.firewall443('k', 'web')).toEqual(['1.1.1.0/24']);
		expect(await doWrites.firewall443('k', 'none')).toBeNull();
		expect(await doWrites.domains('k')).toEqual(['example.org']);
		expect(await doWrites.pointDoHost('k', 'example.org', 'shop.example.org', '203.0.113.9')).toBe('kept');
		vendor([
			['GET /domains/example.org/records', 200, { domain_records: [{ type: 'CNAME', data: 'elsewhere.' }] }],
		]);
		await expect(doWrites.pointDoHost('k', 'example.org', 'shop.example.org', '203.0.113.9')).rejects.toThrow(
			'does not overwrite',
		);
	});
});
