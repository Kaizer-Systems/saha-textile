import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppFilesController } from './app-files/app-files.controller.js';
import { appFile } from './app-files/app-files.js';
import { keysFile } from './keys/key-source.js';
import { parseSize, toServices } from './local-stack/docker-output.js';
import { RunnerClient } from './runner/runner-client.js';
import { ConsoleStore, dataDir } from './store/console-store.js';
import { cloudflareAdapter } from './vendors/cloudflare.adapter.js';
import { digitalOceanAdapter, toDroplet, toImage } from './vendors/digitalocean.adapter.js';
import { githubAdapter } from './vendors/github.adapter.js';
import { checkKey, githubExpiry } from './vendors/key-checks.js';
import { signV4 } from './vendors/sigv4.js';

/** Every vendor answers locally, by the address asked for: nothing leaves this machine. */
type Route = [RegExp, number, unknown, Record<string, string>?];
function answer(routes: Route[]) {
	const fetchStub = vi.fn(async (url: string | URL) => {
		const hit = routes.find(([re]) => re.test(String(url)));
		const [, status, body, headers] = hit ?? [/./, 200, {}];
		return new Response(JSON.stringify(body), { status, headers: headers ?? {} });
	});
	vi.stubGlobal('fetch', fetchStub);
	return fetchStub;
}

afterEach(() => {
	vi.unstubAllGlobals();
	delete process.env['CONSOLE_DATA_DIR'];
	delete process.env['CONSOLE_RUNNER_TOKEN_FILE'];
	delete process.env['CONSOLE_APP_DIR'];
});

describe('key checks', () => {
	it('reads GitHub’s expiry, and words each vendor’s answer', async () => {
		expect(githubExpiry('soon')).toBeNull();
		answer([[/api\.github\.com\/user/, 200, { login: 'owner' }]]);
		expect(await checkKey('github-token', 'k', [])).toMatchObject({ rights: ['fine-grained'], note: '' });
		answer([[/api\.github\.com\/user/, 401, {}]]);
		expect((await checkKey('github-cli', 'k', [])).note).toBe('GitHub refused the key (401).');
		answer([
			[/zones\?per_page=1/, 403, {}],
			[/tokens\/verify/, 401, { result: { status: 'disabled' } }],
		]);
		expect((await checkKey('cf-read', 'k', [])).note).toBe('Cloudflare did not accept the token (401, disabled).');
		answer([
			[/zones\?per_page=1/, 403, { result: [] }],
			[/user\/tokens\/verify/, 200, { result: { status: 'active' } }],
		]);
		expect(await checkKey('cf-read', 'k', [])).toMatchObject({
			rights: [],
			note: expect.stringContaining('sees no zone'),
		});
		answer([[/digitaloceanspaces/, 404, {}]]);
		expect((await checkKey('spaces-key', 'ACCESS:SECRET', [], 'sgp1/bucket')).note).toBe(
			'Spaces has no bucket bucket in sgp1.',
		);
		expect((await checkKey('service-key', 'k', [])).state).toBe('unchecked');
	});
});

describe('vendor adapters', () => {
	it('words GitHub’s refusals, pages its branches, and reads files and comparisons', async () => {
		answer([[/pulls/, 401, {}]]);
		await expect(githubAdapter.pulls('o/r', 'k')).rejects.toThrow('refused the key (401)');
		answer([[/pulls/, 404, {}]]);
		await expect(githubAdapter.pulls('o/r', 'k')).rejects.toThrow('(404)');
		answer([[/pulls/, 500, {}]]);
		await expect(githubAdapter.pulls('o/r', 'k')).rejects.toThrow('GitHub answered 500.');
		answer([[/compare/, 404, {}]]);
		expect(await githubAdapter.compare('o/r', 'k', 'main', 'dev')).toBeNull();
		answer([[/compare/, 200, { commits: [{ sha: 'abcdef123', commit: { message: 'feat: x\n\nbody' } }] }]]);
		expect((await githubAdapter.compare('o/r', 'k', 'main', 'dev'))?.commits[0]?.message).toBe('feat: x');
		answer([[/dependabot/, 500, {}]]);
		await expect(githubAdapter.security('o/r', 'k')).rejects.toThrow('GitHub answered 500.');
		answer([[/repos\/o\/r$/, 500, {}]]);
		await expect(githubAdapter.branches('o/r', 'k')).rejects.toThrow('GitHub answered 500 for o/r.');
		const full = Array.from({ length: 100 }, (_, i) => ({ name: `b${i}` }));
		answer([
			[/&page=1$/, 200, full],
			[/&page=2$/, 500, {}],
			[/repos\/o\/r$/, 200, { default_branch: 'main' }],
		]);
		await expect(githubAdapter.branches('o/r', 'k')).rejects.toThrow('GitHub answered 500.');
		answer([
			[/&page=1$/, 200, full],
			[/&page=2$/, 200, []],
			[/repos\/o\/r$/, 200, {}],
		]);
		expect((await githubAdapter.branches('o/r', 'k')).defaultBranch).toBeNull();
		answer([[/contents/, 404, {}]]);
		expect(await githubAdapter.file('o/r', '.release-console.json', 'k')).toBeNull();
		answer([[/contents/, 200, { encoding: 'base64', content: Buffer.from('{}').toString('base64') }]]);
		expect(await githubAdapter.file('o/r', '.release-console.json', 'k', 'dev')).toBe('{}');
		answer([[/contents/, 200, { encoding: 'utf-8', content: '{}' }]]);
		expect(await githubAdapter.file('o/r', '.release-console.json', 'k')).toBeNull();
		answer([[/contents/, 500, {}]]);
		await expect(githubAdapter.file('o/r', '.release-console.json', 'k')).rejects.toThrow('GitHub answered 500.');
	});

	it('maps DigitalOcean’s answers, its refusals, and the backups of its droplets', async () => {
		expect(toDroplet({ networks: { v4: [{ type: 'public', ip_address: '' }] } }).ipv4).toBeNull();
		expect(
			['custom', 'backup', 'snapshot'].map((type) => toImage({ type, regions: ['sgp1'] }, 'private').kind),
		).toEqual(['custom', 'backup', 'snapshot']);
		answer([[/droplets/, 500, {}]]);
		await expect(digitalOceanAdapter.servers('k')).rejects.toThrow('DigitalOcean answered 500.');
		answer([
			[/balance/, 500, {}],
			[/account/, 200, { account: { email: 'owner@example.com' } }],
		]);
		expect(await digitalOceanAdapter.account('k')).toMatchObject({
			team: 'owner@example.com',
			monthToDateUsage: null,
		});
		answer([
			[/balance/, 200, { month_to_date_usage: '', account_balance: '' }],
			[/account/, 200, { account: {} }],
		]);
		expect(await digitalOceanAdapter.account('k')).toMatchObject({ monthToDateUsage: null, accountBalance: null });
		answer([
			[/droplets\/1\/backups/, 200, { backups: [{ id: 5, type: 'backup', name: 'nightly' }] }],
			[/\/droplets\?/, 200, { droplets: [{ id: 1, name: 'web', backup_ids: [5] }] }],
		]);
		const catalog = await digitalOceanAdapter.catalog('k');
		expect(JSON.stringify(catalog)).toContain('nightly');
	});

	it('words a Cloudflare refusal, and reads certificate packs', async () => {
		answer([[/zones\?per_page=50/, 400, { success: false, errors: [{ message: 'Invalid token' }] }]]);
		await expect(cloudflareAdapter.zones('k')).rejects.toThrow('Cloudflare answered 400: Invalid token.');
		answer([[/zones\?per_page=50/, 500, { errors: [] }]]);
		await expect(cloudflareAdapter.zones('k')).rejects.toThrow('Cloudflare answered 500.');
		answer([
			[
				/certificate_packs/,
				200,
				{ result: [{ hosts: ['example.com'], certificates: [{ expires_on: '2027-01-01' }, {}] }] },
			],
			[/zones\?name=/, 200, { result: [{ id: 'z1', name: 'example.com' }] }],
		]);
		expect(await cloudflareAdapter.certificates('k', 'example.com')).toMatchObject([
			{ hosts: ['example.com'], expiresOn: '2027-01-01' },
		]);
	});
});

describe('small helpers', () => {
	it('signs a request with repeated query names and no path', () => {
		const headers = signV4({
			method: 'GET',
			url: new URL('https://sgp1.example.test?b=2&a=2&a=1'),
			region: 'sgp1',
			service: 's3',
			accessKey: 'AK',
			secret: 'SK',
			amzDate: '20261124T000000Z',
		});
		expect(headers['authorization']).toContain('Credential=AK/20261124/sgp1/s3/aws4_request');
	});

	it('finds the console’s data folder, key file and runner key, and says why the helper did not answer', async () => {
		expect(dataDir()).toContain('Release Console');
		expect(keysFile()).toContain('console.env');
		const dir = mkdtempSync(join(tmpdir(), 'release-console-runner-'));
		const tokenFile = join(dir, 'runner-token');
		writeFileSync(tokenFile, '   \n');
		process.env['CONSOLE_RUNNER_TOKEN_FILE'] = tokenFile;
		await expect(new RunnerClient().call('GET', '/x')).rejects.toThrow('has not run yet');
		writeFileSync(tokenFile, 'example-runner-token');
		answer([[/./, 500, 'just words']]);
		await expect(new RunnerClient().call('GET', '/x')).rejects.toThrow('The Mac helper answered 500.');
		expect(parseSize('12 parsecs')).toBeNull();
		expect(toServices('42\n"text"\n', '', 'acme')).toEqual([]);
		process.env['CONSOLE_RUNNER_TOKEN_FILE'] = join(dir, 'missing');
		await expect(new RunnerClient().call('GET', '/x')).rejects.toThrow('has not run yet');
	});

	it('serves the app from a folder written with its own separator, and nothing outside it', () => {
		const dir = mkdtempSync(join(tmpdir(), 'release-console-app-more-'));
		expect(appFile(`${dir}${sep}`, '/missing')).toBeNull();
		writeFileSync(join(dir, 'index.html'), '<rc-root></rc-root>');
		writeFileSync(join(dir, 'robots.txt'), 'User-agent: *');
		writeFileSync(join(dir, 'data.xyz'), 'x');
		expect(appFile(`${dir}${sep}`, '/robots.txt')).toMatchObject({ cache: 'public, max-age=3600' });
		expect(appFile(dir, '/data.xyz')).toMatchObject({ type: 'application/octet-stream' });
		const reply = { header: vi.fn(() => reply), send: vi.fn() };
		expect(() => new AppFilesController().file({ url: '/robots.txt' } as never, reply as never)).toThrow();
		process.env['CONSOLE_APP_DIR'] = dir;
		new AppFilesController().file({ url: '/robots.txt' } as never, reply as never);
		expect(reply.send).toHaveBeenCalled();
	});

	it('skips audit lines it cannot read, and leaves an older file it cannot read where it is', () => {
		const dir = mkdtempSync(join(tmpdir(), 'release-console-db-more-'));
		process.env['CONSOLE_DATA_DIR'] = dir;
		writeFileSync(join(dir, 'console.json'), JSON.stringify({ nonsense: true, projects: 'no' }));
		const store = new ConsoleStore();
		store
			.db()
			.prepare('INSERT INTO audit (at, project_id, action, detail) VALUES (?, ?, ?, ?)')
			.run('not a date', null, 'x', 'y');
		store.audit(null, 'pin-set', 'The console PIN was set');
		expect(store.auditEntries(null).map((e) => e.action)).toEqual(['pin-set']);
		store.onModuleDestroy();
	});
});
