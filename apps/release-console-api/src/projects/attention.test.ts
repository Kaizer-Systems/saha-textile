import { describe, expect, it } from 'vitest';

import { keyAttention, runAttention } from './attention.js';

import type { Project, WorkflowRun } from '@saha-textile/release-console-contracts';

const run = (over: Partial<WorkflowRun>): WorkflowRun => ({
	id: 1,
	name: 'CI',
	branch: 'main',
	event: 'push',
	status: 'completed',
	conclusion: 'success',
	createdAt: '2026-11-10T00:00:00Z',
	updatedAt: '2026-11-10T00:00:00Z',
	url: 'https://github.com/example/x/actions/runs/1',
	...over,
});

describe('attention', () => {
	it('flags only the latest run per workflow and branch, and approvals', () => {
		const items = runAttention('p', 'r', [
			run({ id: 1, conclusion: 'failure', createdAt: '2026-11-09T00:00:00Z' }),
			run({ id: 2, conclusion: 'success', createdAt: '2026-11-10T00:00:00Z' }),
			run({ id: 3, name: 'Deploy', conclusion: 'failure' }),
			run({ id: 4, branch: 'feat/x', conclusion: 'failure' }),
			run({ id: 5, name: 'Deploy staging', status: 'waiting', conclusion: null }),
		]);
		expect(items.map((i) => [i.kind, i.title])).toEqual([
			['ci-failed', 'Deploy failed on main'],
			['approval-waiting', 'Deploy staging waits for approval'],
		]);
	});

	it('lists slots without keys and keys in trouble', () => {
		const project = {
			id: 'p',
			name: 'P',
			workspace: 'W',
			createdAt: '2026-11-10T00:00:00Z',
			keys: [
				{
					id: 'cf-read',
					kind: 'cf-read',
					label: 'Cloudflare API · read',
					envNames: ['CONSOLE_CF_READ_TOKEN'],
					account: '',
					rights: [],
					expiresAt: '2026-11-12T00:00:00Z',
					checkedAt: null,
					state: 'expiring',
					note: '',
					target: '',
				},
			],
			repositories: [
				{
					id: 'r',
					name: 'r',
					role: '',
					sourceCode: { vendor: 'github', repository: 'o/r', keyId: null },
					environments: [
						{ name: 'local', label: 'Local', cloudId: null, domains: [], secretsId: null, secretsPath: '' },
					],
					cloud: [{ id: 'digitalocean', vendor: 'digitalocean', account: '', keyIds: [] }],
					edge: [{ id: 'cloudflare', vendor: 'cloudflare', account: '', zones: [], keyIds: ['cf-read'] }],
					secrets: [],
					menus: [],
				},
			],
		} satisfies Project;
		expect(keyAttention(project).map((i) => i.kind)).toEqual(['key-expiring', 'key-missing', 'key-missing']);
	});
});
