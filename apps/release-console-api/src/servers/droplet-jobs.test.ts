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
	sourceCode: { vendor: 'github', repository: 'example/shop', keyId: null },
	secrets: [{ id: 'inf', vendor: 'infisical' }],
	cloud: [{ id: 'do1', vendor: 'digitalocean', keyIds: ['do'] }],
	edge: [{ id: 'cf1', vendor: 'cloudflare', zones: ['example.com'], keyIds: ['cf'] }],
	environments: [
		{
			name: 'staging',
			label: 'Staging',
			cloudId: 'do1',
			secretsId: 'inf',
			secretsPath: 'example-staging/staging',
			domains: ['staging.example.com', 'api-staging.example.com'],
		},
		{
			name: 'production',
			label: 'Production',
			cloudId: 'do1',
			secretsId: 'inf',
			secretsPath: 'example-production/prod',
			domains: ['example.com'],
		},
	],
};
const catalog = {
	sizes: [{ slug: 's-2vcpu-4gb', priceMonthly: 24, priceHourly: 0.036 }],
} as unknown as DoCatalog;

function setup(over: Partial<JobDeps> = {}) {
	const audit = vi.fn();
	const setEnvTag = vi.fn();
	const projects = {
		repository: () => ({ project, repo }),
		valueOf: async (ref: { id: string }) => `example-${ref.id}-key`,
		setSshEmails: () => project,
		setEnvTag,
	} as unknown as ProjectsService;
	const jobs = new DropletJobs(projects, { audit } as unknown as ConsoleStore, {} as RunnerClient);
	const created: Record<string, unknown>[] = [];
	const records: string[] = [];
	const helperCalls: string[] = [];
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
			domains: async () => [],
			pointDoHost: async () => 'created' as const,
			firewall443: async () => [
				'173.245.48.0/20',
				'103.21.244.0/22',
				'103.22.200.0/22',
				'103.31.4.0/22',
				'141.101.64.0/18',
			],
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
			routeSsh: async () => undefined,
			pointTunnel: async () => 'created' as const,
			serviceToken: async () => ({ id: 'st1', clientId: 'example-id', clientSecret: 'example-secret' }),
			serviceTokensNamed: async () => [],
			deleteServiceToken: async () => undefined,
			accessAppFor: async () => null,
			accessApp: async () => 'app1',
			emailCodeSignIn: async () => false,
			deleteAccessApp: async () => undefined,
			originCertificate: async () => '-----BEGIN CERTIFICATE-----',
			uploadOriginPulls: async () => 'aop1',
			originPullsOn: async () => false,
			setOriginPulls: async () => undefined,
			unpointTunnel: async () => 1,
			accessEnabled: async () => true,
			privateRoute: async () => undefined,
			deletePrivateRoutes: async () => 1,
			warpEnrollment: async () => undefined,
			warpInclude: async () => undefined,
			zoneSetting: async () => 'full',
			setZoneSetting: async () => undefined,
			sslStrictRule: async () => 'created' as const,
			loginWall: async () => 'created' as const,
			serviceTokenOf: async () => ({ id: 'st1', expiresAt: '2027-11-23T00:00:00Z' }),
			rotateServiceToken: async () => ({ id: 'st1', clientId: 'example-id', clientSecret: 'example-new-secret' }),
			recordsOf: async () => [{ type: 'A', content: '203.0.113.9', proxied: true }],
			sslRuleOn: async () => true,
			originPullsOff: async () => [],
			originPullsCert: async () => 'aop1',
		},
		ranges: async () => [
			'173.245.48.0/20',
			'103.21.244.0/22',
			'103.22.200.0/22',
			'103.31.4.0/22',
			'141.101.64.0/18',
		],
		helper: (async (path: string) => {
			helperCalls.push(path);
			if (path === '/server/first-boot') return { userData: '#cloud-config\n' };
			if (path === '/server/origin-csr') return { csr: '-----BEGIN CERTIFICATE REQUEST-----' };
			if (path === '/server/aop-pair')
				return { caCertificate: 'CA', clientCertificate: 'CLIENT', clientKey: 'KEY' };
			if (path === '/server/certificates-save') return { saved: ['origin.pem', 'origin.key'] };
			if (path === '/github/environment') return { environmentMade: false, set: ['SERVER_SSH_HOST'] };
			if (path === '/server/known-hosts') return { line: 'ssh-staging.example.com ssh-ed25519 AAAAhost' };
			if (path === '/server/deploy-identity') return { tier: 'staging', identityId: 'example-identity' };
			if (path === '/github/environment-rules') return { reviewers: 1, set: [] };
			return {};
		}) as JobDeps['helper'],
		infisicalSet: async () => new Set<string>(),
		sleep: async () => undefined,
		waits: { activeEvery: 1, activeFor: 60_000, tunnelEvery: 1, tunnelFor: 60_000 },
		nameservers: async () => [],
		probe: async () => false,
		health: async () => 200,
		...over,
	} as JobDeps;
	return { jobs, audit, created, records, helperCalls, setEnvTag };
}

const draft = () => ({ ...serverDraftOf('saha-textile', 'staging'), sshKeyIds: [7] });
const done = async (jobs: DropletJobs, id: string) => {
	for (let i = 0; i < 50 && jobs.get(id).state === 'running'; i++) await new Promise((r) => setTimeout(r, 1));
	return jobs.get(id);
};

describe('creating and destroying a server', () => {
	it('creates the droplet step by step with the filled first-boot file and the Cloudflare records', async () => {
		const { jobs, created, records, audit, helperCalls } = setup();
		const started = await jobs.startCreate('saha-textile', 'saha-textile', 'do1', {
			pin: '000000',
			confirm: 'staging',
			draft: draft(),
			adminPassword: 'example only words',
			sshEmails: ['owner@example.com'],
		});
		const job = await done(jobs, started.id);
		expect(job.state).toBe('done');
		expect(job.steps.map((s) => `${s.key}:${s.state}`)).toEqual([
			'tunnel:done',
			'ssh-host:done',
			'access:done',
			'certificates:done',
			'first-boot:done',
			'volume:skipped',
			'droplet:done',
			'active:done',
			'addresses:done',
			'project:skipped',
			'firewall:done',
			'dns:done',
			'zone-check:done',
			'login-wall:done',
			'origin-pulls:done',
			'tunnel-up:done',
			'private-access:done',
			'github:done',
			'identity:done',
			'known-hosts:done',
			'ports:done',
			'ready:done',
		]);
		expect(created[0]).toMatchObject({ name: 'saha-textile-staging', user_data: '#cloud-config\n', ssh_keys: [7] });
		expect(created[0]).not.toHaveProperty('volumes');
		expect(records).toEqual(['staging.example.com', 'api-staging.example.com']);
		// Certificates made on the console's machine and kept in Infisical; GitHub set; host key read.
		expect(helperCalls).toEqual([
			'/server/origin-csr',
			'/server/aop-pair',
			'/server/certificates-save',
			'/server/first-boot',
			'/github/environment',
			'/server/deploy-identity',
			'/github/environment',
			'/github/environment-rules',
			'/server/known-hosts',
			'/github/environment',
		]);
		// The ready card keeps the two things only the owner can do; nothing blocks.
		expect(job.left.map((x) => x.blocking)).toEqual([false, false]);
		expect(job.monthly).toBe(24);
		// The audit log names what happened, never the password or the token.
		expect(JSON.stringify(audit.mock.calls)).not.toMatch(/example only words|example-tunnel-token|example-secret/);
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
			sshEmails: ['owner@example.com'],
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
				sshEmails: ['owner@example.com'],
			}),
		).rejects.toThrow('Type production to confirm.');
		const started = await jobs.startCreate('saha-textile', 'saha-textile', 'do1', {
			pin: '000000',
			confirm: 'production',
			draft: prod,
			adminPassword: 'example only words',
			sshEmails: ['owner@example.com'],
		});
		const job = await done(jobs, started.id);
		expect(job.steps.find((s) => s.key === 'dns')).toMatchObject({ state: 'skipped' });
		expect(records).toEqual([]);
	});

	it('destroys staging in reverse and never production', async () => {
		const { jobs, setEnvTag } = setup();
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
		expect(job.steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done', 'done', 'done']);
		// The droplet's environment tag goes with it (owner, 23 Nov).
		expect(setEnvTag).toHaveBeenCalledWith('saha-textile', 'saha-textile', 'do:droplet:42', null);
	});

	it('says Zero Trust must be on before it makes anything', async () => {
		const { jobs, created } = setup();
		jobs.deps = { ...jobs.deps, cf: { ...jobs.deps.cf, accessEnabled: async () => false } };
		await expect(
			jobs.startCreate('saha-textile', 'saha-textile', 'do1', {
				pin: '000000',
				confirm: 'staging',
				draft: draft(),
				adminPassword: 'example only words',
				sshEmails: ['owner@example.com'],
			}),
		).rejects.toThrow('Zero Trust is not switched on');
		expect(created).toEqual([]);
	});

	it('refuses to finish without a required reviewer or with a port open, and says what is left', async () => {
		const { jobs } = setup({
			probe: async (_h: string, port: number) => port === 80,
		});
		const deps = jobs.deps;
		jobs.deps = {
			...deps,
			helper: (async (path: string, body: Record<string, unknown>) =>
				path === '/github/environment-rules'
					? { reviewers: 0, set: ['tag staging-*'] }
					: deps.helper(path, body)) as JobDeps['helper'],
		};
		const started = await jobs.startCreate('saha-textile', 'saha-textile', 'do1', {
			pin: '000000',
			confirm: 'staging',
			draft: draft(),
			adminPassword: 'example only words',
			sshEmails: ['owner@example.com'],
		});
		const job = await done(jobs, started.id);
		expect(job.state).toBe('failed');
		expect(job.steps.find((s) => s.key === 'ready')).toMatchObject({ state: 'failed' });
		expect(job.left.filter((x) => x.blocking).map((x) => x.text)).toEqual([
			expect.stringMatching(/no required reviewer/),
			expect.stringMatching(/80 \(plain HTTP\)/),
		]);
	});

	it('points a host on DigitalOcean DNS there and opens 443 to everyone for it', async () => {
		const bodies: Record<string, unknown>[] = [];
		const doHosts: string[] = [];
		const { jobs } = setup({ nameservers: async () => ['ns1.digitalocean.com', 'ns2.digitalocean.com'] });
		const deps = jobs.deps;
		jobs.deps = {
			...deps,
			do: {
				...deps.do,
				domains: async () => ['example.org'],
				pointDoHost: async (_k: string, _d: string, host: string) => {
					doHosts.push(host);
					return 'created' as const;
				},
				createFirewall: async (_k: string, body: Record<string, unknown>) => {
					bodies.push(body);
					return 'fw-1';
				},
			},
		};
		const env = repo.environments[0] as { domains: string[] };
		const before = env.domains;
		env.domains = ['staging.example.com', 'shop.example.org'];
		try {
			const started = await jobs.startCreate('saha-textile', 'saha-textile', 'do1', {
				pin: '000000',
				confirm: 'staging',
				draft: draft(),
				adminPassword: 'example only words',
				sshEmails: ['owner@example.com'],
			});
			const job = await done(jobs, started.id);
			expect(job.state).toBe('done');
			expect(doHosts).toEqual(['shop.example.org']);
			expect(JSON.stringify(bodies[0])).toContain('0.0.0.0/0');
		} finally {
			env.domains = before;
		}
	});

	it('renews the deploy token into the two GitHub secrets, and finishes setup with only those steps', async () => {
		const { jobs, helperCalls, audit } = setup();
		const renew = await done(
			jobs,
			(await jobs.startFix('saha-textile', 'saha-textile', 'do1', { environment: 'staging', kind: 'renew' })).id,
		);
		expect(renew.state).toBe('done');
		expect(renew.steps.map((s) => s.key)).toEqual(['token', 'github']);
		const finish = await done(
			jobs,
			(await jobs.startFix('saha-textile', 'saha-textile', 'do1', { environment: 'staging', kind: 'finish' })).id,
		);
		expect(finish.state).toBe('done');
		expect(finish.steps.map((s) => `${s.key}:${s.state}`)).toEqual([
			'token:done',
			'github:done',
			'identity:done',
			'known-hosts:done',
			'ready:done',
		]);
		expect(helperCalls.filter((h) => h === '/server/known-hosts')).toHaveLength(1);
		expect(JSON.stringify(audit.mock.calls)).not.toMatch(/example-new-secret/);
	});

	it('checks a server is reachable through Cloudflare by name, and turns origin pulls on again', async () => {
		const { jobs, audit } = setup({ health: async () => 525 });
		const deps = jobs.deps;
		const enabled: string[][] = [];
		jobs.deps = {
			...deps,
			cf: {
				...deps.cf,
				originPullsOff: async () => ['api-staging.example.com'],
				setOriginPulls: async (_k: string, _z: string, hosts: string[], cert: string | null, on: boolean) => {
					if (on && cert === 'aop1') enabled.push(hosts);
				},
			},
		};
		const r = await jobs.reachable('saha-textile', 'saha-textile', 'staging');
		expect(r.checks.map((c) => `${c.key}:${c.ok}`)).toEqual([
			'health:false',
			'dns:staging.example.com:true',
			'dns:api-staging.example.com:true',
			'ssl:true',
			'origin-pulls:false',
			'firewall:true',
		]);
		expect(r.checks.find((c) => c.key === 'origin-pulls')).toMatchObject({ fix: 'origin-pulls' });
		await jobs.fixReachable('saha-textile', 'saha-textile', 'staging', 'origin-pulls');
		expect(enabled).toEqual([['staging.example.com', 'api-staging.example.com']]);
		expect(audit).toHaveBeenCalledWith('saha-textile', 'origin-pulls-on', expect.any(String));
	});
});
