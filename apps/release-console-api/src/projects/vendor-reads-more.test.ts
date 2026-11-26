import { afterEach, describe, expect, it, vi } from 'vitest';

import { githubCliToken } from './projects.service.js';
import { VendorReadsService } from './vendor-reads.service.js';
import { cloudflareAdapter } from '../vendors/cloudflare.adapter.js';
import { digitalOceanAdapter } from '../vendors/digitalocean.adapter.js';
import { githubAdapter } from '../vendors/github.adapter.js';
import { VendorError } from '../vendors/http.js';

import type { KeySourceService } from '../keys/key-source.js';
import type { ProjectsService } from './projects.service.js';

vi.mock('./projects.service.js', async (load) => ({
	...(await load<object>()),
	githubCliToken: vi.fn(async () => 'example-gh-token'),
}));
vi.mock('../vendors/tls-check.js', () => ({ checkHost: vi.fn(async () => ({ ok: true, days: 60 })) }));

/** A made-up project: keys are names only, every vendor answers locally. */
const env = (name: string, cloudId: string | null, domains: string[], branch = '') => ({
	name,
	label: name,
	cloudId,
	domains,
	branch,
});
function make(
	over: { repo?: Record<string, unknown>; keys?: unknown[]; value?: string | null; token?: string | null } = {},
) {
	const repo = {
		name: 'shop',
		sourceCode: { vendor: 'github', repository: 'example/shop', keyId: 'gh' },
		cloud: [
			{ id: 'do1', vendor: 'digitalocean', keyIds: ['do'] },
			{ id: 'aws1', vendor: 'aws', keyIds: [] },
			{ id: 'do2', vendor: 'digitalocean', keyIds: [] },
		],
		edge: [
			{ id: 'cf1', vendor: 'cloudflare', keyIds: ['cf'], zones: ['example.com'] },
			{ id: 'fastly1', vendor: 'fastly', keyIds: [], zones: [] },
			{ id: 'cf2', vendor: 'cloudflare', keyIds: [], zones: [] },
		],
		environments: [
			env('local', null, ['localhost']),
			env('staging', 'do1', ['staging.example.com', 'api-staging.example.com'], 'dev'),
			env('production', 'do1', ['example.com']),
			env('qa', 'do1', []),
		],
		...over.repo,
	};
	const project = {
		keys: over.keys ?? [
			{ id: 'gh', kind: 'github-token', label: 'GitHub', state: 'ok', envNames: ['GH'] },
			{ id: 'do', kind: 'do-change', label: 'DO', state: 'ok', envNames: ['DO'] },
			{ id: 'cf', kind: 'cf-read', label: 'CF', state: 'ok', envNames: ['CF'] },
		],
	};
	const projects = {
		repository: () => ({ project, repo }),
		valueOf: async () => ('value' in over ? over.value : 'example-key'),
		pruneEnvTags: vi.fn(),
	} as unknown as ProjectsService & { pruneEnvTags: ReturnType<typeof vi.fn> };
	const keyFile = { get: () => ('token' in over ? over.token : 'example-ops') } as unknown as KeySourceService;
	const s = new VendorReadsService(projects, keyFile);
	const call = vi.fn(async (): Promise<unknown> => ({}));
	Object.assign(s, { helper: { call } });
	return { s, call, projects };
}
const JOBS = { at: 'now', queues: [] };
/** The words of an answer that is not ok. */
const said = (answer: object): string => (answer as { message?: string }).message ?? '';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('operations reads', () => {
	it('says what is missing: the environment, its key name, its key, its api domain', async () => {
		const { s } = make();
		expect((await s.ops('p', 'r', 'nowhere', 'jobs')).state).toBe('error');
		expect(await s.ops('p', 'r', 'qa', 'jobs')).toMatchObject({ message: 'qa has no operations key name.' });
		expect(said(await make({ token: null }).s.ops('p', 'r', 'staging', 'jobs'))).toContain(
			'Add CONSOLE_OPS_TOKEN_STAGING',
		);
		const noApi = make({ repo: { environments: [env('staging', 'do1', ['staging.example.com'])] } });
		expect(said(await noApi.s.ops('p', 'r', 'staging', 'jobs'))).toContain('names no api… domain');
	});

	it('reads this computer through the helper and a server over https', async () => {
		const { s, call } = make();
		call.mockResolvedValueOnce(JOBS);
		expect(await s.ops('p', 'r', 'local', 'jobs')).toMatchObject({ state: 'ok', data: JOBS });
		const fetchStub = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
		vi.stubGlobal('fetch', fetchStub);
		expect(said(await s.ops('p', 'r', 'staging', 'messages'))).toBe(
			'api-staging.example.com answered 401 to /ops/messages.',
		);
		expect(fetchStub).toHaveBeenCalledWith(
			'https://api-staging.example.com/ops/messages?hours=24',
			expect.anything(),
		);
		fetchStub.mockResolvedValueOnce({ ok: true, status: 200, json: async () => JOBS });
		expect((await s.ops('p', 'r', 'staging', 'jobs')).state).toBe('ok');
		fetchStub.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ nope: 1 }) });
		expect((await s.ops('p', 'r', 'staging', 'messages')).state).toBe('error');
		fetchStub.mockRejectedValueOnce('offline');
		expect(said(await s.ops('p', 'r', 'staging', 'jobs'))).toBe('The operations address did not answer.');
	});
});

describe('branches, releases and the repository file', () => {
	it('merges GitHub’s branches with this computer’s, and says why GitHub’s are missing', async () => {
		const { s, call } = make();
		call.mockResolvedValueOnce({ checkout: true, current: 'dev', local: ['dev', 'mine'], remote: ['main', 'dev'] });
		vi.spyOn(githubAdapter, 'branches').mockResolvedValueOnce({ defaultBranch: 'main', names: ['main', 'dev'] });
		const both = await s.branches({ repository: 'example/shop', refresh: '1' });
		expect(both.branches.map((b) => [b.name, b.onGitHub, b.onThisComputer])).toEqual([
			['dev', true, true],
			['main', true, false],
			['mine', false, true],
		]);
		call.mockRejectedValueOnce(new Error('helper down'));
		vi.mocked(githubCliToken).mockResolvedValueOnce(null);
		expect((await s.branches({ repository: 'example/shop' })).note).toContain('not connected yet');
		call.mockResolvedValueOnce({ checkout: true, current: 'dev', local: ['dev'], remote: ['main'] });
		vi.spyOn(githubAdapter, 'branches').mockRejectedValueOnce(new VendorError('Not found', 404));
		const remote = await s.branches({ repository: 'example/shop' });
		expect(remote.note).toBe('Not found');
		expect(remote.branches.find((b) => b.name === 'main')?.onGitHub).toBe(true);
		vi.spyOn(githubAdapter, 'branches').mockRejectedValueOnce(new Error('boom'));
		expect((await s.branches({ repository: 'example/shop' })).note).toBe(
			'GitHub could not be asked for the branches.',
		);
	});

	it('compares each environment’s branch with the next one’s', async () => {
		const { s } = make({
			repo: {
				environments: [
					env('local', null, [], ''),
					env('development', 'do1', [], ''),
					env('staging', 'do1', [], 'dev'),
					env('production', 'do1', [], 'release'),
				],
			},
		});
		const compare = vi.spyOn(githubAdapter, 'compare');
		compare.mockResolvedValueOnce(null);
		compare.mockResolvedValueOnce({
			aheadBy: 2,
			commits: [],
			files: ['packages/x/release/0001.ts', 'docker/infisical/variable-names.json'],
			url: 'https://github.example/compare',
		} as never);
		const view = await s.releases('p', 'r');
		expect(view.state).toBe('ok');
		const comparisons = (view as { data: { comparisons: Array<Record<string, unknown>> } }).data.comparisons;
		expect(comparisons[0]?.note).toBe('Both use the same branch.');
		expect(comparisons[1]?.note).toBe('main or dev is not on GitHub.');
		expect(comparisons[2]).toMatchObject({ migrations: true, secretNames: true, files: 2 });
		compare.mockResolvedValueOnce(null);
		compare.mockResolvedValueOnce({ aheadBy: 0, commits: [], files: ['README.md'], url: '' } as never);
		const plain = (await s.releases('p', 'r')) as { data: { comparisons: Array<Record<string, unknown>> } };
		expect(plain.data.comparisons[2]).toMatchObject({ migrations: false, secretNames: false });
	});

	it('reads the repository file from this computer first, then from GitHub, and says why it could not', async () => {
		const { s, call } = make();
		expect((await s.repositoryFile({ vendor: 'gitlab', repository: 'example/shop' } as never)).state).toBe(
			'not-connected',
		);
		call.mockResolvedValueOnce({ found: true, text: JSON.stringify({ version: 1, menus: ['payments'] }) });
		const local = await s.repositoryFile({ vendor: 'github', repository: 'example/shop', ref: 'dev' });
		expect(local).toMatchObject({ state: 'ok', data: { found: true, ref: 'dev' } });
		call.mockResolvedValueOnce({ found: true, text: '{not json' });
		expect((await s.repositoryFile({ vendor: 'github', repository: 'example/shop', ref: 'dev' })).state).toBe(
			'error',
		);
		call.mockRejectedValueOnce(new Error('helper down'));
		const file = vi.spyOn(githubAdapter, 'file').mockResolvedValueOnce(null);
		expect(await s.repositoryFile({ vendor: 'github', repository: 'shop', ref: 'dev' })).toMatchObject({
			data: { found: false },
		});
		file.mockResolvedValueOnce(JSON.stringify({ version: 2, menus: ['payments'] }));
		expect((await s.repositoryFile({ vendor: 'github', repository: 'example/shop' })).state).toBe('ok');
		// A repository named without its owner reads the same.
		file.mockResolvedValueOnce(JSON.stringify({ version: 1, menus: [] }));
		expect((await s.repositoryFile({ vendor: 'github', repository: 'shop' })).state).toBe('ok');
		file.mockRejectedValueOnce(new VendorError('Rate limited', 429));
		expect(said(await s.repositoryFile({ vendor: 'github', repository: 'example/shop' }))).toBe('Rate limited');
		file.mockRejectedValueOnce(new Error('socket hang up'));
		expect(said(await s.repositoryFile({ vendor: 'github', repository: 'example/shop' }))).toBe(
			'The file could not be read: socket hang up',
		);
		vi.mocked(githubCliToken).mockResolvedValueOnce(null);
		expect(said(await s.repositoryFile({ vendor: 'github', repository: 'example/shop' }))).toContain(
			'gh auth login',
		);
	});
});

describe('reads with each slot’s key', () => {
	it('reads GitHub, DigitalOcean and Cloudflare, and prunes tags only from a whole droplet list', async () => {
		const { s, projects } = make();
		vi.spyOn(githubAdapter, 'security').mockResolvedValue({ alerts: [] } as never);
		vi.spyOn(githubAdapter, 'pulls').mockResolvedValue([]);
		vi.spyOn(githubAdapter, 'runs').mockResolvedValue([]);
		vi.spyOn(digitalOceanAdapter, 'account').mockResolvedValue({} as never);
		vi.spyOn(digitalOceanAdapter, 'catalog').mockResolvedValue({} as never);
		vi.spyOn(cloudflareAdapter, 'zones').mockResolvedValue([]);
		vi.spyOn(cloudflareAdapter, 'records').mockResolvedValue([]);
		vi.spyOn(cloudflareAdapter, 'certificates').mockResolvedValue([]);
		for (const read of [
			s.security('p', 'r'),
			s.pulls('p', 'r'),
			s.runs('p', 'r'),
			s.cloudAccount('p', 'r', 'do1'),
			s.doCatalog('p', 'r', 'do1'),
			s.zones('p', 'r', 'cf1'),
			s.records('p', 'r', 'cf1', 'example.com'),
		])
			expect((await read).state).toBe('ok');
		expect(said(await s.records('p', 'r', 'cf1', 'other.com'))).toBe(
			'other.com is not a domain of this edge slot.',
		);
		const servers = vi.spyOn(digitalOceanAdapter, 'servers').mockResolvedValueOnce([{ id: 1 }] as never);
		await s.droplets('p', 'r', 'do1');
		expect(projects.pruneEnvTags).toHaveBeenCalledWith('p', 'r', 'droplet', ['1']);
		projects.pruneEnvTags.mockClear();
		servers.mockResolvedValueOnce(Array.from({ length: 200 }, (_, i) => ({ id: i })) as never);
		await s.droplets('p', 'r', 'do1');
		servers.mockRejectedValueOnce(new Error('down'));
		await s.droplets('p', 'r', 'do1');
		expect(projects.pruneEnvTags).not.toHaveBeenCalled();
		const domains = await s.domains('p', 'r', 'cf1');
		expect((domains as { data: { hosts: Array<{ host: string }> } }).data.hosts.map((h) => h.host)).toEqual([
			'staging.example.com',
			'api-staging.example.com',
			'example.com',
		]);
		expect((await s.domains('p', 'r', 'cf2')).state).toBe('not-connected');
	});

	it('says which slot, vendor or key is missing, and why a key gave nothing', async () => {
		const { s } = make();
		expect(said(await s.cloudAccount('p', 'r', 'none'))).toBe('This repository has no such cloud platform.');
		expect(said(await s.cloudAccount('p', 'r', 'aws1'))).toBe('AWS screens come later.');
		expect(said(await s.cloudAccount('p', 'r', 'do2'))).toContain('DigitalOcean is not connected');
		expect(said(await s.zones('p', 'r', 'none'))).toBe('This repository has no such edge platform.');
		expect(said(await s.zones('p', 'r', 'fastly1'))).toBe('Fastly screens come later.');
		expect(said(await s.zones('p', 'r', 'cf2'))).toContain('Cloudflare is not connected');
		expect(
			said(
				await make({ repo: { sourceCode: { vendor: 'gitlab', repository: 'x', keyId: null } } }).s.pulls(
					'p',
					'r',
				),
			),
		).toContain('GitLab screens come later');
		expect(
			said(
				await make({ repo: { sourceCode: { vendor: 'github', repository: 'x', keyId: 'none' } } }).s.pulls(
					'p',
					'r',
				),
			),
		).toContain('GitHub is not connected');
		const expired = make({
			keys: [{ id: 'gh', kind: 'github-token', label: 'GitHub token', state: 'expired', envNames: [] }],
		});
		expect(said(await expired.s.pulls('p', 'r'))).toBe(
			'GitHub token has expired. Paste a new one on the Connections screen.',
		);
		const cli = make({
			value: null,
			keys: [{ id: 'gh', kind: 'github-cli', label: 'gh', state: 'ok', envNames: [] }],
		});
		expect(said(await cli.s.pulls('p', 'r'))).toContain('gh auth login');
		const empty = make({ value: null });
		expect(said(await empty.s.pulls('p', 'r'))).toContain('Add GH in Infisical');
		vi.spyOn(githubAdapter, 'pulls').mockRejectedValueOnce(new VendorError('Bad credentials', 401));
		expect(said(await make().s.pulls('p', 'r'))).toBe('Bad credentials');
		vi.spyOn(githubAdapter, 'pulls').mockRejectedValueOnce(new Error('ECONNRESET'));
		expect(said(await make().s.pulls('p', 'r'))).toBe('The vendor could not be reached: ECONNRESET');
	});
});
