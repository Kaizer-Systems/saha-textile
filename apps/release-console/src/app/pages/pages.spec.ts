import { describe, expect, it } from 'vitest';

import { andList, edgeProblem, envProblem, placeNote, secretsProblem, slugOf } from './add-project';
import { keyPill } from './connections';

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
			secretsProblem([{ ...local, secretsFrom: 'infisical', secretsPath: 'saha-textile-dev' }], infisical),
		).toMatch(/project\/environment/);
		expect(
			secretsProblem([{ ...local, secretsFrom: 'infisical', secretsPath: 'saha-textile-dev/dev' }], infisical),
		).toBe('');
		expect(secretsProblem([{ ...local, secretsFrom: 'doppler', secretsPath: 'shop/prd' }], infisical)).toMatch(
			/Choose where Local reads/,
		);
	});

	it('says what an Infisical place reads, in words', () => {
		expect(placeNote('infisical', 'saha-textile-dev/dev')).toBe(
			'Reads project saha-textile-dev, environment dev, every folder.',
		);
		expect(placeNote('infisical', 'saha-textile-dev/dev/api')).toContain('only /api');
		expect(placeNote('infisical', '')).toContain('saha-textile-dev/dev/api');
		expect(andList(['Local', 'Staging', 'Production'])).toBe('Local, Staging and Production');
	});

	it('makes ids from names', () => {
		expect(slugOf('Client shop')).toBe('client-shop');
		expect(slugOf('  Saha Textile & Co. ')).toBe('saha-textile-co');
	});
});
