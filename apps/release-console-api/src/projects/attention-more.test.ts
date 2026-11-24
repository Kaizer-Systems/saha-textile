import { describe, expect, it, vi } from 'vitest';

import { keyAttention, runAttention } from './attention.js';
import { AttentionService } from './attention.service.js';
import { ProjectsController } from './projects.controller.js';

import type { ProjectsService } from './projects.service.js';
import type { VendorReadsService } from './vendor-reads.service.js';
import type { LocalAlerts } from '../local/local-alerts.js';
import type { DropletJobs } from '../servers/droplet-jobs.js';
import type { Project, WorkflowRun } from '@saha-textile/release-console-contracts';

const key = (id: string, kind: string, state: string, expiresAt: string | null = null) => ({
	id,
	kind,
	label: id,
	state,
	expiresAt,
	note: 'Read again.',
	envNames: [],
});
const PROJECT = {
	id: 'acme',
	name: 'Acme',
	keys: [
		key('ok', 'do-read', 'ok'),
		key('soon', 'cf-read', 'expiring', '2026-12-01T00:00:00Z'),
		key('gone', 'github-token', 'expired'),
		key('bad', 'do-change', 'failed'),
	],
	repositories: [
		{
			id: 'shop',
			name: 'shop',
			sourceCode: { vendor: 'github', keyId: 'gone' },
			cloud: [
				{ id: 'do', vendor: 'digitalocean', keyIds: ['ok'] },
				{ id: 'aws', vendor: 'aws', keyIds: [] },
			],
			edge: [
				{ id: 'cf', vendor: 'cloudflare', keyIds: [] },
				{ id: 'fastly', vendor: 'fastly', keyIds: [] },
			],
			environments: [
				{ name: 'local', label: 'Local', cloudId: null },
				{ name: 'staging', label: 'Staging', cloudId: 'do' },
			],
		},
		{
			id: 'docs',
			name: 'docs',
			sourceCode: { vendor: 'gitlab', keyId: null },
			cloud: [],
			edge: [],
			environments: [],
		},
	],
} as unknown as Project;

describe('what needs the owner', () => {
	it('names each key’s trouble and each slot without a key', () => {
		expect(keyAttention(PROJECT).map((i) => [i.kind, i.title])).toEqual([
			['key-expiring', 'soon expires soon'],
			['key-expired', 'gone has expired'],
			['key-failed', 'bad failed its check'],
			['key-missing', 'shop: Cloudflare is not connected'],
		]);
		expect(keyAttention(PROJECT)[0]?.detail).toBe('Ends 2026-12-01. Read again.');
	});

	it('keeps the newest run of a workflow when the older one comes later in the list', () => {
		const run = (id: number, createdAt: string, conclusion: string): WorkflowRun =>
			({
				id,
				name: 'CI',
				branch: 'main',
				status: 'completed',
				conclusion,
				createdAt,
				url: `u${id}`,
			}) as WorkflowRun;
		expect(runAttention('p', 'r', [run(2, '2026-11-10', 'failure'), run(1, '2026-11-09', 'success')])).toHaveLength(
			1,
		);
	});

	it('gathers runs, rotations, deploy tokens and this Mac’s alerts, and remembers them a minute', async () => {
		const runs = vi.fn(async (_p: string, r: string) =>
			r === 'shop'
				? {
						state: 'ok' as const,
						readAt: '',
						data: [
							{
								name: 'CI',
								branch: 'main',
								status: 'waiting',
								conclusion: null,
								createdAt: '1',
								url: 'u',
							},
						],
					}
				: { state: 'not-connected' as const, message: 'no' },
		);
		const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
		const projects = {
			project: () => PROJECT,
			view: () => ({ projects: [PROJECT] }),
			rotation: (_p: string, _r: string, env: string) =>
				env === 'staging'
					? { pending: ['mongo-app'], lastChanged: [], graceNames: ['MONGO_OLD'], graceAt: old }
					: { pending: [], lastChanged: [], graceNames: ['X'], graceAt: new Date().toISOString() },
		} as unknown as ProjectsService;
		const soon = new Date(Date.now() + 5 * 86_400_000).toISOString();
		const jobs = {
			deployTokens: vi
				.fn()
				.mockResolvedValueOnce([
					{ repositoryId: 'shop', environment: 'staging', name: 'acme-staging', expiresAt: soon },
					{ repositoryId: 'shop', environment: 'production', name: 'acme-production', expiresAt: null },
					{ repositoryId: 'shop', environment: 'qa', name: 'acme-qa', expiresAt: '2099-01-01T00:00:00Z' },
				])
				.mockRejectedValueOnce(new Error('down')),
		} as unknown as DropletJobs;
		const alerts = {
			firing: () => [
				{ rule: 'disk', title: 'Disk nearly full', detail: '92% used.', firedAt: '2026-11-24T04:05:00.000Z' },
				{ rule: 'key-expiring', title: 'Key', detail: '', firedAt: '2026-11-24T04:05:00.000Z' },
			],
		} as unknown as LocalAlerts;
		const service = new AttentionService(projects, { runs } as unknown as VendorReadsService, alerts, jobs);
		const items = await service.forProject('acme');
		expect(items.map((i) => i.kind)).toEqual(
			expect.arrayContaining([
				'approval-waiting',
				'rotation-waiting',
				'old-keys',
				'deploy-token-expiring',
				'local-alert',
			]),
		);
		expect(items.find((i) => i.kind === 'local-alert')?.detail).toBe('92% used. This Mac · since 04:05.');
		expect(await service.counts()).toEqual([{ projectId: 'acme', name: 'Acme', count: items.length }]);
		service.forget('acme');
		expect((await service.forProject('acme')).some((i) => i.kind === 'deploy-token-expiring')).toBe(false);
		const cloudOnly = {
			...PROJECT,
			repositories: [{ ...PROJECT.repositories[1], environments: [{ name: 'p', cloudId: 'do' }] }],
		};
		const remote = new AttentionService(
			{ ...projects, project: () => cloudOnly } as unknown as ProjectsService,
			{ runs } as unknown as VendorReadsService,
			alerts,
			{ deployTokens: async () => [] } as unknown as DropletJobs,
		);
		expect((await remote.forProject('acme')).some((i) => i.kind === 'local-alert')).toBe(false);
	});
});

describe('the project routes', () => {
	it('forgets the cached list after a key is linked, and reads only jobs or messages', async () => {
		const forget = vi.fn();
		const ops = vi.fn(async () => ({ state: 'ok' }));
		const c = new ProjectsController(
			{ linkKey: vi.fn(async () => ({ id: 'k' })) } as unknown as ProjectsService,
			{ ops } as unknown as VendorReadsService,
			{ forget } as unknown as AttentionService,
			{} as never,
			{} as never,
		);
		expect(await c.storeKey('acme', { id: 'k', kind: 'do-read', label: 'DO' })).toEqual({ id: 'k' });
		expect(forget).toHaveBeenCalledWith('acme');
		await c.ops('acme', 'shop', 'staging', 'messages');
		expect(ops).toHaveBeenCalledWith('acme', 'shop', 'staging', 'messages');
		expect(() => c.ops('acme', 'shop', 'staging', 'other')).toThrow();
	});
});
