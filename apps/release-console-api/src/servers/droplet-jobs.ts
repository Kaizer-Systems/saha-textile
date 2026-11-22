import { randomBytes } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
	CREATE_STEPS,
	DESTROY_STEPS,
	type DoCatalog,
	type DropletDraft,
	type DropletJob,
	type DropletJobStep,
	type KeyKind,
	type Project,
	type Repository,
	type StartDropletCreate,
	dropletCost,
	dropletRequestOf,
	secretsSourceOf,
	serverTargetOf,
	sshHostOf,
} from '@saha-textile/release-console-contracts';

import { ProjectsService } from '../projects/projects.service.js';
import { RunnerClient } from '../runner/runner-client.js';
import { ConsoleStore } from '../store/console-store.js';
import { cfWrites, zoneFor } from '../vendors/cf-writes.js';
import { digitalOceanAdapter } from '../vendors/digitalocean.adapter.js';
import { cloudflareRanges, doWrites, firewallBody } from '../vendors/do-writes.js';
import { VendorError } from '../vendors/http.js';

/** The four certificate files a server's /infrastructure holds (render.mjs, deploy.sh). */
const CERT_FILES = ['origin.pem', 'origin.key', 'origin-ca.pem', 'cloudflare-client-ca.pem'];

/** What a job calls; the tests pass made-up vendors and a made-up helper. */
export interface JobDeps {
	catalog: (key: string) => Promise<DoCatalog>;
	do: typeof doWrites;
	cf: typeof cfWrites;
	ranges: () => Promise<string[]>;
	/** The helper on the console's machine (first-boot file, certificates, GitHub, host key). */
	helper: <T>(path: string, body: Record<string, unknown>) => Promise<T>;
	/** Which of `names` are set in an Infisical place's folder (names only). */
	infisicalSet: (
		place: { project: string; environment: string },
		folder: string,
		names: string[],
	) => Promise<Set<string>>;
	sleep: (ms: number) => Promise<void>;
	waits: { activeEvery: number; activeFor: number; tunnelEvery: number; tunnelFor: number };
}

interface Keys {
	doKey: string;
	cfKey: string;
	zones: string[];
}

/** What the later steps need from the earlier ones; never shown, never stored. */
interface Carry {
	zone: { id: string; name: string; accountId: string } | null;
	tunnel: { id: string; accountId: string } | null;
	tunnelToken: string;
	sshHost: string;
	token: { clientId: string; clientSecret: string } | null;
	aop: { certId: string } | null;
	userData: string;
	volumeId: string | null;
}

interface CreateInput {
	d: DropletDraft;
	domains: string[];
	keys: Keys;
	password: string;
	emails: string[];
	projectId: string;
	repository: string;
	target: string;
	place: { project: string; environment: string } | null;
}

class Stop extends Error {}

/**
 * DigitalOcean › Droplets: creates a server step by step after the PIN (brief v7, Creating; plan §5
 * and §9; owner 21 Nov), and destroys a staging or development one in reverse. Jobs live in memory
 * while the console runs; the audit log keeps who did what. Production is never destroyed here.
 */
@Injectable()
export class DropletJobs {
	private readonly jobs = new Map<string, DropletJob & { projectId: string; repoId: string }>();
	deps: JobDeps;

	constructor(
		private readonly projects: ProjectsService,
		private readonly store: ConsoleStore,
		runner: RunnerClient,
	) {
		this.deps = {
			catalog: (key) => digitalOceanAdapter.catalog(key),
			do: doWrites,
			cf: cfWrites,
			ranges: cloudflareRanges,
			helper: (path, body) => runner.call('POST', path, body, 240_000),
			infisicalSet: async (place, folder, names) => {
				const q = new URLSearchParams({
					project: place.project,
					environment: place.environment,
					folder,
					fresh: '1',
				});
				const answer = await runner.call<{ folders?: { rows?: { name: string; state: string }[] }[] }>(
					'GET',
					`/secrets?${q.toString()}`,
					undefined,
					120_000,
				);
				const rows = (answer.folders ?? []).flatMap((f) => f.rows ?? []);
				return new Set(rows.filter((r) => names.includes(r.name) && r.state === 'set').map((r) => r.name));
			},
			sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
			waits: { activeEvery: 5_000, activeFor: 300_000, tunnelEvery: 10_000, tunnelFor: 900_000 },
		};
	}

	list(projectId: string, repoId: string): DropletJob[] {
		return [...this.jobs.values()]
			.filter((j) => j.projectId === projectId && j.repoId === repoId)
			.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
			.map((j) => this.view(j));
	}

	get(id: string): DropletJob {
		const j = this.jobs.get(id);
		if (!j) throw new NotFoundException('No such job: the console may have restarted since.');
		return this.view(j);
	}

	/** The write keys for this repository's DigitalOcean and Cloudflare slots. */
	private async keys(project: Project, repo: Repository, slotId: string): Promise<Keys> {
		const slot = repo.cloud.find((c) => c.id === slotId && c.vendor === 'digitalocean');
		if (!slot) throw new BadRequestException('This repository has no such DigitalOcean slot.');
		const value = async (keyIds: string[], kind: KeyKind) => {
			const ref = project.keys.find((k) => keyIds.includes(k.id) && k.kind === kind);
			return ref ? this.projects.valueOf(ref) : null;
		};
		const doKey = await value(slot.keyIds, 'do-change');
		if (!doKey)
			throw new BadRequestException(
				'Creating needs the DigitalOcean full-access key: link it on the Connections screen.',
			);
		const edge = repo.edge.find((e) => e.vendor === 'cloudflare');
		const cfKey = edge ? await value(edge.keyIds, 'cf-change') : null;
		if (!edge || !cfKey)
			throw new BadRequestException(
				'Creating needs the Cloudflare full-access key for the tunnel, Access and DNS: link it on the Connections screen.',
			);
		return { doKey, cfKey, zones: edge.zones };
	}

	async startCreate(
		projectId: string,
		repoId: string,
		slotId: string,
		input: StartDropletCreate,
	): Promise<DropletJob> {
		const { project, repo } = this.projects.repository(projectId, repoId);
		const d = input.draft;
		const env = repo.environments.find((e) => e.name === d.environment);
		if (!env || env.cloudId !== slotId)
			throw new BadRequestException(`${d.environment} is not an environment on this DigitalOcean account.`);
		if (input.confirm.trim() !== d.environment) throw new BadRequestException(`Type ${d.environment} to confirm.`);
		if (d.quantity !== 1 || d.names.length !== 1)
			throw new BadRequestException('The console creates one server per environment at a time.');
		if (!d.sshKeyIds.length) throw new BadRequestException('Pick at least one SSH key.');
		const target = serverTargetOf(env.name);
		if (d.firstBoot && !target)
			throw new BadRequestException(
				`${env.label} is neither development, staging nor production, so deploy.yml has no place for it.`,
			);
		const keys = await this.keys(project, repo, slotId);
		if (d.firstBoot) {
			// Checked before anything is made: SSH goes through Cloudflare Access (plan §5).
			const zoneName = zoneFor(env.domains[0] ?? '', keys.zones) ?? keys.zones[0];
			if (!zoneName) throw new BadRequestException('The repository names no Cloudflare zone for the tunnel.');
			const zone = await this.deps.cf.zone(keys.cfKey, zoneName);
			if (!(await this.deps.cf.accessEnabled(keys.cfKey, zone.accountId)))
				throw new BadRequestException(
					'Cloudflare Zero Trust is not switched on for this account, and the server’s SSH goes through it. In Cloudflare, open Zero Trust, choose a team name and the Free plan, then create again.',
				);
		}
		const size = (await this.deps.catalog(keys.doKey)).sizes.find((s) => s.slug === d.size);
		const cost = dropletCost(d, size);
		this.projects.setSshEmails(projectId, input.sshEmails);
		const job = this.newJob(projectId, repoId, 'create', d.environment, d.names[0] ?? d.environment, CREATE_STEPS);
		job.monthly = cost.total;
		job.hourly = cost.hourly;
		this.store.audit(
			projectId,
			'droplet-create',
			`${job.name}: ${d.size} in ${d.region} (${d.image}), $${cost.total.toFixed(2)} a month, started with the PIN`,
		);
		const source = secretsSourceOf(repo, env.name);
		void this.runCreate(job, {
			d,
			domains: env.domains,
			keys,
			password: input.adminPassword,
			emails: input.sshEmails,
			projectId,
			repository: repo.sourceCode.repository,
			target: target ?? '',
			place: source.kind === 'infisical' ? source.place : null,
		});
		return this.view(job);
	}

	async startDestroy(
		projectId: string,
		repoId: string,
		slotId: string,
		input: { confirm: string; dropletId: number },
	): Promise<DropletJob> {
		const { project, repo } = this.projects.repository(projectId, repoId);
		const keys = await this.keys(project, repo, slotId);
		const servers = await this.deps.do.dropletsTagged(keys.doKey, projectId);
		const target = servers.find((s) => s.id === input.dropletId);
		if (!target) throw new BadRequestException(`No droplet tagged ${projectId} has that id.`);
		if (input.confirm.trim() !== target.name) throw new BadRequestException(`Type ${target.name} to confirm.`);
		const envName = target.name.startsWith(`${projectId}-`) ? target.name.slice(projectId.length + 1) : '';
		if (/prod/i.test(envName) || /prod/i.test(target.name))
			throw new BadRequestException('Production is never destroyed from the console.');
		const env = repo.environments.find((e) => e.name === envName);
		const job = this.newJob(projectId, repoId, 'destroy', envName || target.name, target.name, DESTROY_STEPS);
		job.dropletId = target.id;
		job.ipv4 = target.ipv4;
		this.store.audit(projectId, 'droplet-destroy', `${target.name} (${target.id}): destroy started with the PIN`);
		void this.runDestroy(job, target, envName, env?.domains ?? [], keys, projectId);
		return this.view(job);
	}

	/**
	 * Rewrites the Access rule on every server of the project after its SSH list changed; the deploy
	 * job's token rule is kept. Answers which SSH hosts were updated.
	 */
	async updateSshList(projectId: string): Promise<string[]> {
		const project = this.projects.project(projectId);
		const done: string[] = [];
		for (const repo of project.repositories) {
			const slot = repo.cloud.find((c) => c.vendor === 'digitalocean');
			if (!slot || !repo.edge.some((e) => e.vendor === 'cloudflare')) continue;
			const keys = await this.keys(project, repo, slot.id).catch(() => null);
			if (!keys) continue;
			for (const env of repo.environments.filter((e) => e.cloudId === slot.id)) {
				const zoneName = zoneFor(env.domains[0] ?? '', keys.zones) ?? keys.zones[0];
				if (!zoneName) continue;
				const zone = await this.deps.cf.zone(keys.cfKey, zoneName);
				const host = sshHostOf(env.name, zone.name);
				if (!(await this.deps.cf.accessAppFor(keys.cfKey, zone.accountId, host))) continue;
				const name = `${projectId}-${env.name}`;
				const [tokenId] = await this.deps.cf.serviceTokensNamed(keys.cfKey, zone.accountId, `${name} deploy`);
				await this.deps.cf.emailCodeSignIn(keys.cfKey, zone.accountId);
				await this.deps.cf.accessApp(keys.cfKey, zone.accountId, {
					name: `${name} SSH`,
					host,
					tokenId: tokenId ?? null,
					emails: project.sshEmails,
				});
				done.push(host);
				await this.deps.cf.warpEnrollment(keys.cfKey, zone.accountId, project.sshEmails);
			}
		}
		return done;
	}

	// ---------------------------------------------------------------- create

	private async runCreate(job: DropletJob, o: CreateInput): Promise<void> {
		const { d } = o;
		const name = job.name;
		const c: Carry = {
			zone: null,
			tunnel: null,
			tunnelToken: '',
			sshHost: '',
			token: null,
			aop: null,
			userData: '',
			volumeId: null,
		};
		try {
			if (d.firstBoot) await this.reachSteps(job, o, c);
			else
				for (const k of ['tunnel', 'ssh-host', 'access', 'certificates', 'first-boot'])
					this.skip(job, k, 'no first-boot file');
			await this.serverSteps(job, o, c);
			await this.afterSteps(job, o, c);
			this.finish(job, null);
			this.store.audit(o.projectId, 'droplet-created', `${name} (${job.dropletId}) ready · ${job.ipv4}`);
		} catch (err) {
			const message = this.reason(err);
			this.finish(job, message);
			this.store.audit(o.projectId, 'droplet-create-failed', `${name}: ${message}`);
		}
	}

	/** Tunnel, SSH host, Access, certificates and the first-boot file: everything before the droplet. */
	private async reachSteps(job: DropletJob, o: CreateInput, c: Carry): Promise<void> {
		const { deps } = this;
		const { d, keys } = o;
		const name = job.name;
		const zoneName = zoneFor(o.domains[0] ?? '', keys.zones) ?? keys.zones[0] ?? '';
		const webHosts = o.domains.filter((h) => zoneFor(h, keys.zones));
		await this.step(job, 'tunnel', async () => {
			if (!zoneName) throw new Stop('The repository names no Cloudflare zone.');
			const zone = await deps.cf.zone(keys.cfKey, zoneName);
			c.zone = zone;
			const found = await deps.cf.tunnelNamed(keys.cfKey, zone.accountId, name);
			const t = found ?? (await deps.cf.createTunnel(keys.cfKey, zone.accountId, name));
			c.tunnel = { id: t.id, accountId: zone.accountId };
			c.tunnelToken = await deps.cf.tunnelToken(keys.cfKey, zone.accountId, t.id);
			return `${found ? 'kept' : 'created'} tunnel ${name} · its token read for the first-boot file`;
		});
		const zone = c.zone as unknown as NonNullable<Carry['zone']>;
		const tunnel = c.tunnel as unknown as NonNullable<Carry['tunnel']>;
		await this.step(job, 'ssh-host', async () => {
			c.sshHost = sshHostOf(d.environment, zone.name);
			job.sshHost = c.sshHost;
			await deps.cf.routeSsh(keys.cfKey, tunnel.accountId, tunnel.id, c.sshHost);
			const r = await deps.cf.pointTunnel(keys.cfKey, zone.id, c.sshHost, tunnel.id);
			return `${c.sshHost} → ssh://localhost:22 in the tunnel · DNS ${r === 'created' ? 'added' : 'already there'}`;
		});
		await this.step(job, 'access', async () => {
			const tokenName = `${name} deploy`;
			for (const old of await deps.cf.serviceTokensNamed(keys.cfKey, zone.accountId, tokenName))
				await deps.cf.deleteServiceToken(keys.cfKey, zone.accountId, old);
			const t = await deps.cf.serviceToken(keys.cfKey, zone.accountId, tokenName);
			c.token = { clientId: t.clientId, clientSecret: t.clientSecret };
			const codeAdded = await deps.cf.emailCodeSignIn(keys.cfKey, zone.accountId);
			await deps.cf.accessApp(keys.cfKey, zone.accountId, {
				name: `${name} SSH`,
				host: c.sshHost,
				tokenId: t.id,
				emails: o.emails,
			});
			const people = `${o.emails.length} ${o.emails.length === 1 ? 'person' : 'people'} on the list`;
			return `${c.sshHost}: the deploy job's new service token and ${people}${codeAdded ? ' · sign-in by email code added' : ''}`;
		});
		await this.step(job, 'certificates', async () => {
			if (!o.place)
				throw new Stop(`${d.environment} names no Infisical place, so its certificates have nowhere to live.`);
			if (!webHosts.length) throw new Stop(`${d.environment} names no domain in the Cloudflare zone.`);
			const have = await deps.infisicalSet(o.place, '/infrastructure', CERT_FILES);
			const said: string[] = [];
			const save: Record<string, unknown> = { project: o.projectId, environment: d.environment, place: o.place };
			if (have.has('origin.pem') && have.has('origin.key')) said.push('Origin Certificate kept from Infisical');
			else {
				const { csr } = await deps.helper<{ csr: string }>('/server/origin-csr', {
					project: o.projectId,
					environment: d.environment,
					hosts: webHosts,
				});
				save['certificate'] = await deps.cf.originCertificate(keys.cfKey, csr, webHosts);
				said.push(`Origin Certificate for ${webHosts.join(', ')} signed (15 years), key made on this machine`);
			}
			if (have.has('cloudflare-client-ca.pem') && (await deps.cf.originPullsOn(keys.cfKey, zone.id, webHosts)))
				said.push('origin-pulls CA kept');
			else {
				const pair = await deps.helper<{ caCertificate: string; clientCertificate: string; clientKey: string }>(
					'/server/aop-pair',
					{ project: o.projectId, environment: d.environment },
				);
				c.aop = {
					certId: await deps.cf.uploadOriginPulls(
						keys.cfKey,
						zone.id,
						pair.clientCertificate,
						pair.clientKey,
					),
				};
				save['aopCa'] = pair.caCertificate;
				said.push('our own origin-pulls CA made and its client certificate given to Cloudflare');
			}
			if (!have.has('origin-ca.pem')) save['originCa'] = true;
			if ('certificate' in save || 'aopCa' in save || 'originCa' in save) {
				const r = await deps.helper<{ saved: string[] }>('/server/certificates-save', save);
				said.push(
					`${r.saved.join(', ')} saved to ${o.place.project} · ${o.place.environment} · /infrastructure`,
				);
			}
			return said.join(' · ');
		});
		await this.step(job, 'first-boot', async () => {
			const adminKey = await deps.do.publicKey(keys.doKey, d.sshKeyIds[0] ?? 0);
			const out = await deps.helper<{ userData: string }>('/server/first-boot', {
				project: o.projectId,
				environment: d.environment,
				adminKey,
				password: o.password,
				tunnelToken: c.tunnelToken,
			});
			c.userData = out.userData;
			const kb = Math.round(Buffer.byteLength(c.userData) / 1024);
			return `admin key, deploy key (its private half stays on this machine), password hash and tunnel token filled in · ${kb} KB`;
		});
	}

	/** Volume, droplet, addresses, project, firewall and DNS. */
	private async serverSteps(job: DropletJob, o: CreateInput, c: Carry): Promise<void> {
		const { deps } = this;
		const { d, keys } = o;
		const name = job.name;
		if (d.volumeGb > 0) {
			await this.step(job, 'volume', async () => {
				c.volumeId = await deps.do.createVolume(keys.doKey, {
					size_gigabytes: d.volumeGb,
					name: `${name}-data`,
					region: d.region,
					...(d.volumeFormat === 'none' ? {} : { filesystem_type: d.volumeFormat }),
					tags: d.tags,
				});
				return `POST /v2/volumes · ${d.volumeGb} GB ${d.volumeFormat}`;
			});
		} else this.skip(job, 'volume', 'none asked for');

		await this.step(job, 'droplet', async () => {
			const body = dropletRequestOf(d);
			if (c.userData) body['user_data'] = c.userData;
			else delete body['user_data'];
			if (c.volumeId) body['volumes'] = [c.volumeId];
			else delete body['volumes'];
			job.dropletId = await deps.do.createDroplet(keys.doKey, body);
			return `POST /v2/droplets → droplet ${job.dropletId}`;
		});

		const id = job.dropletId ?? 0;
		await this.step(job, 'active', async () => {
			const until = Date.now() + deps.waits.activeFor;
			for (;;) {
				const s = await deps.do.droplet(keys.doKey, id);
				if (s.status === 'active') {
					job.ipv4 = s.ipv4;
					job.ipv6 = s.ipv6;
					job.privateIp = s.privateIp;
					return 'status active';
				}
				if (Date.now() > until)
					throw new Stop(`Still ${s.status} after ${deps.waits.activeFor / 60_000} minutes.`);
				await deps.sleep(deps.waits.activeEvery);
			}
		});

		await this.step(job, 'addresses', async () => {
			if (!job.ipv4) throw new Stop('DigitalOcean gave the droplet no public IPv4 address.');
			return [
				`IPv4 ${job.ipv4}`,
				job.ipv6 ? `IPv6 ${job.ipv6}` : '',
				job.privateIp ? `private ${job.privateIp}` : '',
			]
				.filter(Boolean)
				.join(' · ');
		});

		if (d.projectId) {
			const onDo = d.projectId;
			await this.step(job, 'project', async () => {
				const urns = [`do:droplet:${id}`, ...(c.volumeId ? [`do:volume:${c.volumeId}`] : [])];
				await deps.do.assign(keys.doKey, onDo, urns);
				return `POST /v2/projects/…/resources · ${urns.length} resource${urns.length === 1 ? '' : 's'}`;
			});
		} else this.skip(job, 'project', 'the account default');

		await this.step(job, 'firewall', async () => {
			const existing = await deps.do.firewallsNamed(keys.doKey, name);
			if (existing.length) throw new Stop(`A Cloud Firewall named ${name} exists already; remove it first.`);
			await deps.do.createFirewall(keys.doKey, firewallBody(name, id, await deps.ranges(), []));
			return `${name} · inbound 443 from Cloudflare's ranges only · all outbound`;
		});

		if (/prod/i.test(d.environment)) this.skip(job, 'dns', 'production: the DNS switch is its own step');
		else {
			await this.step(job, 'dns', async () => {
				const done: string[] = [];
				for (const host of o.domains) {
					const zone = zoneFor(host, keys.zones);
					if (!zone) {
						done.push(`${host}: not in a Cloudflare zone of this repository, left alone`);
						continue;
					}
					const z = await deps.cf.zone(keys.cfKey, zone);
					const r = await deps.cf.pointHost(keys.cfKey, z.id, host, job.ipv4 ?? '');
					done.push(`${host} ${r === 'created' ? '→' : 'already →'} ${job.ipv4} (proxied)`);
				}
				return done.join(' · ') || 'the environment names no domains';
			});
		}
	}

	/** Origin pulls, the tunnel connecting, the GitHub environment and the host key. */
	private async afterSteps(job: DropletJob, o: CreateInput, c: Carry): Promise<void> {
		const { deps } = this;
		const { keys } = o;
		const webHosts = o.domains.filter((h) => zoneFor(h, keys.zones));
		const zone = c.zone;
		const aop = c.aop;
		if (aop && zone) {
			await this.step(job, 'origin-pulls', async () => {
				await deps.cf.setOriginPulls(keys.cfKey, zone.id, webHosts, aop.certId, true);
				return `${webHosts.join(', ')}: Cloudflare now shows our client certificate to the server`;
			});
		} else this.skip(job, 'origin-pulls', o.d.firstBoot ? 'already on' : 'no first-boot file');

		const tunnel = c.tunnel;
		if (tunnel) {
			await this.step(job, 'tunnel-up', async () => {
				const until = Date.now() + deps.waits.tunnelFor;
				for (;;) {
					const links = await deps.cf.tunnelConnections(keys.cfKey, tunnel.accountId, tunnel.id);
					if (links > 0) return `cloudflared connected · ${links} link${links === 1 ? '' : 's'}`;
					if (Date.now() > until)
						throw new Stop(
							'The tunnel has not connected yet. First boot may still be running: open the Recovery Console on DigitalOcean to look.',
						);
					await deps.sleep(deps.waits.tunnelEvery);
				}
			});
		} else this.skip(job, 'tunnel-up', 'no tunnel');

		if (tunnel && job.privateIp && zone) {
			const ip = job.privateIp;
			await this.step(job, 'private-access', async () => {
				await deps.cf.privateRoute(
					keys.cfKey,
					tunnel.accountId,
					tunnel.id,
					`${ip}/32`,
					`${job.name}: SSH and SFTP over WARP`,
				);
				await deps.cf.warpEnrollment(keys.cfKey, zone.accountId, o.emails);
				await deps.cf.warpInclude(keys.cfKey, zone.accountId, [`${ip}/32`]);
				return `${ip} through the tunnel · WARP for ${o.emails.length} ${o.emails.length === 1 ? 'person' : 'people'} · WARP carries only server addresses`;
			});
		} else this.skip(job, 'private-access', 'no tunnel');

		const token = c.token;
		if (!token) {
			for (const k of ['github', 'known-hosts']) this.skip(job, k, 'no first-boot file');
			return;
		}
		const apiHost = o.domains.find((h) => /^api[.-]/.test(h)) ?? null;
		await this.step(job, 'github', async () => {
			const r = await deps.helper<{ environmentMade: boolean; set: string[] }>('/github/environment', {
				repository: o.repository,
				environment: o.target,
				variables: { SERVER_SSH_HOST: c.sshHost, ...(apiHost ? { API_HOST: apiHost } : {}) },
				secrets: { CF_ACCESS_CLIENT_ID: token.clientId, CF_ACCESS_CLIENT_SECRET: token.clientSecret },
				deployKeyOf: { project: o.projectId, environment: o.d.environment },
			});
			return `${o.repository} · environment ${o.target}${r.environmentMade ? ' (made)' : ''} · set ${r.set.join(', ')}`;
		});
		await this.step(job, 'known-hosts', async () => {
			const { line } = await deps.helper<{ line: string }>('/server/known-hosts', {
				host: c.sshHost,
				tokenId: token.clientId,
				tokenSecret: token.clientSecret,
			});
			await deps.helper('/github/environment', {
				repository: o.repository,
				environment: o.target,
				variables: { SERVER_SSH_KNOWN_HOSTS: line },
			});
			return `${line.split(' ').slice(0, 2).join(' ')} · saved as SERVER_SSH_KNOWN_HOSTS`;
		});
	}

	// ---------------------------------------------------------------- destroy

	private async runDestroy(
		job: DropletJob,
		target: { id: number; name: string; ipv4: string | null },
		envName: string,
		domains: string[],
		keys: Keys,
		projectId: string,
	): Promise<void> {
		const { deps } = this;
		const zoneName = zoneFor(domains[0] ?? '', keys.zones) ?? keys.zones[0];
		const webHosts = domains.filter((h) => zoneFor(h, keys.zones));
		try {
			const zone = zoneName ? await deps.cf.zone(keys.cfKey, zoneName) : null;
			await this.step(job, 'dns', async () => {
				if (!target.ipv4) return 'the droplet has no address, so no records point at it';
				let removed = 0;
				for (const host of webHosts) {
					const z = await deps.cf.zone(keys.cfKey, zoneFor(host, keys.zones) ?? '');
					removed += await deps.cf.unpointHost(keys.cfKey, z.id, host, target.ipv4);
				}
				return `${removed} record${removed === 1 ? '' : 's'} that pointed at ${target.ipv4} removed`;
			});
			await this.step(job, 'origin-pulls', async () => {
				if (!zone || !webHosts.length) return 'no hosts';
				await deps.cf.setOriginPulls(keys.cfKey, zone.id, webHosts, null, false);
				return `${webHosts.join(', ')}: off`;
			});
			await this.step(job, 'firewall', async () => {
				const ids = await deps.do.firewallsNamed(keys.doKey, target.name);
				for (const id of ids) await deps.do.deleteFirewall(keys.doKey, id);
				return ids.length ? `${target.name} deleted` : 'none by that name';
			});
			await this.step(job, 'droplet', async () => {
				await deps.do.deleteDroplet(keys.doKey, target.id);
				return `DELETE /v2/droplets/${target.id} · billing stops`;
			});
			await this.step(job, 'access', async () => {
				if (!zone || !envName) return 'no zone';
				const host = sshHostOf(envName, zone.name);
				const app = await deps.cf.accessAppFor(keys.cfKey, zone.accountId, host);
				if (app) await deps.cf.deleteAccessApp(keys.cfKey, zone.accountId, app.id);
				const tokens = await deps.cf.serviceTokensNamed(keys.cfKey, zone.accountId, `${target.name} deploy`);
				for (const t of tokens) await deps.cf.deleteServiceToken(keys.cfKey, zone.accountId, t);
				return `${app ? 'application' : 'no application'} · ${tokens.length} token${tokens.length === 1 ? '' : 's'}`;
			});
			await this.step(job, 'tunnel', async () => {
				if (!zone) return 'no Cloudflare zone, so no tunnel';
				const t = await deps.cf.tunnelNamed(keys.cfKey, zone.accountId, target.name);
				if (!t) return 'none by that name';
				if (envName) await deps.cf.unpointTunnel(keys.cfKey, zone.id, sshHostOf(envName, zone.name), t.id);
				await deps.cf.deletePrivateRoutes(keys.cfKey, zone.accountId, t.id);
				await deps.cf.deleteTunnel(keys.cfKey, zone.accountId, t.id);
				return `${target.name} and its SSH host name deleted`;
			});
			this.finish(job, null);
			this.store.audit(projectId, 'droplet-destroyed', `${target.name} (${target.id}) destroyed`);
		} catch (err) {
			const message = this.reason(err);
			this.finish(job, message);
			this.store.audit(projectId, 'droplet-destroy-failed', `${target.name}: ${message}`);
		}
	}

	// ---------------------------------------------------------------- steps

	private newJob(
		projectId: string,
		repoId: string,
		kind: DropletJob['kind'],
		environment: string,
		name: string,
		steps: readonly (readonly [string, string])[],
	) {
		const job = {
			id: `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`,
			kind,
			environment,
			name,
			state: 'running' as const,
			startedAt: new Date().toISOString(),
			finishedAt: null,
			steps: steps.map(([key, label]): DropletJobStep => ({ key, label, detail: '', state: 'queued', ms: null })),
			dropletId: null,
			ipv4: null,
			ipv6: null,
			privateIp: null,
			sshHost: null,
			monthly: 0,
			hourly: 0,
			error: null,
			projectId,
			repoId,
		};
		this.jobs.set(job.id, job);
		return job as DropletJob & { projectId: string; repoId: string };
	}

	private async step(job: DropletJob, key: string, work: () => Promise<string>): Promise<void> {
		const s = job.steps.find((x) => x.key === key);
		if (!s) return;
		s.state = 'running';
		const t = Date.now();
		try {
			s.detail = await work();
			s.state = 'done';
		} catch (err) {
			s.state = 'failed';
			s.detail = this.reason(err);
			throw new Stop(s.detail);
		} finally {
			s.ms = Date.now() - t;
		}
	}

	private skip(job: DropletJob, key: string, why: string): void {
		const s = job.steps.find((x) => x.key === key);
		if (s) Object.assign(s, { state: 'skipped', detail: why, ms: 0 });
	}

	private finish(job: DropletJob, error: string | null): void {
		job.state = error ? 'failed' : 'done';
		job.error = error;
		job.finishedAt = new Date().toISOString();
		for (const s of job.steps) if (s.state === 'queued' && !error) s.state = 'skipped';
	}

	private reason(err: unknown): string {
		if (err instanceof Stop || err instanceof VendorError) return err.message;
		if (err instanceof Error && 'status' in err) return err.message;
		return `Unexpected: ${err instanceof Error ? err.message : String(err)}`;
	}

	private view(j: DropletJob & { projectId?: string; repoId?: string }): DropletJob {
		const { projectId: _p, repoId: _r, ...rest } = j;
		return { ...rest, steps: rest.steps.map((s) => ({ ...s })) };
	}
}
