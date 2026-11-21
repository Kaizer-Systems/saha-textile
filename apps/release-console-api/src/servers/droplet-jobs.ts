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
} from '@saha-textile/release-console-contracts';

import { ProjectsService } from '../projects/projects.service.js';
import { RunnerClient } from '../runner/runner-client.js';
import { ConsoleStore } from '../store/console-store.js';
import { cfWrites, zoneFor } from '../vendors/cf-writes.js';
import { cloudflareRanges, doWrites, firewallBody } from '../vendors/do-writes.js';
import { VendorError } from '../vendors/http.js';
import { digitalOceanAdapter } from '../vendors/digitalocean.adapter.js';

/** What a job calls; the tests pass made-up vendors. */
export interface JobDeps {
	catalog: (key: string) => Promise<DoCatalog>;
	do: typeof doWrites;
	cf: typeof cfWrites;
	ranges: () => Promise<string[]>;
	firstBoot: (body: Record<string, unknown>) => Promise<{ userData: string; deployPublicKey: string }>;
	sleep: (ms: number) => Promise<void>;
	/** How often and how long to wait for the server and its tunnel. */
	waits: { activeEvery: number; activeFor: number; tunnelEvery: number; tunnelFor: number };
}

interface Keys {
	doKey: string;
	cfKey: string;
	zones: string[];
}

class Stop extends Error {}

/**
 * DigitalOcean › Droplets: creates a server step by step after the PIN (brief v7, Creating), and
 * destroys a staging or development one in reverse. Jobs live in memory while the console runs;
 * the audit log keeps who did what. Production is never destroyed from here.
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
			firstBoot: (body) => runner.call('POST', '/server/first-boot', body, 60_000),
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
				'Creating needs the Cloudflare full-access key for the tunnel and DNS: link it on the Connections screen.',
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
		const keys = await this.keys(project, repo, slotId);
		const catalog = await this.deps.catalog(keys.doKey);
		const size = catalog.sizes.find((s) => s.slug === d.size);
		const cost = dropletCost(d, size);
		const job = this.newJob(projectId, repoId, 'create', d.environment, d.names[0] ?? d.environment, CREATE_STEPS);
		job.monthly = cost.total;
		job.hourly = cost.hourly;
		this.store.audit(
			projectId,
			'droplet-create',
			`${job.name}: ${d.size} in ${d.region} (${d.image}), $${cost.total.toFixed(2)} a month, started with the PIN`,
		);
		void this.runCreate(job, d, env.domains, keys, input.adminPassword, projectId);
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
		void this.runDestroy(job, target, env?.domains ?? [], keys, projectId);
		return this.view(job);
	}

	// ---------------------------------------------------------------- create

	private async runCreate(
		job: DropletJob,
		d: DropletDraft,
		domains: string[],
		keys: Keys,
		password: string,
		projectId: string,
	): Promise<void> {
		const { deps } = this;
		const name = job.name;
		try {
			let tunnelToken = '';
			let tunnel: { id: string; accountId: string } | null = null;
			const zoneName = zoneFor(domains[0] ?? '', keys.zones) ?? keys.zones[0] ?? '';
			if (d.firstBoot) {
				await this.step(job, 'tunnel', async () => {
					if (!zoneName) throw new Stop('The repository names no Cloudflare zone.');
					const zone = await deps.cf.zone(keys.cfKey, zoneName);
					const found = await deps.cf.tunnelNamed(keys.cfKey, zone.accountId, name);
					const t = found ?? (await deps.cf.createTunnel(keys.cfKey, zone.accountId, name));
					tunnel = { id: t.id, accountId: zone.accountId };
					tunnelToken = await deps.cf.tunnelToken(keys.cfKey, zone.accountId, t.id);
					return `${found ? 'kept' : 'created'} tunnel ${name} · token read for the first-boot file`;
				});
			} else this.skip(job, 'tunnel', 'no first-boot file, so no tunnel');

			let userData = '';
			if (d.firstBoot) {
				await this.step(job, 'first-boot', async () => {
					const adminKey = await deps.do.publicKey(keys.doKey, d.sshKeyIds[0] ?? 0);
					const out = await deps.firstBoot({
						project: projectId,
						environment: d.environment,
						adminKey,
						password,
						tunnelToken,
					});
					userData = out.userData;
					return `admin key, deploy key (its private half stays on this Mac), password hash and tunnel token filled in · ${Math.round(Buffer.byteLength(userData) / 1024)} KB`;
				});
			} else this.skip(job, 'first-boot', 'turned off on the Network step');

			let volumeId: string | null = null;
			if (d.volumeGb > 0) {
				await this.step(job, 'volume', async () => {
					volumeId = await deps.do.createVolume(keys.doKey, {
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
				if (userData) body['user_data'] = userData;
				else delete body['user_data'];
				if (volumeId) body['volumes'] = [volumeId];
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
				const projectIdOnDo = d.projectId;
				await this.step(job, 'project', async () => {
					const urns = [`do:droplet:${id}`, ...(volumeId ? [`do:volume:${volumeId}`] : [])];
					await deps.do.assign(keys.doKey, projectIdOnDo, urns);
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
					for (const host of domains) {
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

			if (tunnel) {
				const t: { id: string; accountId: string } = tunnel;
				await this.step(job, 'tunnel-up', async () => {
					const until = Date.now() + deps.waits.tunnelFor;
					for (;;) {
						const links = await deps.cf.tunnelConnections(keys.cfKey, t.accountId, t.id);
						if (links > 0) return `cloudflared connected · ${links} link${links === 1 ? '' : 's'}`;
						if (Date.now() > until)
							throw new Stop(
								'The tunnel has not connected yet. First boot may still be running: open the Recovery Console on DigitalOcean to look.',
							);
						await deps.sleep(deps.waits.tunnelEvery);
					}
				});
			} else this.skip(job, 'tunnel-up', 'no tunnel');

			this.finish(job, null);
			this.store.audit(projectId, 'droplet-created', `${name} (${id}) ready · ${job.ipv4}`);
		} catch (err) {
			const message = this.reason(err);
			this.finish(job, message);
			this.store.audit(projectId, 'droplet-create-failed', `${name}: ${message}`);
		}
	}

	// ---------------------------------------------------------------- destroy

	private async runDestroy(
		job: DropletJob,
		target: { id: number; name: string; ipv4: string | null },
		domains: string[],
		keys: Keys,
		projectId: string,
	): Promise<void> {
		const { deps } = this;
		try {
			await this.step(job, 'dns', async () => {
				if (!target.ipv4) return 'the droplet has no address, so no records point at it';
				let removed = 0;
				for (const host of domains) {
					const zone = zoneFor(host, keys.zones);
					if (!zone) continue;
					const z = await deps.cf.zone(keys.cfKey, zone);
					removed += await deps.cf.unpointHost(keys.cfKey, z.id, host, target.ipv4);
				}
				return `${removed} record${removed === 1 ? '' : 's'} that pointed at ${target.ipv4} removed`;
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
			await this.step(job, 'tunnel', async () => {
				const zoneName = zoneFor(domains[0] ?? '', keys.zones) ?? keys.zones[0];
				if (!zoneName) return 'no Cloudflare zone, so no tunnel';
				const zone = await deps.cf.zone(keys.cfKey, zoneName);
				const t = await deps.cf.tunnelNamed(keys.cfKey, zone.accountId, target.name);
				if (!t) return 'none by that name';
				await deps.cf.deleteTunnel(keys.cfKey, zone.accountId, t.id);
				return `${target.name} deleted`;
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
		for (const s of job.steps) if (s.state === 'queued') s.state = error ? 'queued' : 'skipped';
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
