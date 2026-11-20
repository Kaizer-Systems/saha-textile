import { describe, expect, it } from 'vitest';

import { newRepository, toggleCloudSlot, toggleEdgeSlot } from './repository-editor';

import type { Repository } from '@saha-textile/release-console-contracts';

const repo: Repository = {
	id: 'saha-textile',
	name: 'saha-textile',
	role: 'monorepo',
	sourceCode: { vendor: 'github', repository: 'Kaizer-Systems/saha-textile', keyId: 'github-cli' },
	environments: [
		{ name: 'local', label: 'Local', cloudId: null, domains: [], secretsId: null, secretsPath: '' },
		{
			name: 'staging',
			label: 'Staging',
			cloudId: 'digitalocean',
			domains: ['staging.example.com'],
			secretsId: null,
			secretsPath: '',
		},
	],
	cloud: [{ id: 'digitalocean', vendor: 'digitalocean', account: '', keyIds: ['do-read'] }],
	edge: [{ id: 'cloudflare', vendor: 'cloudflare', account: '', zones: ['example.com'], keyIds: ['cf-read'] }],
	secrets: [],
	menus: ['payments'],
};

describe('repository editor', () => {
	it('adds a cloud without keys and, on removal, moves its environments to this computer', () => {
		const withAws = toggleCloudSlot(repo, 'aws');
		expect(withAws.cloud.map((c) => [c.id, c.keyIds])).toEqual([
			['digitalocean', ['do-read']],
			['aws', []],
		]);
		const withoutDo = toggleCloudSlot(withAws, 'digitalocean');
		expect(withoutDo.cloud.map((c) => c.id)).toEqual(['aws']);
		expect(withoutDo.environments.map((e) => e.cloudId)).toEqual([null, null]);
	});

	it('toggles an edge platform and keeps the others’ keys', () => {
		const withFastly = toggleEdgeSlot(repo, 'fastly');
		expect(withFastly.edge.map((e) => e.id)).toEqual(['cloudflare', 'fastly']);
		expect(toggleEdgeSlot(withFastly, 'fastly').edge).toEqual(repo.edge);
	});

	it('starts a new repository from the first one, without its source-code key', () => {
		const r = newRepository(repo, 'gitlab', 'acme/shop-api', 'API', []);
		expect(r).toMatchObject({ id: 'shop-api', name: 'shop-api', sourceCode: { vendor: 'gitlab', keyId: null } });
		expect(r.cloud[0]?.keyIds).toEqual(['do-read']);
		r.cloud[0]?.keyIds.push('changed');
		expect(repo.cloud[0]?.keyIds).toEqual(['do-read']);
	});
});
