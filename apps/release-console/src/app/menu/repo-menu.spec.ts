import { describe, expect, it } from 'vitest';

import { searchList, searchMenu } from './menu-search';
import { laterKey, repositoryMenu } from './repo-menu';

import type { Repository } from '@saha-textile/release-console-contracts';

const repo = (over: Partial<Repository>): Repository => ({
	id: 'shop-web',
	name: 'shop-web',
	role: '',
	sourceCode: { vendor: 'github', repository: 'acme/shop-web', keyId: null },
	environments: [
		{ name: 'local', label: 'Local', cloudId: null, domains: [], secretsId: null, secretsPath: '', branch: '' },
	],
	cloud: [],
	edge: [],
	secrets: [],
	menus: [],
	...over,
});

describe('repository menu', () => {
	it('puts the repository’s own menus first, labelled with its name, and drops the Shop group', () => {
		const m = repositoryMenu(repo({ name: 'saha-textile', menus: ['payments', 'messages'] }));
		expect(m.menu.map((g) => g.label)).toEqual(['saha-textile', 'Ship', 'Watch', 'Run', 'Governance']);
		expect(m.menu[0]?.subs[0]?.items).toEqual(['payments', 'messages']);
	});

	it('adds one group per cloud and edge slot; vendors without screens get a screens-later item', () => {
		const m = repositoryMenu(
			repo({
				cloud: [
					{ id: 'digitalocean', vendor: 'digitalocean', account: '', keyIds: [] },
					{ id: 'aws', vendor: 'aws', account: '', keyIds: [] },
				],
				edge: [{ id: 'cloudflare', vendor: 'cloudflare', account: '', zones: ['example.com'], keyIds: [] }],
			}),
		);
		expect(m.menu.map((g) => g.label)).toEqual([
			'Ship',
			'Watch',
			'Run',
			'Cloud · DigitalOcean',
			'Cloud · AWS',
			'Edge · Cloudflare',
			'Governance',
		]);
		expect(m.screens[laterKey('aws')]?.label).toBe('Screens later');
		expect(
			m.menu.find((g) => g.label === 'Edge · Cloudflare')?.subs.some((s) => s.label === 'Domain: example.com ▾'),
		).toBe(true);
	});

	it('adds a Secrets group per secrets manager, before Governance', () => {
		const m = repositoryMenu(
			repo({
				secrets: [
					{ id: 'infisical', vendor: 'infisical', address: '', keyIds: [] },
					{ id: 'github-secrets', vendor: 'github-secrets', address: '', keyIds: [] },
				],
			}),
		);
		expect(m.menu.map((g) => g.label).slice(-3)).toEqual([
			'Secrets · Infisical Cloud',
			'Secrets · GitHub Actions secrets',
			'Governance',
		]);
		// Infisical Cloud's group opens the built Secrets screen; GitHub's comes later.
		expect(m.menu.find((g) => g.label === 'Secrets · Infisical Cloud')?.subs[0]?.items).toEqual(['secrets']);
		expect(m.screens[laterKey('infisical')]).toBeUndefined();
		expect(m.screens[laterKey('github-secrets')]?.captions['list']).toContain('never their values');
	});

	it('names Live deploy’s tabs after the repository’s environments', () => {
		const m = repositoryMenu(
			repo({
				environments: [
					{
						name: 'local',
						label: 'Local',
						cloudId: null,
						domains: [],
						secretsId: null,
						secretsPath: '',
						branch: '',
					},
					{
						name: 'staging',
						label: 'Staging',
						cloudId: 'digitalocean',
						domains: [],
						secretsId: null,
						secretsPath: '',
						branch: '',
					},
				],
				cloud: [{ id: 'digitalocean', vendor: 'digitalocean', account: '', keyIds: [] }],
			}),
		);
		expect(m.screens['deploy']?.states).toEqual({ local: 'Local', staging: 'Staging' });
	});

	it('scopes search to what the repository has', () => {
		const bare = repositoryMenu(repo({}));
		expect(searchMenu(bare, 'droplet').map((h) => h.screen)).not.toContain('droplets');
		expect(searchMenu(bare, 'pay')).toEqual([]);
		const withCloud = repositoryMenu(
			repo({
				cloud: [{ id: 'digitalocean', vendor: 'digitalocean', account: '', keyIds: [] }],
				menus: ['payments'],
			}),
		);
		expect(searchMenu(withCloud, 'droplet')[0]?.screen).toBe('droplets');
		expect(searchMenu(withCloud, 'pay')[0]?.screen).toBe('payments');
	});
});

describe('level search', () => {
	const items = [
		{ label: 'Attention', path: 'Console', link: ['/console', 'attention'], aliases: ['expiring'] },
		{ label: 'Audit (every project)', path: 'Console', link: ['/console', 'audit'] },
	];
	it('ranks starts-with first and finds other words', () => {
		expect(searchList(items, 'a').map((h) => h.label)).toEqual(['Attention', 'Audit (every project)']);
		expect(searchList(items, 'expir')[0]).toMatchObject({ label: 'Attention', via: 'expiring' });
		expect(searchList(items, ' ')).toEqual([]);
	});
});
