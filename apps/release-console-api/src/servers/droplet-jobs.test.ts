import { describe, expect, it, vi } from 'vitest';

import { type DoCatalog, serverDraftOf } from '@saha-textile/release-console-contracts';

import { DropletJobs, type JobDeps } from './droplet-jobs.js';
import type { ProjectsService } from '../projects/projects.service.js';
import type { RunnerClient } from '../runner/runner-client.js';
import type { ConsoleStore } from '../store/console-store.js';
import { VendorError } from '../vendors/http.js';

/** A made-up project: no real account, key or token is used anywhere in these tests. */
const project = {
	id: 'saha-textile',
	keys: [
		{ id: 'do', kind: 'do-change', envNames: ['X'], label: 'DO', state: 'ok' },
		{ id: 'cf', kind: 'cf-change', envNames: ['Y'], label: 'CF', state: 'ok' },
	],
};
const repo = {
	id: 'saha-textile',
	cloud: [{ id: 'do1', vendor: 'digitalocean', keyIds: ['do'] }],
	edge: [{ id: 'cf1', vendor: 'cloudflare', zones: ['example.com'], keyIds: ['cf'] }],
	environments: [
		{ name: 'staging', cloudId: 'do1', domains: ['staging.example.com', 'api-staging.example.com'] },
		{ name: 'production', cloudId: 'do1', domains: ['example.com'] },
	],
};
const catalog = {
	sizes: [{ slug: 's-2vcpu-4gb', priceMonthly: 24, priceHourly: 0.036 }],
} as unknown as DoCatalog;

function setup(over: Partial<JobDeps> = {}) {
	const audit = vi.fn();
	const projects = {
		repository: () => ({ project, repo }),
		valueOf: async (ref: { id: string }) => `example-${ref.id}-key`,
	} as unknown as ProjectsService;
	const jobs = new DropletJobs(projects, { audit } as unknown as ConsoleStore, {} as RunnerClient);
	const created: Record<string, unknown>[] = [];
	const records: string[] = [];
	let polls = 0;
	jobs.deps = {
		catalog: async () => catalog,
		do: {
			publicKey: async () => 'ssh-ed25519 AAAAexample admin',
			createVolume: async () => 'vol-1',
			createDroplet: async (_k: string, body: Record<string, unknown>) => {
				created.push(body);
				return 42;
			},
			droplet: async () => ({
				id: 42,
				name: 'saha-textile-staging',
				status: ++polls > 1 ? 'active' : 'new',
				ipv4: '203.0.113.9',
				ipv6: null,
				privateIp: '10.0.0.2',
			}),
			dropletsTagged: async () => [
				{
					id: 42,
					name: 'saha-textile-staging',
					status: 'active',
					ipv4: '203.0.113.9',
					ipv6: null,
					privateIp: null,
				},
				{
					id: 43,
					name: 'saha-textile-production',
					status: 'active',
					ipv4: '203.0.113.10',
					ipv6: null,
					privateIp: null,
				},
			],
			assign: async () => undefined,
			createFirewall: async () => 'fw-1',
			firewallsNamed: async () => [],
			deleteFirewall: async () => undefined,
			deleteDroplet: async () => undefined,
		},
		cf: {
			zone: async () => ({ id: 'z1', name: 'example.com', accountId: 'a1' }),
			tunnelNamed: async () => null,
			createTunnel: async () => ({ id: 't1', name: 'saha-textile-staging' }),
			tunnelToken: async () => 'example-tunnel-token',
			tunnelConnections: async () => 4,
			deleteTunnel: async () => undefined,
			pointHost: async (_k: string, _z: string, host: string) => {
				records.push(host);
				return 'created' as const;
			},
			unpointHost: async () => 1,
		},
		ranges: async () => [
			'173.245.48.0/20',
			'103.21.244.0/22',
			'103.22.200.0/22',
			'103.31.4.0/22',
			'141.101.64.0/18',
		],
		firstBoot: async () => ({ userData: '#cloud-config\n', deployPublicKey: 'ssh-ed25519 AAAAdeploy' }),
		sleep: async () => undefined,
		waits: { activeEvery: 1, activeFor: 60_000, tunnelEvery: 1, tunnelFor: 60_000 },
		...over,
	} as JobDeps;
	return { jobs, audit, created, records };
}

const draft = () => ({ ...serverDraftOf('saha-textile', 'staging'), sshKeyIds: [7] });
const done = async (jobs: DropletJobs, id: string) => {
	for (let i = 0; i < 50 && jobs.get(id).state === 'running'; i++) await new Promise((r) => setTimeout(r, 1));
	return jobs.get(id);
};

describe('creating and destroying a server', () => {
	it('creates the droplet step by step with the filled first-boot file and the Cloudflare records', async () => {
		const { jobs, created, records, audit } = setup();
		const started = await jobs.startCreate('saha-textile', 'saha-textile', 'do1', {
			pin: '000000',
			confirm: 'staging',
			draft: draft(),
			adminPassword: 'example only words',
		});
		const job = await done(jobs, started.id);
		expect(job.state).toBe('done');
		expect(job.steps.map((s) => `${s.key}:${s.state}`)).toEqual([
			'tunnel:done',
			'first-boot:done',
			'volume:skipped',
			'droplet:done',
			'active:done',
			'addresses:done',
			'project:skipped',
			'firewall:done',
			'dns:done',
			'tunnel-up:done',
		]);
		expect(created[0]).toMatchObject({ name: 'saha-textile-staging', user_data: '#cloud-config\n', ssh_keys: [7] });
		expect(created[0]).not.toHaveProperty('volumes');
		expect(records).toEqual(['staging.example.com', 'api-staging.example.com']);
		expect(job.monthly).toBe(24);
		// The audit log names what happened, never the password or the token.
		expect(JSON.stringify(audit.mock.calls)).not.toMatch(/example only words|example-tunnel-token/);
	});

	it('stops at a DNS record that points elsewhere and never overwrites it', async () => {
		const { jobs } = setup();
		const deps = jobs.deps;
		jobs.deps = {
			...deps,
			cf: {
				...deps.cf,
				pointHost: async () => {
					throw new VendorError(
						'staging.example.com already points to 198.51.100.1 (A); the console does not overwrite it.',
						409,
					);
				},
			},
		};
		const started = await jobs.startCreate('saha-textile', 'saha-textile', 'do1', {
			pin: '000000',
			confirm: 'staging',
			draft: draft(),
			adminPassword: 'example only words',
		});
		const job = await done(jobs, started.id);
		expect(job.state).toBe('failed');
		expect(job.steps.find((s) => s.key === 'dns')).toMatchObject({ state: 'failed' });
		expect(job.error).toMatch(/does not overwrite/);
		expect(job.steps.find((s) => s.key === 'tunnel-up')?.state).toBe('queued');
	});

	it('leaves production DNS to the DNS switch and refuses a wrong typed name', async () => {
		const { jobs, records } = setup();
		const prod = { ...serverDraftOf('saha-textile', 'production'), sshKeyIds: [7], size: 's-2vcpu-4gb' };
		await expect(
			jobs.startCreate('saha-textile', 'saha-textile', 'do1', {
				pin: '000000',
				confirm: 'staging',
				draft: prod,
				adminPassword: 'example only words',
			}),
		).rejects.toThrow('Type production to confirm.');
		const started = await jobs.startCreate('saha-textile', 'saha-textile', 'do1', {
			pin: '000000',
			confirm: 'production',
			draft: prod,
			adminPassword: 'example only words',
		});
		const job = await done(jobs, started.id);
		expect(job.steps.find((s) => s.key === 'dns')).toMatchObject({ state: 'skipped' });
		expect(records).toEqual([]);
	});

	it('destroys staging in reverse and never production', async () => {
		const { jobs } = setup();
		await expect(
			jobs.startDestroy('saha-textile', 'saha-textile', 'do1', {
				confirm: 'saha-textile-production',
				dropletId: 43,
			}),
		).rejects.toThrow('never destroyed');
		await expect(
			jobs.startDestroy('saha-textile', 'saha-textile', 'do1', { confirm: 'wrong', dropletId: 42 }),
		).rejects.toThrow('Type saha-textile-staging to confirm.');
		const started = await jobs.startDestroy('saha-textile', 'saha-textile', 'do1', {
			confirm: 'saha-textile-staging',
			dropletId: 42,
		});
		const job = await done(jobs, started.id);
		expect(job.state).toBe('done');
		expect(job.steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done']);
	});
});
