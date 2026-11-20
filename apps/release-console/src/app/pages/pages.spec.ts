import { describe, expect, it } from 'vitest';

import {
	andList,
	branchProblem,
	edgeProblem,
	envProblem,
	placeNote,
	savedPlace,
	secretsProblem,
	slugOf,
	suggestBranch,
} from './add-project';
import { keyPill } from './connections';
import { branchWhere, matchBranches } from '../shared/branch-picker';

import type { KeyRef } from '@saha-textile/release-console-contracts';

const ref = (state: KeyRef['state']): KeyRef => ({
	id: 'do-read',
	kind: 'do-read',
	label: 'DigitalOcean API · read',
	envNames: ['CONSOLE_DO_READ_TOKEN'],
	account: '',
	rights: [],
	expiresAt: '2026-11-20T00:00:00.000Z',
	checkedAt: null,
	state,
	note: '',
});

describe('connections and wizard helpers', () => {
	it('words each key state as the brief does', () => {
		expect(keyPill(undefined)).toEqual({ cls: 'muted', text: 'not connected' });
		expect(keyPill(ref('verified')).cls).toBe('ok');
		expect(keyPill(ref('expiring'))).toEqual({ cls: 'amber', text: 'expires 2026-11-20' });
		expect(keyPill(ref('failed')).cls).toBe('red');
	});

	it('keeps Next off until each step is complete (owner, 20 Nov)', () => {
		const env = (label: string, runsOn: 'digitalocean' | null, domains: string) => ({
			label,
			runsOn,
			domains,
			secretsFrom: null,
			secretsPath: '',
		});
		const local = env('Local', null, 'localhost');
		const staging = env('Staging', 'digitalocean', 'staging.example.com');
		// Environments: each needs a domain name.
		expect(envProblem([])).toMatch(/at least one environment/);
		expect(envProblem([local, env('Staging', 'digitalocean', '')])).toMatch(/Give Staging at least one domain/);
		expect(envProblem([env('Local', null, 'local host!')])).toMatch(/is not a domain name/);
		expect(envProblem([local, staging])).toBe('');
		// Edge: a server environment needs an edge, the edge its domain, and the domain must cover it.
		expect(edgeProblem([local, staging], [])).toMatch(/Staging run on a server/);
		expect(edgeProblem([local, staging], [{ vendor: 'cloudflare', zones: '' }])).toMatch(
			/Write the domain Cloudflare holds/,
		);
		expect(edgeProblem([local, staging], [{ vendor: 'cloudflare', zones: 'other.com' }])).toMatch(
			/staging.example.com \(Staging\) is under none/,
		);
		expect(edgeProblem([local, staging], [{ vendor: 'cloudflare', zones: 'example.com' }])).toBe('');
		expect(edgeProblem([local], [])).toBe('');
		// Secrets: every environment chooses, and an Infisical place must read.
		const infisical = [{ vendor: 'infisical' as const, address: '' }];
		expect(secretsProblem([local], infisical)).toMatch(/Choose where Local reads/);
		expect(secretsProblem([{ ...local, secretsFrom: 'none' }], [])).toBe('');
		expect(secretsProblem([{ ...local, secretsFrom: 'infisical' }], infisical)).toMatch(/Write where Local reads/);
		expect(
			secretsProblem([{ ...local, secretsFrom: 'infisical', secretsPath: 'saha-textile-local' }], infisical),
		).toMatch(/project\/environment/);
		expect(
			secretsProblem([{ ...local, secretsFrom: 'infisical', secretsPath: 'saha-textile-local/dev' }], infisical),
		).toBe('');
		expect(secretsProblem([{ ...local, secretsFrom: 'doppler', secretsPath: 'shop/prd' }], infisical)).toMatch(
			/Choose where Local reads/,
		);
	});

	it('says what an Infisical place reads, in words', () => {
		expect(placeNote('infisical', 'saha-textile-local/dev')).toBe(
			'Reads project saha-textile-local, environment dev, every folder. Saved as saha-textile-local/dev.',
		);
		expect(placeNote('infisical', 'saha-textile-local/Development')).toBe(
			'Reads project saha-textile-local, environment Development (short name dev), every folder. Saved as saha-textile-local/dev.',
		);
		expect(savedPlace('infisical', ' saha-textile-production/Production/api ')).toBe(
			'saha-textile-production/prod/api',
		);
		expect(savedPlace('doppler', ' shop/prd ')).toBe('shop/prd');
		expect(savedPlace(null, 'anything')).toBe('');
		expect(placeNote('infisical', 'saha-textile-local/dev/api')).toContain('only /api');
		expect(placeNote('infisical', '')).toContain('saha-textile-local/Development/api');
		expect(andList(['Local', 'Staging', 'Production'])).toBe('Local, Staging and Production');
	});

	it('makes ids from names', () => {
		expect(slugOf('Client shop')).toBe('client-shop');
		expect(slugOf('  Saha Textile & Co. ')).toBe('saha-textile-co');
	});
});

describe('branch per environment (owner, 20 Nov)', () => {
	const list = {
		defaultBranch: 'main',
		current: 'feat/combined-after-pr6',
		note: '',
		branches: ['main', 'staging', 'dev', 'feat/combined-after-pr6'].map((name) => ({
			name,
			onGitHub: name !== 'feat/combined-after-pr6',
			onThisComputer: true,
		})),
	};
	it('suggests this computer’s branch for Local, staging for Staging, the default for Production', () => {
		expect(suggestBranch({ name: 'local', runsOn: null }, list)).toBe('feat/combined-after-pr6');
		expect(suggestBranch({ name: 'staging', runsOn: 'digitalocean' }, list)).toBe('staging');
		expect(suggestBranch({ name: 'production', runsOn: 'digitalocean' }, list)).toBe('main');
		expect(suggestBranch({ name: 'development', runsOn: 'digitalocean' }, list)).toBe('dev');
		expect(suggestBranch({ name: 'preview', runsOn: 'digitalocean' }, list)).toBe('');
	});
	it('keeps Next off until every environment has a branch from the list, once connected', () => {
		const envs = [
			{ label: 'Local', branches: { 'o/r': 'feat/combined-after-pr6' } },
			{ label: 'Staging', branches: {} },
		];
		expect(branchProblem(envs, [{ repository: 'o/r', connected: false }], {})).toMatch(/Connect o\/r/);
		expect(branchProblem(envs, [{ repository: 'o/r', connected: true }], {})).toMatch(/Reading/);
		expect(branchProblem(envs, [{ repository: 'o/r', connected: true }], { 'o/r': list })).toMatch(
			/Choose Staging's branch/,
		);
		const done = [envs[0]!, { label: 'Staging', branches: { 'o/r': 'staging' } }];
		expect(branchProblem(done, [{ repository: 'o/r', connected: true }], { 'o/r': list })).toBe('');
		expect(
			branchProblem(
				[{ label: 'Staging', branches: { 'o/r': 'gone' } }],
				[{ repository: 'o/r', connected: true }],
				{
					'o/r': list,
				},
			),
		).toMatch(/no longer a branch/);
	});
	it('searches branches best match first, and says where each lives', () => {
		expect(matchBranches(list.branches, 'comb').map((b) => b.name)).toEqual(['feat/combined-after-pr6']);
		expect(matchBranches(list.branches, 'dev').map((b) => b.name)[0]).toBe('dev');
		expect(branchWhere(list.branches[3]!, 'main', 'feat/combined-after-pr6')).toBe(
			'checked out on this computer · only on this computer',
		);
		expect(branchWhere(list.branches[0]!, 'main', null)).toBe('default branch · on GitHub and this computer');
	});
});
