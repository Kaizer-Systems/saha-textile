import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectsService } from './projects.service.js';
import { SAHA_TEXTILE } from './saha-textile.fixture.js';
import { VendorReadsService } from './vendor-reads.service.js';
import { KeySourceService } from '../keys/key-source.js';
import { LocalStackService } from '../local-stack/local-stack.service.js';
import { ConsoleStore } from '../store/console-store.js';
import { githubAdapter } from '../vendors/github.adapter.js';

import type { Repository } from '@saha-textile/release-console-contracts';

const shopWeb: Repository = {
	id: 'shop-web',
	name: 'shop-web',
	role: 'storefront',
	sourceCode: { vendor: 'gitlab', repository: 'acme/shop-web', keyId: null },
	environments: [
		{ name: 'local', label: 'Local', cloudId: null, domains: [], secretsId: null, secretsPath: '', branch: '' },
	],
	cloud: [{ id: 'digitalocean', vendor: 'digitalocean', account: '', keyIds: ['do-read', 'not-in-project'] }],
	edge: [],
	secrets: [],
	menus: [],
};

describe('editing repositories after a project is added', () => {
	let projects: ProjectsService;
	beforeEach(() => {
		process.env['CONSOLE_DATA_DIR'] = mkdtempSync(join(tmpdir(), 'release-console-repos-'));
		projects = new ProjectsService(new ConsoleStore(), new KeySourceService());
		projects.add(SAHA_TEXTILE);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		delete process.env['CONSOLE_DATA_DIR'];
	});

	it('adds a repository and keeps only key ids the project holds', () => {
		const p = projects.addRepository('saha-textile', shopWeb);
		expect(p.repositories.map((r) => r.id)).toEqual(['saha-textile', 'shop-web']);
		expect(p.repositories[1]?.cloud[0]?.keyIds).toEqual([]);
		expect(() => projects.addRepository('saha-textile', shopWeb)).toThrow(/has a repository/);
	});

	it('saves a repository’s slots and refuses an id change', () => {
		const repo = projects.project('saha-textile').repositories[0] as Repository;
		const next = {
			...repo,
			edge: [
				...repo.edge,
				{ id: 'fastly', vendor: 'fastly' as const, account: '', zones: ['example.com'], keyIds: [] },
			],
		};
		expect(
			projects.updateRepository('saha-textile', 'saha-textile', next).repositories[0]?.edge.map((e) => e.id),
		).toEqual(['cloudflare', 'fastly']);
		expect(projects.project('saha-textile').repositories[0]?.edge[0]?.zones).toEqual(['sahatextile.com']);
		expect(() => projects.updateRepository('saha-textile', 'saha-textile', { ...next, id: 'other' })).toThrow(
			/keeps its id/,
		);
	});

	it('removes a repository but never the last one', () => {
		expect(() => projects.removeRepository('saha-textile', 'saha-textile')).toThrow(/at least one/);
		projects.addRepository('saha-textile', shopWeb);
		expect(projects.removeRepository('saha-textile', 'shop-web').repositories).toHaveLength(1);
	});

	it('reads only GitHub repository files before a project exists', async () => {
		const reads = new VendorReadsService(projects);
		expect(await reads.repositoryFile({ vendor: 'gitlab', repository: 'acme/shop-web' })).toMatchObject({
			state: 'not-connected',
		});
	});

	it('decodes a repository file from GitHub and treats a missing file as none', async () => {
		const content = Buffer.from('{"menus":["payments"]}').toString('base64');
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) =>
				url.includes('/missing/')
					? new Response('{}', { status: 404 })
					: new Response(JSON.stringify({ encoding: 'base64', content }), { status: 200 }),
			),
		);
		expect(await githubAdapter.file('o/r', '.release-console.json', 'test-value')).toBe('{"menus":["payments"]}');
		expect(await githubAdapter.file('o/missing', '.release-console.json', 'test-value')).toBeNull();
	});

	it('reads the shop readiness only for the stack it belongs to', async () => {
		expect(await new LocalStackService({} as never, {} as never).readiness('client-shop')).toMatchObject({
			status: 'unknown',
			reachable: false,
		});
	});

	it('keeps a secrets manager’s keys and refuses an environment reading one the repository lacks', () => {
		const repo = projects.project('saha-textile').repositories[0] as Repository;
		const withInfisical: Repository = {
			...repo,
			secrets: [{ id: 'infisical', vendor: 'infisical', address: '', keyIds: [] }],
			environments: repo.environments.map((e) => ({
				...e,
				secretsId: 'infisical',
				secretsPath: `saha-textile-${e.name} · /api`,
			})),
		};
		const saved = projects.updateRepository('saha-textile', 'saha-textile', withInfisical).repositories[0];
		expect(saved?.environments.map((e) => e.secretsId)).toEqual(['infisical', 'infisical', 'infisical']);
		expect(() =>
			projects.updateRepository('saha-textile', 'saha-textile', { ...withInfisical, secrets: [] }),
		).toThrow(/secrets manager the repository does not have/);
		expect(() =>
			projects.updateRepository('saha-textile', 'saha-textile', { ...withInfisical, cloud: [] }),
		).toThrow(/cloud the repository does not have/);
	});
});
