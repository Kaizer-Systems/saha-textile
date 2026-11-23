import { Injectable } from '@nestjs/common';
import {
	type CloudAccount,
	type DoCatalog,
	type DnsRecord,
	type Droplet,
	type EdgeZone,
	type KeyKind,
	type KeyRef,
	type Project,
	type PullRequest,
	type Branches,
	type DomainsView,
	type SecurityView,
	type ReleasesView,
	type BranchesQuery,
	type RepositoryFileFound,
	type RepositoryFileQuery,
	readManifest,
	repositoryFileSchema,
	CONSOLE_KEYS_FOLDER,
	VENDOR_NAMES,
	type VendorAnswer,
	type WorkflowRun,
	opsJobsSchema,
	opsKeyName,
	opsMessagesSchema,
} from '@saha-textile/release-console-contracts';

import { ProjectsService, githubCliToken } from './projects.service.js';
import { KeySourceService } from '../keys/key-source.js';
import { RunnerClient } from '../runner/runner-client.js';
import { checkHost } from '../vendors/tls-check.js';
import { cloudflareAdapter } from '../vendors/cloudflare.adapter.js';
import { digitalOceanAdapter } from '../vendors/digitalocean.adapter.js';
import { githubAdapter } from '../vendors/github.adapter.js';
import { VendorError } from '../vendors/http.js';

const notConnected = <T>(message: string): VendorAnswer<T> => ({ state: 'not-connected', message });

/** Reads vendor data for one repository's slot, always answering ok, not-connected or error. */
@Injectable()
export class VendorReadsService {
	private readonly helper = new RunnerClient();

	constructor(
		private readonly projects: ProjectsService,
		private readonly keyFile: KeySourceService,
	) {}

	/**
	 * One environment's operations address (`/ops/jobs` or `/ops/messages`), read with that
	 * environment's console key: this computer's stack through the Mac helper, a server over https on
	 * its API domain. The key never leaves this process except to the helper on 127.0.0.1.
	 */
	async ops(p: string, r: string, envName: string, kind: 'jobs' | 'messages'): Promise<VendorAnswer<unknown>> {
		const { repo } = this.projects.repository(p, r);
		const env = repo.environments.find((e) => e.name === envName);
		if (!env) return { state: 'error', message: `${repo.name} has no environment ${envName}.` };
		const name = opsKeyName(env);
		if (!name) return { state: 'not-connected', message: `${env.label} has no operations key name.` };
		const token = this.keyFile.get(name);
		if (!token)
			return {
				state: 'not-connected',
				message: `Add ${name} in Infisical (saha-textile-local · dev · /release-console) with the same value as this environment's OPS_TOKEN, then run pnpm console:env.`,
			};
		const schema = kind === 'jobs' ? opsJobsSchema : opsMessagesSchema;
		try {
			let raw: unknown;
			if (env.cloudId === null) raw = await this.helper.call('POST', '/ops', { kind, token, hours: 24 });
			else {
				const host = env.domains.find((d) => /^api[.-]/.test(d));
				if (!host) return { state: 'not-connected', message: `${env.label} names no api… domain to read.` };
				const res = await fetch(`https://${host}/ops/${kind}${kind === 'messages' ? '?hours=24' : ''}`, {
					headers: { authorization: `Bearer ${token}` },
					signal: AbortSignal.timeout(10_000),
				});
				if (!res.ok) return { state: 'error', message: `${host} answered ${res.status} to /ops/${kind}.` };
				raw = await res.json();
			}
			return { state: 'ok', readAt: new Date().toISOString(), data: schema.parse(raw) };
		} catch (err) {
			return {
				state: 'error',
				message: err instanceof Error ? err.message : 'The operations address did not answer.',
			};
		}
	}

	/**
	 * The branch pickers' list (owner, 20 Nov): GitHub's branches, merged with the ones this
	 * computer's checkout has when it is this repository (a branch never pushed shows as "only on
	 * this computer"). Either side may be missing; the answer says why GitHub's is.
	 */
	async branches(q: BranchesQuery): Promise<Branches> {
		type Local = { checkout: boolean; current: string | null; local: string[]; remote: string[] };
		const here = await this.helper
			.call<Local>(
				'GET',
				`/git/branches?repository=${encodeURIComponent(q.repository)}${q.refresh ? '&fetch=1' : ''}`,
				undefined,
				60_000,
			)
			.catch(() => ({ checkout: false, current: null, local: [], remote: [] }) as Local);
		let github: { defaultBranch: string | null; names: string[] } | null = null;
		let note = '';
		const key = await githubCliToken();
		if (!key) note = 'GitHub is not connected yet: press Connect on the repository.';
		else
			github = await githubAdapter.branches(q.repository, key).catch((err: unknown) => {
				note = err instanceof VendorError ? err.message : 'GitHub could not be asked for the branches.';
				return null;
			});
		const onGitHub = new Set(github?.names ?? (here.checkout ? here.remote : []));
		const onThisComputer = new Set(here.checkout ? here.local : []);
		const names = [...new Set([...onGitHub, ...onThisComputer])].sort((a, b) => a.localeCompare(b));
		return {
			defaultBranch: github?.defaultBranch ?? null,
			current: here.checkout ? here.current : null,
			branches: names.map((name) => ({
				name,
				onGitHub: onGitHub.has(name),
				onThisComputer: onThisComputer.has(name),
			})),
			note,
		};
	}

	/**
	 * Releases: for each environment and the next (Local → … → Production), what its branch has that
	 * the next one's lacks, with database migrations and secret-name changes called out.
	 */
	async releases(projectId: string, repoId: string): Promise<VendorAnswer<ReleasesView>> {
		const { repo } = this.projects.repository(projectId, repoId);
		return this.sourceCode(projectId, repoId, async (repository, key) => {
			const envs = repo.environments;
			const comparisons = [];
			for (let i = 0; i + 1 < envs.length; i += 1) {
				const from = envs[i]!;
				const to = envs[i + 1]!;
				const fromBranch = from.branch || 'main';
				const toBranch = to.branch || 'main';
				const base = { from: from.label, to: to.label, fromBranch, toBranch };
				if (fromBranch === toBranch) {
					comparisons.push({
						...base,
						aheadBy: 0,
						commits: [],
						files: 0,
						migrations: false,
						secretNames: false,
						url: '',
						note: 'Both use the same branch.',
					});
					continue;
				}
				const c = await githubAdapter.compare(repository, key, toBranch, fromBranch);
				if (!c) {
					comparisons.push({
						...base,
						aheadBy: 0,
						commits: [],
						files: 0,
						migrations: false,
						secretNames: false,
						url: '',
						note: `${fromBranch} or ${toBranch} is not on GitHub.`,
					});
					continue;
				}
				comparisons.push({
					...base,
					aheadBy: c.aheadBy,
					commits: c.commits,
					files: c.files.length,
					migrations: c.files.some((f) => f.includes('/release/') || f.includes('data-migrations')),
					secretNames: c.files.some((f) => f.endsWith('variable-names.json')),
					url: c.url,
					note: '',
				});
			}
			return { comparisons };
		});
	}

	/** Dependencies and security: GitHub's open alerts, read hourly while the screen is open. */
	security(projectId: string, repoId: string): Promise<VendorAnswer<SecurityView>> {
		return this.sourceCode(projectId, repoId, (repo, key) => githubAdapter.security(repo, key));
	}

	pulls(projectId: string, repoId: string): Promise<VendorAnswer<PullRequest[]>> {
		return this.sourceCode(projectId, repoId, (repo, key) => githubAdapter.pulls(repo, key));
	}

	runs(projectId: string, repoId: string): Promise<VendorAnswer<WorkflowRun[]>> {
		return this.sourceCode(projectId, repoId, (repo, key) => githubAdapter.runs(repo, key));
	}

	async droplets(projectId: string, repoId: string, slotId: string): Promise<VendorAnswer<Droplet[]>> {
		const answer = await this.cloud(projectId, repoId, slotId, (key) => digitalOceanAdapter.servers(key));
		// A droplet destroyed on DigitalOcean's own page loses its environment tag too (owner, 23 Nov);
		// only from a whole list (the adapter reads one page of 200).
		if (answer.state === 'ok' && answer.data.length < 200)
			this.projects.pruneEnvTags(
				projectId,
				repoId,
				'droplet',
				answer.data.map((d) => String(d.id)),
			);
		return answer;
	}

	cloudAccount(projectId: string, repoId: string, slotId: string): Promise<VendorAnswer<CloudAccount>> {
		return this.cloud(projectId, repoId, slotId, (key) => digitalOceanAdapter.account(key));
	}

	/** Everything DigitalOcean's create steps choose from, read with the read key. */
	doCatalog(projectId: string, repoId: string, slotId: string): Promise<VendorAnswer<DoCatalog>> {
		return this.cloud(projectId, repoId, slotId, (key) => digitalOceanAdapter.catalog(key));
	}

	zones(projectId: string, repoId: string, slotId: string): Promise<VendorAnswer<EdgeZone[]>> {
		return this.edge(projectId, repoId, slotId, (key) => cloudflareAdapter.zones(key));
	}

	/**
	 * Certificates and domains (brief 26gq3NbcbBESea6abRtsa3, screen 9): the edge slot's certificates
	 * from Cloudflare, and a direct handshake with every server environment's domain.
	 */
	async domains(projectId: string, repoId: string, slotId: string): Promise<VendorAnswer<DomainsView>> {
		const { repo } = this.projects.repository(projectId, repoId);
		const answer = await this.edge(projectId, repoId, slotId, async (key, zones) =>
			(await Promise.all(zones.map((z) => cloudflareAdapter.certificates(key, z)))).flat(),
		);
		if (answer.state !== 'ok') return answer;
		const targets = repo.environments.flatMap((e) =>
			e.cloudId === null ? [] : e.domains.map((host) => ({ host, environment: e.label })),
		);
		const hosts = await Promise.all(targets.map(async (t) => ({ ...t, ...(await checkHost(t.host)) })));
		return { state: 'ok', readAt: answer.readAt, data: { certificates: answer.data, hosts } };
	}

	records(projectId: string, repoId: string, slotId: string, zone: string): Promise<VendorAnswer<DnsRecord[]>> {
		return this.edge(projectId, repoId, slotId, (key, zones) => {
			if (!zones.includes(zone)) throw new VendorError(`${zone} is not a domain of this edge slot.`, 404);
			return cloudflareAdapter.records(key, zone);
		});
	}

	/**
	 * A repository's own menus from its `.release-console.json`, read before it joins a project.
	 * It uses the GitHub CLI sign-in on this computer, which belongs to no project.
	 */
	async repositoryFile(q: RepositoryFileQuery): Promise<VendorAnswer<RepositoryFileFound>> {
		if (q.vendor !== 'github')
			return notConnected(`${VENDOR_NAMES[q.vendor]} screens come later; add its menus by hand.`);
		const read = (text: string | null, ref?: string): VendorAnswer<RepositoryFileFound> => {
			if (text === null)
				return {
					state: 'ok',
					readAt: new Date().toISOString(),
					data: { found: false, menus: [], ref, problems: [] },
				};
			// Version 2 (brief 26gq3NbcbBESea6abRtsa3): the whole manifest, with each line it could not use.
			const { manifest, problems } = readManifest(JSON.parse(text), q.repository.split('/')[1] ?? q.repository);
			const menus = manifest?.menus ?? repositoryFileSchema.parse(JSON.parse(text)).menus;
			return {
				state: 'ok',
				readAt: new Date().toISOString(),
				data: { found: true, menus, ref, manifest, problems },
			};
		};
		// A branch is read in this computer's checkout first, where a branch never pushed lives too.
		if (q.ref) {
			const here = await this.helper
				.call<{ found: boolean; text: string }>(
					'GET',
					`/git/file?repository=${encodeURIComponent(q.repository)}&ref=${encodeURIComponent(q.ref)}`,
					undefined,
					20_000,
				)
				.catch(() => null);
			if (here?.found) {
				try {
					return read(here.text, q.ref);
				} catch (err) {
					return { state: 'error', message: `The file could not be read: ${(err as Error).message}` };
				}
			}
		}
		const key = await githubCliToken();
		if (!key)
			return notConnected('The GitHub CLI is not signed in on this computer. Run gh auth login in a terminal.');
		try {
			return read(await githubAdapter.file(q.repository, '.release-console.json', key, q.ref), q.ref);
		} catch (err) {
			return {
				state: 'error',
				message:
					err instanceof VendorError ? err.message : `The file could not be read: ${(err as Error).message}`,
			};
		}
	}

	private async sourceCode<T>(
		projectId: string,
		repoId: string,
		read: (repo: string, key: string) => Promise<T>,
	): Promise<VendorAnswer<T>> {
		const { project, repo } = this.projects.repository(projectId, repoId);
		if (repo.sourceCode.vendor !== 'github')
			return notConnected(
				`${VENDOR_NAMES[repo.sourceCode.vendor]} screens come later; its adapter fills these screens when it is built.`,
			);
		const ref = project.keys.find((k) => k.id === repo.sourceCode.keyId);
		if (!ref)
			return notConnected('GitHub is not connected for this repository. Add a key on the Connections screen.');
		return this.withKey(ref, (key) => read(repo.sourceCode.repository, key));
	}

	private async cloud<T>(
		projectId: string,
		repoId: string,
		slotId: string,
		read: (key: string) => Promise<T>,
	): Promise<VendorAnswer<T>> {
		const { project, repo } = this.projects.repository(projectId, repoId);
		const slot = repo.cloud.find((c) => c.id === slotId);
		if (!slot) return notConnected('This repository has no such cloud platform.');
		if (slot.vendor !== 'digitalocean') return notConnected(`${VENDOR_NAMES[slot.vendor]} screens come later.`);
		const ref = this.pick(project, slot.keyIds, ['do-read', 'do-change']);
		if (!ref) return notConnected('DigitalOcean is not connected. Paste a read token on the Connections screen.');
		return this.withKey(ref, read);
	}

	private async edge<T>(
		projectId: string,
		repoId: string,
		slotId: string,
		read: (key: string, zones: string[]) => Promise<T>,
	): Promise<VendorAnswer<T>> {
		const { project, repo } = this.projects.repository(projectId, repoId);
		const slot = repo.edge.find((e) => e.id === slotId);
		if (!slot) return notConnected('This repository has no such edge platform.');
		if (slot.vendor !== 'cloudflare') return notConnected(`${VENDOR_NAMES[slot.vendor]} screens come later.`);
		const ref = this.pick(project, slot.keyIds, ['cf-read', 'cf-change']);
		if (!ref) return notConnected('Cloudflare is not connected. Paste a read token on the Connections screen.');
		return this.withKey(ref, (key) => read(key, slot.zones));
	}

	/** Prefers the first kind (read) over the second (change), so screens read with the narrower key. */
	private pick(project: Project, keyIds: string[], kinds: KeyKind[]): KeyRef | undefined {
		const refs = project.keys.filter((k) => keyIds.includes(k.id));
		for (const kind of kinds) {
			const hit = refs.find((k) => k.kind === kind);
			if (hit) return hit;
		}
		return undefined;
	}

	private async withKey<T>(ref: KeyRef, read: (key: string) => Promise<T>): Promise<VendorAnswer<T>> {
		if (ref.state === 'expired')
			return notConnected(`${ref.label} has expired. Paste a new one on the Connections screen.`);
		const key = await this.projects.valueOf(ref);
		if (!key)
			return notConnected(
				ref.kind === 'github-cli'
					? 'The GitHub CLI is not signed in on this computer. Run gh auth login in a terminal.'
					: `${ref.label} has no value in the console's key file. Add ${ref.envNames.join(' + ')} in Infisical (${CONSOLE_KEYS_FOLDER}), then run pnpm console:env.`,
			);
		try {
			return { state: 'ok', readAt: new Date().toISOString(), data: await read(key) };
		} catch (err) {
			return {
				state: 'error',
				message:
					err instanceof VendorError
						? err.message
						: `The vendor could not be reached: ${(err as Error).message}`,
			};
		}
	}
}
