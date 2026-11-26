import { createServer } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type DoCatalog, serverDraftOf } from '@saha-textile/release-console-contracts';

import { DropletJobs, type JobDeps } from './droplet-jobs.js';
import { digitalOceanAdapter } from '../vendors/digitalocean.adapter.js';

import type { ProjectsService } from '../projects/projects.service.js';
import type { RunnerClient } from '../runner/runner-client.js';
import type { ConsoleStore } from '../store/console-store.js';

vi.mock('node:dns/promises', () => ({
	resolveNs: vi.fn(async (domain: string) => {
		if (domain === 'broken.example') throw new Error('ENOTFOUND');
		return ['ns1.digitalocean.com'];
	}),
}));

/** A made-up project: no real account, key or token is used anywhere in these tests. */
type Env = {
	name: string;
	label: string;
	cloudId: string | null;
	secretsId: string | null;
	secretsPath: string;
	domains: string[];
	branch?: string;
};
const env = (name: string, domains: string[], over: Partial<Env> = {}): Env => ({
	name,
	label: name[0]?.toUpperCase() + name.slice(1),
	cloudId: 'do1',
	secretsId: 'inf',
	secretsPath: `example-${name}/${name}`,
	domains,
	...over,
});
function world(
	over: { keys?: unknown[]; repo?: Record<string, unknown>; environments?: Env[]; repos?: unknown[] } = {},
) {
	const repo = {
		id: 'shop',
		sourceCode: { vendor: 'github', repository: 'example/shop', keyId: null },
		secrets: [{ id: 'inf', vendor: 'infisical' }],
		cloud: [{ id: 'do1', vendor: 'digitalocean', keyIds: ['do'] }],
		edge: [{ id: 'cf1', vendor: 'cloudflare', zones: ['example.com'], keyIds: ['cf'] }],
		environments: over.environments ?? [
			env('staging', ['staging.example.com', 'api-staging.example.com']),
			env('production', ['example.com']),
			env('qa', ['qa.example.com']),
			env('local', [], { cloudId: null }),
		],
		...over.repo,
	};
	const project = {
		id: 'acme',
		sshEmails: ['owner@example.com'],
		keys: over.keys ?? [
			{ id: 'do', kind: 'do-change', envNames: ['X'], label: 'DO', state: 'ok' },
			{ id: 'cf', kind: 'cf-change', envNames: ['Y'], label: 'CF', state: 'ok' },
		],
		repositories: over.repos ?? [repo],
	};
	return { project, repo };
}

const catalog = { sizes: [{ slug: 's-2vcpu-4gb', priceMonthly: 24, priceHourly: 0.036 }] } as unknown as DoCatalog;

function setup(w = world(), over: Partial<JobDeps> = {}) {
	const audit = vi.fn();
	const projects = {
		repository: () => ({ project: w.project, repo: w.repo }),
		project: () => w.project,
		valueOf: async (ref: { id: string }) => `example-${ref.id}-key`,
		setSshEmails: () => w.project,
		setEnvTag: vi.fn(),
	} as unknown as ProjectsService;
	const jobs = new DropletJobs(projects, { audit } as unknown as ConsoleStore, {} as RunnerClient);
	const helperCalls: string[] = [];
	jobs.deps = {
		catalog: async () => catalog,
		do: {
			publicKey: async () => 'ssh-ed25519 AAAAexample admin',
			createVolume: async () => 'vol-1',
			createDroplet: async () => 42,
			droplet: async () => ({
				id: 42,
				name: 'acme-staging',
				status: 'active',
				ipv4: '203.0.113.9',
				ipv6: '2001:db8::9',
				privateIp: '10.0.0.2',
			}),
			dropletsTagged: async () => [
				{ id: 42, name: 'acme-staging', status: 'active', ipv4: '203.0.113.9', ipv6: null, privateIp: null },
				{ id: 44, name: 'acme-qa', status: 'active', ipv4: null, ipv6: null, privateIp: null },
			],
			assign: async () => undefined,
			createFirewall: async () => 'fw-1',
			firewallsNamed: async () => [],
			deleteFirewall: async () => undefined,
			deleteDroplet: async () => undefined,
			domains: async () => [],
			pointDoHost: async () => 'exists' as const,
			firewall443: async () => ['173.245.48.0/20'],
		},
		cf: {
			zone: async () => ({ id: 'z1', name: 'example.com', accountId: 'a1' }),
			tunnelNamed: async () => ({ id: 't0', name: 'acme-staging' }),
			createTunnel: async () => ({ id: 't1', name: 'acme-staging' }),
			tunnelToken: async () => 'example-tunnel-token',
			tunnelConnections: async () => 1,
			deleteTunnel: async () => undefined,
			pointHost: async () => 'exists' as const,
			unpointHost: async () => 1,
			routeSsh: async () => undefined,
			pointTunnel: async () => 'exists' as const,
			serviceToken: async () => ({ id: 'st1', clientId: 'example-id', clientSecret: 'example-secret' }),
			serviceTokensNamed: async () => ['old-token'],
			deleteServiceToken: async () => undefined,
			accessAppFor: async () => ({ id: 'app0' }),
			accessApp: async () => 'app1',
			emailCodeSignIn: async () => true,
			deleteAccessApp: async () => undefined,
			originCertificate: async () => '-----BEGIN CERTIFICATE-----',
			uploadOriginPulls: async () => 'aop1',
			originPullsOn: async () => true,
			setOriginPulls: async () => undefined,
			unpointTunnel: async () => 1,
			accessEnabled: async () => true,
			privateRoute: async () => undefined,
			deletePrivateRoutes: async () => 1,
			warpEnrollment: async () => undefined,
			warpInclude: async () => undefined,
			zoneSetting: async () => '',
			setZoneSetting: async () => undefined,
			sslStrictRule: async () => 'kept' as const,
			loginWall: async () => 'kept' as const,
			serviceTokenOf: async () => ({ id: 'st1', expiresAt: null }),
			rotateServiceToken: async () => ({ id: 'st1', clientId: 'example-id', clientSecret: 'example-new' }),
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
			if (path === '/server/origin-csr') return { csr: 'CSR' };
			if (path === '/server/aop-pair') return { caCertificate: 'CA', clientCertificate: 'C', clientKey: 'K' };
			if (path === '/server/certificates-save') return { saved: ['origin-ca.pem'] };
			if (path === '/github/environment') return { environmentMade: true, set: ['SERVER_SSH_HOST'] };
			if (path === '/server/known-hosts') return { line: 'ssh-staging.example.com ssh-ed25519 AAAAhost' };
			if (path === '/server/deploy-identity') return { identityId: null };
			if (path === '/github/environment-rules') return { reviewers: 2, set: ['branch dev'] };
			return {};
		}) as JobDeps['helper'],
		infisicalSet: async () => new Set(['origin.pem', 'origin.key', 'cloudflare-client-ca.pem']),
		sleep: async () => undefined,
		waits: { activeEvery: 1, activeFor: 60_000, tunnelEvery: 1, tunnelFor: 60_000 },
		nameservers: async () => [],
		probe: async () => false,
		health: async () => 0,
		...over,
	} as JobDeps;
	return { jobs, audit, helperCalls, projects };
}

const draft = (environment = 'staging', over: Record<string, unknown> = {}) => ({
	...serverDraftOf('acme', environment),
	sshKeyIds: [7],
	...over,
});
const create = (jobs: DropletJobs, d = draft(), confirm = d.environment, emails = ['owner@example.com']) =>
	jobs.startCreate('acme', 'shop', 'do1', {
		pin: '000000',
		confirm,
		draft: d,
		adminPassword: 'example words',
		sshEmails: emails,
	});
const done = async (jobs: DropletJobs, id: string) => {
	for (let i = 0; i < 100 && jobs.get(id).state === 'running'; i++) await new Promise((r) => setTimeout(r, 1));
	return jobs.get(id);
};
const step = (job: { steps: Array<{ key: string; state: string; detail: string }> }, key: string) =>
	job.steps.find((s) => s.key === key);

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('droplet jobs: what they refuse before anything is made', () => {
	it('lists its jobs newest first and says when one is gone', async () => {
		const { jobs } = setup();
		const first = await create(jobs);
		await done(jobs, first.id);
		const second = await create(jobs);
		await done(jobs, second.id);
		expect(jobs.list('acme', 'shop')).toHaveLength(2);
		expect(jobs.list('other', 'shop')).toEqual([]);
		expect(() => jobs.get('missing')).toThrow('No such job');
	});

	it('needs the slot, the DigitalOcean change key and the Cloudflare change key', async () => {
		await expect(
			setup().jobs.startDestroy('acme', 'shop', 'nope', { confirm: 'x', dropletId: 42 }),
		).rejects.toThrow('no such DigitalOcean slot');
		const noDo = setup(world({ keys: [{ id: 'cf', kind: 'cf-change' }] }));
		await expect(create(noDo.jobs)).rejects.toThrow('DigitalOcean full-access key');
		const noCf = setup(world({ keys: [{ id: 'do', kind: 'do-change' }] }));
		await expect(create(noCf.jobs)).rejects.toThrow('Cloudflare full-access key');
		const noEdge = setup(world({ repo: { edge: [] } }));
		await expect(create(noEdge.jobs)).rejects.toThrow('Cloudflare full-access key');
	});

	it('refuses an environment elsewhere, more than one server, no SSH key, a target-less first boot and no zone', async () => {
		const { jobs } = setup();
		await expect(create(jobs, draft('local'))).rejects.toThrow(
			'is not an environment on this DigitalOcean account',
		);
		await expect(create(jobs, draft('staging', { quantity: 2 }))).rejects.toThrow('one server per environment');
		await expect(create(jobs, draft('staging', { sshKeyIds: [] }))).rejects.toThrow('Pick at least one SSH key');
		await expect(create(jobs, draft('qa'))).rejects.toThrow('neither development, staging nor production');
		const zoneless = setup(
			world({ repo: { edge: [{ id: 'cf1', vendor: 'cloudflare', zones: [], keyIds: ['cf'] }] } }),
		);
		await expect(create(zoneless.jobs)).rejects.toThrow('names no Cloudflare zone for the tunnel');
	});
});

describe('droplet jobs: creating, with what was there already', () => {
	it('keeps the tunnel, tokens and certificates it finds, adds a volume and a project, and leaves blocking things', async () => {
		const { jobs, helperCalls } = setup();
		const started = await create(
			jobs,
			draft('staging', { volumeGb: 10, volumeFormat: 'ext4', projectId: 'do-project' }),
		);
		const job = await done(jobs, started.id);
		expect(step(job, 'tunnel')?.detail).toContain('kept tunnel');
		expect(step(job, 'ssh-host')?.detail).toContain('already there');
		expect(step(job, 'access')?.detail).toContain('1 person on the list · sign-in by email code added');
		expect(step(job, 'certificates')?.detail).toContain('Origin Certificate kept from Infisical');
		expect(step(job, 'certificates')?.detail).toContain('origin-pulls CA kept');
		expect(step(job, 'volume')?.detail).toContain('10 GB ext4');
		expect(step(job, 'project')?.detail).toContain('2 resources');
		expect(step(job, 'addresses')?.detail).toContain('IPv6 2001:db8::9');
		expect(step(job, 'dns')?.detail).toContain('already →');
		expect(step(job, 'zone-check')?.detail).toContain('zone SSL unknown');
		expect(step(job, 'origin-pulls')?.detail).toBe('already on');
		expect(step(job, 'tunnel-up')?.detail).toBe('cloudflared connected · 1 link');
		expect(step(job, 'identity')?.detail).toContain('added branch dev · 2 required reviewers');
		expect(job.state).toBe('failed');
		expect(job.left.filter((x) => x.blocking).map((x) => x.text)).toEqual([
			expect.stringContaining('no deploy identity'),
		]);
		expect(step(job, 'ready')?.detail).toContain('1 thing left');
		expect(helperCalls).toContain('/server/certificates-save');
	});

	it('makes a server without a first-boot file, with no volume format, and no tunnel', async () => {
		const { jobs } = setup();
		const started = await create(jobs, draft('staging', { firstBoot: false, volumeGb: 5, volumeFormat: 'none' }));
		const job = await done(jobs, started.id);
		expect(step(job, 'tunnel')?.state).toBe('skipped');
		expect(step(job, 'origin-pulls')?.detail).toBe('no first-boot file');
		expect(step(job, 'tunnel-up')?.detail).toBe('no tunnel');
		expect(step(job, 'private-access')?.detail).toBe('no tunnel');
		expect(step(job, 'github')?.detail).toBe('no first-boot file');
		expect(job.state).toBe('done');
		expect(step(job, 'ready')?.detail).toBe('2 small things left for you');
	});

	it('stops when the droplet stays new, has no address, or the tunnel never connects', async () => {
		const stuck = setup(world(), {
			waits: { activeEvery: 1, activeFor: 0, tunnelEvery: 1, tunnelFor: 0 },
		});
		stuck.jobs.deps.do = {
			...stuck.jobs.deps.do,
			droplet: async () => ({ id: 42, name: 'x', status: 'new', ipv4: null, ipv6: null, privateIp: null }),
		};
		let job = await done(stuck.jobs, (await create(stuck.jobs)).id);
		expect(job.error).toContain('Still new after 0 minutes');
		stuck.jobs.deps.do = {
			...stuck.jobs.deps.do,
			droplet: async () => ({ id: 42, name: 'x', status: 'active', ipv4: null, ipv6: null, privateIp: null }),
		};
		job = await done(stuck.jobs, (await create(stuck.jobs)).id);
		expect(job.error).toContain('no public IPv4 address');
		const offline = setup(world(), { waits: { activeEvery: 1, activeFor: 60_000, tunnelEvery: 1, tunnelFor: 0 } });
		offline.jobs.deps.cf = { ...offline.jobs.deps.cf, tunnelConnections: async () => 0 };
		job = await done(offline.jobs, (await create(offline.jobs)).id);
		expect(job.error).toContain('has not connected yet');
	});

	it('stops on a firewall of the same name, an empty sign-in list and a missing place or domain', async () => {
		const taken = setup();
		taken.jobs.deps.do = { ...taken.jobs.deps.do, firewallsNamed: async () => ['fw-old'] };
		expect((await done(taken.jobs, (await create(taken.jobs)).id)).error).toContain('exists already');
		const nobody = setup();
		const job = await done(nobody.jobs, (await create(nobody.jobs, draft(), 'staging', [])).id);
		expect(job.error).toContain('SSH list is empty');
		const noPlace = setup(world({ repo: { secrets: [] } }));
		expect((await done(noPlace.jobs, (await create(noPlace.jobs)).id)).error).toContain('names no Infisical place');
		const noDomain = setup(world({ environments: [env('staging', ['shop.other.org'])] }));
		expect((await done(noDomain.jobs, (await create(noDomain.jobs)).id)).error).toContain(
			'names no domain in the Cloudflare zone',
		);
	});

	it('leaves alone a host outside every zone, and points DigitalOcean-delegated hosts there', async () => {
		const w = world({
			environments: [
				env('staging', ['staging.example.com', 'shop.example.org', 'lost.example.net', 'm.example.org']),
			],
		});
		const { jobs } = setup(w, {
			nameservers: async (d) => (d === 'example.org' ? ['ns1.digitalocean.com'] : ['ns.other']),
		});
		jobs.deps.do = { ...jobs.deps.do, domains: async () => ['example.org', 'org', 'example.net'] };
		const job = await done(jobs, (await create(jobs)).id);
		expect(step(job, 'dns')?.detail).toContain('lost.example.net: not in a Cloudflare zone or on DigitalOcean DNS');
		expect(step(job, 'dns')?.detail).toContain('shop.example.org already →');
		expect(step(job, 'firewall')?.detail).toContain('are on DigitalOcean DNS');
	});

	it('says when an environment names no domains, and walls nothing without shop or admin hosts', async () => {
		const w = world({ environments: [env('staging', ['api-staging.example.com'])] });
		const { jobs } = setup(w);
		const job = await done(jobs, (await create(jobs, draft('staging', { firstBoot: false }))).id);
		expect(step(job, 'login-wall')?.detail).toBe('no shop or admin host in a Cloudflare zone');
		const none = setup(world({ environments: [env('staging', [])] }));
		const plain = await done(none.jobs, (await create(none.jobs, draft('staging', { firstBoot: false }))).id);
		expect(step(plain, 'dns')?.detail).toBe('the environment names no domains');
		expect(step(plain, 'zone-check')?.detail).toBe('no hosts in a Cloudflare zone');
		// With a first boot, the tunnel goes in the repository's first zone; the certificates then have no host.
		const booted = await done(none.jobs, (await create(none.jobs)).id);
		expect(booted.error).toContain('names no domain in the Cloudflare zone');
	});
});

describe('droplet jobs: the SSH list, the reachable card and deploy tokens', () => {
	it('rewrites the Access rule on every server it can reach', async () => {
		const other = { id: 'docs', cloud: [], edge: [], environments: [] };
		const noKeys = {
			id: 'blog',
			cloud: [{ id: 'do2', vendor: 'digitalocean', keyIds: ['none'] }],
			edge: [{ id: 'cf2', vendor: 'cloudflare', zones: ['example.com'], keyIds: ['none'] }],
			environments: [],
		};
		const w = world();
		const zoneless = {
			...w.repo,
			id: 'zoneless',
			edge: [{ id: 'cf3', vendor: 'cloudflare', zones: [], keyIds: ['cf'] }],
			environments: [env('dev', ['dev.elsewhere.test'])],
		};
		w.project.repositories = [other, noKeys, w.repo, zoneless];
		const { jobs } = setup(w);
		let calls = 0;
		jobs.deps.cf = {
			...jobs.deps.cf,
			accessAppFor: async () => (++calls === 1 ? null : { id: 'app' }),
			serviceTokensNamed: async () => [],
		};
		const hosts = await jobs.updateSshList('acme');
		expect(hosts.length).toBe(2);
	});

	it('checks a server is reachable through Cloudflare, and says what each check found', async () => {
		const { jobs } = setup();
		await expect(jobs.reachable('acme', 'shop', 'local')).rejects.toThrow('does not run on a server');
		const ok = await jobs.reachable('acme', 'shop', 'staging');
		expect(ok.checks.map((c) => [c.key, c.ok])).toEqual([
			['health', false],
			['dns:staging.example.com', true],
			['dns:api-staging.example.com', true],
			['ssl', true],
			['origin-pulls', true],
			['firewall', false],
		]);
		jobs.deps.health = async () => 200;
		jobs.deps.cf = {
			...jobs.deps.cf,
			recordsOf: async (_k, _z, host) => {
				if (host.startsWith('api')) throw new Error('down');
				return [];
			},
			sslRuleOn: async () => {
				throw new Error('down');
			},
			originPullsOff: async () => {
				throw new Error('down');
			},
		};
		jobs.deps.do = {
			...jobs.deps.do,
			firewall443: async () => {
				throw new Error('none');
			},
		};
		jobs.deps.ranges = async () => {
			throw new Error('down');
		};
		const unsure = await jobs.reachable('acme', 'shop', 'production');
		expect(unsure.checks.find((c) => c.key === 'server')?.detail).toBe('no droplet by that name');
		expect(unsure.checks.find((c) => c.key === 'ssl')?.detail).toBe('Cloudflare did not answer');
		jobs.deps.cf = {
			...jobs.deps.cf,
			sslRuleOn: async () => false,
			originPullsOff: async () => ['staging.example.com'],
		};
		jobs.deps.do = { ...jobs.deps.do, firewall443: async () => ['0.0.0.0/0'] };
		const open = await jobs.reachable('acme', 'shop', 'staging');
		expect(open.checks.find((c) => c.key === 'ssl')?.detail).toBe('missing');
		expect(open.checks.find((c) => c.key === 'origin-pulls')?.fix).toBe('origin-pulls');
		expect(open.checks.find((c) => c.key === 'firewall')?.detail).toBe('443 open to everyone');
		jobs.deps.ranges = async () => [' 173.245.48.0/20'];
		jobs.deps.do = { ...jobs.deps.do, firewall443: async () => ['173.245.48.0/20'] };
		const all = await jobs.reachable('acme', 'shop', 'staging');
		expect(all.checks.find((c) => c.key === 'firewall')?.detail).toBe('all 1 ranges');
		jobs.deps.ranges = async () => ['173.245.48.0/20', '103.21.244.0/22'];
		const short = await jobs.reachable('acme', 'shop', 'staging');
		expect(short.checks.find((c) => c.key === 'firewall')?.detail).toBe(
			'Cloudflare added 1 range the firewall lacks: 103.21.244.0/22',
		);
		const w = world({ environments: [env('staging', [])] });
		const bare = setup(w);
		expect((await bare.jobs.reachable('acme', 'shop', 'staging')).checks.map((c) => c.key)).toEqual(['firewall']);
	});

	it('turns origin pulls on again, and says when it cannot', async () => {
		const { jobs, audit } = setup();
		await jobs.fixReachable('acme', 'shop', 'staging', 'origin-pulls');
		expect(audit).toHaveBeenCalledWith('acme', 'origin-pulls-on', expect.any(String));
		jobs.deps.cf = { ...jobs.deps.cf, originPullsCert: async () => null };
		await expect(jobs.fixReachable('acme', 'shop', 'staging', 'origin-pulls')).rejects.toThrow(
			'No origin-pulls certificate',
		);
		const w = world({ environments: [env('staging', ['shop.other.org'])] });
		await expect(setup(w).jobs.fixReachable('acme', 'shop', 'staging', 'origin-pulls')).rejects.toThrow(
			'No hosts in a Cloudflare zone',
		);
		await expect(jobs.fixReachable('acme', 'shop', 'staging', 'other' as 'origin-pulls')).resolves.toBeTruthy();
	});

	it('lists each server’s deploy token, leaving out what Cloudflare cannot answer for', async () => {
		const w = world();
		const zoneless = {
			...w.repo,
			id: 'zoneless',
			edge: [{ id: 'cf3', vendor: 'cloudflare', zones: [], keyIds: ['cf'] }],
			environments: [env('dev', ['dev.elsewhere.test'])],
		};
		w.project.repositories = [
			{ id: 'docs', cloud: [], edge: [], environments: [] },
			{ ...w.repo, id: 'nokey', cloud: [{ id: 'do9', vendor: 'digitalocean', keyIds: [] }] },
			w.repo,
			zoneless,
		];
		const { jobs } = setup(w);
		let n = 0;
		jobs.deps.cf = {
			...jobs.deps.cf,
			serviceTokenOf: async () => {
				n += 1;
				if (n === 1) throw new Error('down');
				return n === 2 ? null : { id: 'st', expiresAt: '2027-01-01T00:00:00Z' };
			},
		};
		const tokens = await jobs.deployTokens('acme');
		expect(tokens.map((t) => t.environment)).toEqual(['qa']);
	});
});

describe('droplet jobs: finish setup, renew and destroy', () => {
	it('refuses a fix elsewhere, for an environment without GitHub, or with no server', async () => {
		const { jobs } = setup();
		await expect(jobs.startFix('acme', 'shop', 'do1', { environment: 'local', kind: 'renew' })).rejects.toThrow(
			'is not an environment',
		);
		await expect(jobs.startFix('acme', 'shop', 'do1', { environment: 'qa', kind: 'renew' })).rejects.toThrow(
			'has no GitHub environment',
		);
		await expect(
			jobs.startFix('acme', 'shop', 'do1', { environment: 'production', kind: 'renew' }),
		).rejects.toThrow('No server named acme-production');
	});

	it('stops a fix without a zone or a deploy token, and finishes one with an API host', async () => {
		const zoneless = setup(
			world({
				repo: { edge: [{ id: 'cf1', vendor: 'cloudflare', zones: [], keyIds: ['cf'] }] },
				environments: [env('staging', [])],
			}),
		);
		let job = await done(
			zoneless.jobs,
			(await zoneless.jobs.startFix('acme', 'shop', 'do1', { environment: 'staging', kind: 'renew' })).id,
		);
		expect(job.error).toBe('The repository names no Cloudflare zone.');
		const tokenless = setup();
		tokenless.jobs.deps.cf = { ...tokenless.jobs.deps.cf, serviceTokenOf: async () => null };
		job = await done(
			tokenless.jobs,
			(await tokenless.jobs.startFix('acme', 'shop', 'do1', { environment: 'staging', kind: 'renew' })).id,
		);
		expect(job.error).toContain('has no deploy token');
		const finish = setup();
		finish.jobs.deps.helper = (async (path: string) =>
			path === '/github/environment-rules'
				? { reviewers: 1, set: [] }
				: path === '/server/deploy-identity'
					? { identityId: 'id-1' }
					: path === '/server/known-hosts'
						? { line: 'host ssh-ed25519 AAAA' }
						: { environmentMade: false, set: ['X'] }) as JobDeps['helper'];
		job = await done(
			finish.jobs,
			(await finish.jobs.startFix('acme', 'shop', 'do1', { environment: 'staging', kind: 'finish' })).id,
		);
		expect(job.state).toBe('done');
		expect(step(job, 'identity')?.detail).toContain('1 required reviewer');
		expect(step(job, 'ready')?.detail).toBe('nothing left');
	});

	it('destroys a server with no address and no zone, and one whose tunnel is already gone', async () => {
		const w = world({ repo: { edge: [{ id: 'cf1', vendor: 'cloudflare', zones: [], keyIds: ['cf'] }] } });
		const bare = setup(w);
		let job = await done(
			bare.jobs,
			(await bare.jobs.startDestroy('acme', 'shop', 'do1', { confirm: 'acme-qa', dropletId: 44 })).id,
		);
		expect(step(job, 'dns')?.detail).toContain('no address');
		expect(step(job, 'origin-pulls')?.detail).toBe('no hosts');
		expect(step(job, 'access')?.detail).toBe('no zone');
		expect(step(job, 'tunnel')?.detail).toBe('no Cloudflare zone, so no tunnel');
		const gone = setup();
		gone.jobs.deps.cf = {
			...gone.jobs.deps.cf,
			tunnelNamed: async () => null,
			accessAppFor: async () => null,
			unpointHost: async () => 2,
			serviceTokensNamed: async () => ['t'],
		};
		gone.jobs.deps.do = { ...gone.jobs.deps.do, firewallsNamed: async () => ['fw'] };
		job = await done(
			gone.jobs,
			(await gone.jobs.startDestroy('acme', 'shop', 'do1', { confirm: 'acme-staging', dropletId: 42 })).id,
		);
		expect(step(job, 'tunnel')?.detail).toBe('none by that name');
		expect(step(job, 'access')?.detail).toBe('no application · 2 tokens');
		expect(step(job, 'firewall')?.detail).toBe('acme-staging deleted');
		const failing = setup();
		failing.jobs.deps.do = {
			...failing.jobs.deps.do,
			deleteDroplet: async () => {
				throw 'refused';
			},
		};
		job = await done(
			failing.jobs,
			(await failing.jobs.startDestroy('acme', 'shop', 'do1', { confirm: 'acme-staging', dropletId: 42 })).id,
		);
		expect(job.error).toBe('Unexpected: refused');
		await expect(failing.jobs.startDestroy('acme', 'shop', 'do1', { confirm: 'x', dropletId: 99 })).rejects.toThrow(
			'has that id',
		);
	});

	it('names a vendor refusal with its own words, and an unexpected error as such', async () => {
		const { jobs } = setup();
		jobs.deps.do = {
			...jobs.deps.do,
			createDroplet: async () => {
				throw Object.assign(new Error('Bad request'), { status: 400 });
			},
		};
		let job = await done(jobs, (await create(jobs)).id);
		expect(job.error).toBe('Bad request');
		jobs.deps.do = {
			...jobs.deps.do,
			createDroplet: async () => {
				throw new Error('boom');
			},
		};
		job = await done(jobs, (await create(jobs)).id);
		expect(job.error).toBe('Unexpected: boom');
	});
});

describe('droplet jobs: the real helpers it is built with', () => {
	it('waits, reads nameservers, probes a port, reads a status and asks the runner what Infisical has', async () => {
		const call = vi.fn(async () => ({
			folders: [
				{
					rows: [
						{ name: 'origin.pem', state: 'set' },
						{ name: 'x', state: 'set' },
					],
				},
				{},
			],
		}));
		const jobs = new DropletJobs({} as ProjectsService, {} as ConsoleStore, { call } as unknown as RunnerClient);
		await jobs.deps.sleep(0);
		expect(await jobs.deps.nameservers('example.org')).toEqual(['ns1.digitalocean.com']);
		expect(await jobs.deps.nameservers('broken.example')).toEqual([]);
		const server = createServer((socket) => socket.end());
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const port = (server.address() as { port: number }).port;
		expect(await jobs.deps.probe('127.0.0.1', port)).toBe(true);
		await new Promise<void>((resolve) => server.close(() => resolve()));
		expect(await jobs.deps.probe('127.0.0.1', port)).toBe(false);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ status: 503 })),
		);
		expect(await jobs.deps.health('https://api.example.test/health/live')).toBe(503);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Promise.reject(new Error('offline'))),
		);
		expect(await jobs.deps.health('https://api.example.test/health/live')).toBe(0);
		expect(
			await jobs.deps.infisicalSet({ project: 'p', environment: 'e' }, '/infrastructure', ['origin.pem']),
		).toEqual(new Set(['origin.pem']));
		call.mockResolvedValueOnce({} as never);
		expect(
			await jobs.deps.infisicalSet({ project: 'p', environment: 'e' }, '/infrastructure', ['origin.pem']),
		).toEqual(new Set());
		const catalogRead = vi.spyOn(digitalOceanAdapter, 'catalog').mockResolvedValue(catalog);
		expect(await jobs.deps.catalog('key')).toBe(catalog);
		expect(catalogRead).toHaveBeenCalledWith('key');
		await jobs.deps.helper('/x', {});
		expect(call).toHaveBeenLastCalledWith('POST', '/x', {}, 240_000);
	});
});

describe('droplet jobs: the rarer paths', () => {
	interface Inside {
		step(job: unknown, key: string, work: () => Promise<string>): Promise<void>;
		skip(job: unknown, key: string, why: string): void;
		finish(job: unknown, error: string | null): void;
		portsStep(job: unknown, c: { left: unknown[] }): Promise<void>;
		reachSteps(job: unknown, o: unknown, c: unknown): Promise<void>;
	}
	const bare = () => ({ steps: [{ key: 'a', state: 'queued', detail: '', ms: null }], ipv4: null, state: 'running' });

	it('ignores a step it does not list, skips nothing it does not have, and marks untouched steps skipped', async () => {
		const inside = setup().jobs as unknown as Inside;
		const job = bare();
		const work = vi.fn(async () => 'x');
		await inside.step(job, 'missing', work);
		expect(work).not.toHaveBeenCalled();
		inside.skip(job, 'missing', 'why');
		inside.finish(job, null);
		expect(job.steps[0]?.state).toBe('skipped');
		await inside.portsStep({ ...bare(), steps: [{ key: 'ports', state: 'queued' }] }, { left: [] });
		const tunnelJob = { ...bare(), steps: [{ key: 'tunnel', state: 'queued', detail: '', ms: null }] };
		await expect(
			inside.reachSteps(tunnelJob, { d: draft(), keys: { zones: [], cfKey: 'k', doKey: 'k' }, domains: [] }, {}),
		).rejects.toThrow('names no Cloudflare zone');
	});

	it('creates for an environment with its own branch, no private address, and several people and ports', async () => {
		const w = world({
			environments: [
				env('staging', ['staging.example.com'], { branch: 'release' }),
				env('development', ['dev.example.com', 'lost.nowhere.test'], { branch: '' }),
				env('qa', ['qa.example.com']),
			],
		});
		const { jobs } = setup(w, { probe: async (_h, port) => port === 22 || port === 80 });
		let made = 0;
		jobs.deps.do = {
			...jobs.deps.do,
			droplet: async () => ({
				id: 42,
				name: 'x',
				status: 'active',
				ipv4: '203.0.113.9',
				ipv6: null,
				privateIp: ++made > 1 ? '10.0.0.3' : null,
			}),
			domains: async () => ['example.org'],
		};
		jobs.deps.infisicalSet = async () =>
			new Set(['origin.pem', 'origin.key', 'origin-ca.pem', 'cloudflare-client-ca.pem']);
		const emails = ['a@example.com', 'b@example.com'];
		let job = await done(jobs, (await create(jobs, draft('staging', { projectId: 'p1' }), 'staging', emails)).id);
		expect(step(job, 'project')?.detail).toContain('1 resource');
		expect(step(job, 'addresses')?.detail).toBe('IPv4 203.0.113.9');
		expect(job.left.some((x) => x.text.includes('close them'))).toBe(true);
		job = await done(jobs, (await create(jobs, draft('development'), 'development', emails)).id);
		expect(step(job, 'login-wall')?.detail).toContain('2 people');
		expect(step(job, 'dns')?.detail).toContain('lost.nowhere.test: not in a Cloudflare zone');
		job = await done(jobs, (await create(jobs, draft('qa', { firstBoot: false }))).id);
		// Ports 22 and 80 answer from outside, so it does not finish.
		expect(job.error).toContain('Not finished');
	});

	it('destroys a droplet outside the project’s naming, and one whose tunnel and Access app are there', async () => {
		const { jobs } = setup();
		jobs.deps.do = {
			...jobs.deps.do,
			dropletsTagged: async () => [
				{ id: 50, name: 'stray', status: 'active', ipv4: '203.0.113.50', ipv6: null, privateIp: null },
			],
		};
		let job = await done(
			jobs,
			(await jobs.startDestroy('acme', 'shop', 'do1', { confirm: 'stray', dropletId: 50 })).id,
		);
		expect(job.environment).toBe('stray');
		expect(step(job, 'access')?.detail).toBe('no zone');
		expect(step(job, 'tunnel')?.detail).toBe('stray and its SSH host name deleted');
		const full = setup();
		let unpointed = 0;
		full.jobs.deps.cf = {
			...full.jobs.deps.cf,
			serviceTokensNamed: async (_k, _a, name) => (name.endsWith('deploy') ? ['t'] : []),
			unpointHost: async () => (unpointed++ === 0 ? 1 : 0),
		};
		job = await done(
			full.jobs,
			(await full.jobs.startDestroy('acme', 'shop', 'do1', { confirm: 'acme-staging', dropletId: 42 })).id,
		);
		expect(step(job, 'access')?.detail).toBe('application · 1 token');
		expect(step(job, 'dns')?.detail).toContain('1 record that pointed');
	});

	it('reads records that are not proxied, a card for hosts outside the zone, and fixes with no Infisical place', async () => {
		const { jobs } = setup();
		jobs.deps.cf = {
			...jobs.deps.cf,
			recordsOf: async () => [{ type: 'A', content: '198.51.100.1', proxied: false }],
		};
		const card = await jobs.reachable('acme', 'shop', 'staging');
		expect(card.checks.find((c) => c.key === 'dns:staging.example.com')?.detail).toBe('A 198.51.100.1 DNS only');
		const outside = setup(world({ environments: [env('staging', ['shop.other.org'])] }));
		expect((await outside.jobs.reachable('acme', 'shop', 'staging')).checks.map((c) => c.key)).toEqual([
			'health',
			'firewall',
		]);
		const placeless = setup(
			world({ repo: { secrets: [] }, environments: [env('staging', ['staging.example.com'])] }),
		);
		const job = await done(
			placeless.jobs,
			(await placeless.jobs.startFix('acme', 'shop', 'do1', { environment: 'staging', kind: 'finish' })).id,
		);
		expect(job.left.some((x) => x.text.includes('no deploy identity'))).toBe(true);
		const w = world({ environments: [env('staging', [])] });
		w.project.repositories = [w.repo];
		expect(await setup(w).jobs.deployTokens('acme')).toHaveLength(1);
		expect(await setup(w).jobs.updateSshList('acme')).toHaveLength(1);
	});
});
