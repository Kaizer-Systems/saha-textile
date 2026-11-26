import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectsService } from './projects.service.js';
import { SAHA_TEXTILE } from './saha-textile.fixture.js';
import { KeySourceService } from '../keys/key-source.js';
import { ConsoleStore } from '../store/console-store.js';

import type { Repository } from '@saha-textile/release-console-contracts';

/** `gh auth token` answers locally: no real GitHub CLI runs in these tests. */
const gh = vi.hoisted(() => ({ token: 'example-gh-token' as string | null }));
vi.mock('node:child_process', () => ({
	execFile: (_cmd: string, _args: string[], _opts: unknown, done: (err: Error | null, out?: unknown) => void) =>
		gh.token ? done(null, { stdout: `${gh.token}\n`, stderr: '' }) : done(new Error('not signed in')),
}));

const repo = (id: string, over: Partial<Repository> = {}): Repository => ({
	id,
	name: id,
	role: '',
	sourceCode: { vendor: 'github', repository: `example/${id}`, keyId: null },
	environments: [
		{ name: 'staging', label: 'Staging', cloudId: 'do', domains: [], secretsId: null, secretsPath: '', branch: '' },
	],
	cloud: [{ id: 'do', vendor: 'digitalocean', account: '', keyIds: [] }],
	edge: [{ id: 'cf', vendor: 'cloudflare', account: '', zones: ['example.com'], keyIds: [] }],
	secrets: [{ id: 'inf', vendor: 'infisical', address: '', keyIds: [] }],
	menus: [],
	...over,
});

let projects: ProjectsService;
beforeEach(() => {
	const dir = mkdtempSync(join(tmpdir(), 'release-console-projects-more-'));
	process.env['CONSOLE_DATA_DIR'] = dir;
	process.env['CONSOLE_KEYS_FILE'] = join(dir, 'console.env');
	projects = new ProjectsService(new ConsoleStore(), new KeySourceService());
	projects.add(SAHA_TEXTILE);
	projects.add({ id: 'acme', name: 'Acme', workspace: 'Own', repositories: [repo('shop'), repo('blog')] });
	// Nothing reaches a vendor: every check answers locally.
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response('{}', { status: 401 })),
	);
	gh.token = 'example-gh-token';
});
afterEach(() => {
	vi.unstubAllGlobals();
	delete process.env['CONSOLE_DATA_DIR'];
	delete process.env['CONSOLE_KEYS_FILE'];
});

describe('projects: what they refuse', () => {
	it('says which project or repository is missing, and refuses doubles', () => {
		expect(() => projects.project('nope')).toThrow('No project nope.');
		expect(() => projects.repository('acme', 'nope')).toThrow('No repository nope in Acme.');
		expect(() => projects.add({ id: 'other', name: 'ACME', workspace: 'Own', repositories: [repo('x')] })).toThrow(
			'exists',
		);
		expect(() =>
			projects.add({ id: 'twins', name: 'Twins', workspace: 'Own', repositories: [repo('x'), repo('x')] }),
		).toThrow('Two repositories share an id.');
		expect(() => projects.setEnvTag('acme', 'nope', 'do:droplet:1', 'staging')).toThrow('nope is not in acme.');
		const inside = projects as unknown as { replaceRepositories(id: string, list: Repository[]): void };
		expect(() => inside.replaceRepositories('acme', [repo('x'), repo('x')])).toThrow(
			'Two repositories share an id.',
		);
	});
});

describe('projects: keys', () => {
	it('names a service key’s Infisical variable, and links a key by its own names', async () => {
		await expect(
			projects.linkKey('acme', {
				id: 'svc',
				kind: 'service-key',
				label: 'Service',
				envNames: [],
				expiresAt: null,
				note: '',
				target: '',
			}),
		).rejects.toThrow('Name the Infisical variable');
		const own = await projects.linkKey('acme', {
			id: 'gh-own',
			kind: 'github-token',
			label: 'GitHub',
			envNames: ['MY_GITHUB_TOKEN'],
			expiresAt: null,
			note: '',
			target: '',
		});
		expect(own.envNames).toEqual(['MY_GITHUB_TOKEN']);
		expect(own.note).toContain('The key file has no value for MY_GITHUB_TOKEN');
	});

	it('reads the GitHub CLI key from this computer, and says when it is not signed in', async () => {
		const cli = await projects.linkKey('acme', {
			id: 'gh-cli',
			kind: 'github-cli',
			label: 'GitHub CLI',
			envNames: [],
			expiresAt: null,
			note: '',
			target: '',
		});
		expect(cli.state).not.toBe('unchecked');
		gh.token = null;
		const signedOut = await projects.checkKeyNow('acme', 'gh-cli');
		expect(signedOut.note).toBe('The GitHub CLI is not signed in where the console runs.');
		await expect(projects.checkKeyNow('acme', 'nope')).rejects.toThrow('No key nope.');
		await expect(projects.removeKey('acme', 'nope')).rejects.toThrow('No key nope.');
	});

	it('unlinks a key from every slot that holds it, in this project only', async () => {
		await projects.linkKey('acme', {
			id: 'k1',
			kind: 'cf-read',
			label: 'CF',
			envNames: [],
			expiresAt: null,
			note: '',
			target: '',
		});
		projects.setSlotKeys('acme', { repositoryId: 'shop', slot: 'source-code', slotId: '', keyIds: ['k1'] });
		projects.setSlotKeys('acme', { repositoryId: 'shop', slot: 'edge', slotId: 'cf', keyIds: ['k1'] });
		projects.setSlotKeys('acme', { repositoryId: 'shop', slot: 'secrets', slotId: 'inf', keyIds: ['k1'] });
		projects.setSlotKeys('acme', { repositoryId: 'shop', slot: 'cloud', slotId: 'do', keyIds: ['k1'] });
		// A key checked again knows which repositories read with it.
		expect((await projects.checkKeyNow('acme', 'k1')).id).toBe('k1');
		await projects.removeKey('acme', 'k1');
		const shop = projects.repository('acme', 'shop').repo;
		expect([shop.sourceCode.keyId, shop.edge[0]?.keyIds, shop.secrets[0]?.keyIds, shop.cloud[0]?.keyIds]).toEqual([
			null,
			[],
			[],
			[],
		]);
	});
});

describe('projects: slots, tags, rotations and the SSH list', () => {
	it('sets each kind of slot’s keys, refuses unknown keys and slots, and words an empty list', async () => {
		await projects.linkKey('acme', {
			id: 'k2',
			kind: 'do-read',
			label: 'DO',
			envNames: [],
			expiresAt: null,
			note: '',
			target: '',
		});
		expect(() =>
			projects.setSlotKeys('acme', { repositoryId: 'shop', slot: 'cloud', slotId: 'do', keyIds: ['ghost'] }),
		).toThrow('No key ghost in Acme.');
		for (const slot of ['cloud', 'edge', 'secrets'] as const)
			expect(() =>
				projects.setSlotKeys('acme', { repositoryId: 'shop', slot, slotId: 'missing', keyIds: [] }),
			).toThrow('No such');
		const repos = (p: ReturnType<ProjectsService['project']>) => p.repositories.map((r) => r.id);
		expect(
			repos(projects.setSlotKeys('acme', { repositoryId: 'shop', slot: 'source-code', slotId: '', keyIds: [] })),
		).toEqual(['shop', 'blog']);
		const withTwo = repo('two', {
			cloud: [
				{ id: 'do', vendor: 'digitalocean', account: '', keyIds: [] },
				{ id: 'do-b', vendor: 'digitalocean', account: '', keyIds: [] },
			],
			edge: [
				{ id: 'cf', vendor: 'cloudflare', account: '', zones: [], keyIds: [] },
				{ id: 'cf-b', vendor: 'cloudflare', account: '', zones: [], keyIds: [] },
			],
			secrets: [
				{ id: 'inf', vendor: 'infisical', address: '', keyIds: [] },
				{ id: 'inf-b', vendor: 'infisical', address: '', keyIds: [] },
			],
		});
		projects.addRepository('acme', withTwo);
		for (const slot of ['cloud', 'edge', 'secrets'] as const)
			projects.setSlotKeys('acme', {
				repositoryId: 'two',
				slot,
				slotId: slot === 'cloud' ? 'do-b' : slot === 'edge' ? 'cf-b' : 'inf-b',
				keyIds: ['k2'],
			});
		const two = projects.repository('acme', 'two').repo;
		expect([
			two.cloud.map((c) => c.keyIds),
			two.edge.map((e) => e.keyIds),
			two.secrets.map((x) => x.keyIds),
		]).toEqual([
			[[], ['k2']],
			[[], ['k2']],
			[[], ['k2']],
		]);
	});

	it('keeps the source-code key it knows when a repository is saved, and changes only that repository', async () => {
		await projects.linkKey('acme', {
			id: 'k3',
			kind: 'github-token',
			label: 'GH',
			envNames: [],
			expiresAt: null,
			note: '',
			target: '',
		});
		const saved = projects.updateRepository(
			'acme',
			'blog',
			repo('blog', { sourceCode: { vendor: 'github', repository: 'example/blog', keyId: 'k3' } }),
		);
		expect(saved.repositories.find((r) => r.id === 'blog')?.sourceCode.keyId).toBe('k3');
		expect(saved.repositories.find((r) => r.id === 'shop')?.sourceCode.keyId).toBeNull();
	});

	it('remembers each environment’s rotation, and words one person or many on the SSH list', () => {
		expect(projects.rotation('acme', 'shop', 'staging').pending).toEqual([]);
		const state = { ...projects.rotation('acme', 'shop', 'staging'), pending: ['mongo-app'] } as never;
		projects.setRotation('acme', 'shop', 'staging', state);
		projects.setRotation('acme', 'shop', 'production', state);
		expect(projects.rotation('acme', 'shop', 'production')).toEqual(state);
		expect(projects.setSshEmails('acme', [' A@Example.com ', 'a@example.com', '']).sshEmails).toEqual([
			'a@example.com',
		]);
		expect(projects.setSshEmails('acme', ['a@example.com', 'b@example.com']).sshEmails).toHaveLength(2);
		expect(projects.project('saha-textile').sshEmails).toEqual([]);
	});
});
