import { describe, expect, it } from 'vitest';

import { sshHostOf } from './droplet-job.js';
import { envOfBranch, envOfHost } from './env-labels.js';
import { opsKeyName } from './ops.js';
import { readManifest } from './release-manifest.js';
import { afterRotate, emptyRotation } from './rotation.js';

describe('which key reads an environment’s /ops', () => {
	it('this computer’s stack has its own; servers go by their environment’s name', () => {
		expect(opsKeyName({ name: 'local', cloudId: null })).toBe('CONSOLE_OPS_TOKEN_LOCAL');
		expect(opsKeyName({ name: 'Development', cloudId: 'd1' })).toBe('CONSOLE_OPS_TOKEN_DEV');
		expect(opsKeyName({ name: 'staging', cloudId: 'd2' })).toBe('CONSOLE_OPS_TOKEN_STAGING');
		expect(opsKeyName({ name: 'production', cloudId: 'd3' })).toBe('CONSOLE_OPS_TOKEN_PRODUCTION');
		expect(opsKeyName({ name: 'preview', cloudId: 'd4' })).toBeNull();
	});

	it('names a server’s SSH host after its environment', () => {
		expect(sshHostOf('staging', 'example.com')).toBe('ssh-staging.example.com');
	});
});

describe('environment labels for environments without a label, domains or branch', () => {
	const envs = [{ name: 'preview' }, { name: 'staging', label: 'Staging', domains: ['staging.example.com'] }];

	it('uses the name when there is no label, and the default branch when there is no branch', () => {
		expect(envOfBranch(envs, 'main', 'main')).toBe('mixed: preview, Staging');
		expect(envOfBranch(envs, 'release', 'main')).toBeNull();
		expect(envOfBranch(envs, '   ', 'main')).toBeNull();
	});

	it('finds no environment for an empty host, and skips environments with no domains', () => {
		expect(envOfHost(envs, '  ')).toBeNull();
		expect(envOfHost(envs, 'staging.example.com')).toBe('Staging');
		expect(envOfHost(envs, 'api.staging.example.com')).toBe('Staging');
		expect(envOfHost(envs, '*.example.com')).toBe('Staging');
	});
});

describe('rotation records', () => {
	it('keep the grace period as it was when a run neither moves nor clears an old key', () => {
		const state = { ...emptyRotation(), graceAt: '2026-11-20T00:00:00.000Z', graceNames: ['CSRF_SECRET_PREVIOUS'] };
		const next = afterRotate(state, [], {
			tier: 'staging',
			project: 'saha-textile-staging',
			at: '2026-11-23T10:00:00.000Z',
			changed: [],
			movedToPrevious: [],
			clearedPrevious: [],
			needsRotateDeploy: false,
		});
		expect(next.graceAt).toBe('2026-11-20T00:00:00.000Z');
		expect(next.graceNames).toEqual(['CSRF_SECRET_PREVIOUS']);
	});
});

describe('reading a release manifest', () => {
	it('names the version when it is the version that cannot be read', () => {
		const { manifest, problems } = readManifest({ version: 'two', product: { name: 'Shop', kind: 'shop' } });
		expect(manifest).toBeNull();
		expect(problems).toEqual([expect.stringMatching(/^version: /)]);
	});

	it('keeps every good line when several bad ones are dropped', () => {
		const { manifest, problems } = readManifest({
			version: 2,
			product: { name: 'Shop', kind: 'shop' },
			menus: ['seo'],
			links: { 'Bad Name': 'docs/guide.md' },
			backups: { script: 'x', store: 'tape' },
		});
		expect(manifest?.menus).toEqual(['seo']);
		expect(problems).toHaveLength(2);
		expect(problems.every((problem) => /” was skipped: /.test(problem))).toBe(true);
	});
});
