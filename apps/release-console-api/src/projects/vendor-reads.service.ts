import { Injectable } from '@nestjs/common';
import {
	type CloudAccount,
	type DnsRecord,
	type Droplet,
	type EdgeZone,
	type KeyKind,
	type KeyRef,
	type Project,
	type PullRequest,
	type RepositoryFileFound,
	type RepositoryFileQuery,
	repositoryFileSchema,
	CONSOLE_KEYS_FOLDER,
	VENDOR_NAMES,
	type VendorAnswer,
	type WorkflowRun,
} from '@saha-textile/release-console-contracts';

import { ProjectsService, githubCliToken } from './projects.service.js';
import { cloudflareAdapter } from '../vendors/cloudflare.adapter.js';
import { digitalOceanAdapter } from '../vendors/digitalocean.adapter.js';
import { githubAdapter } from '../vendors/github.adapter.js';
import { VendorError } from '../vendors/http.js';

const notConnected = <T>(message: string): VendorAnswer<T> => ({ state: 'not-connected', message });

/** Reads vendor data for one repository's slot, always answering ok, not-connected or error. */
@Injectable()
export class VendorReadsService {
	constructor(private readonly projects: ProjectsService) {}

	pulls(projectId: string, repoId: string): Promise<VendorAnswer<PullRequest[]>> {
		return this.sourceCode(projectId, repoId, (repo, key) => githubAdapter.pulls(repo, key));
	}

	runs(projectId: string, repoId: string): Promise<VendorAnswer<WorkflowRun[]>> {
		return this.sourceCode(projectId, repoId, (repo, key) => githubAdapter.runs(repo, key));
	}

	droplets(projectId: string, repoId: string, slotId: string): Promise<VendorAnswer<Droplet[]>> {
		return this.cloud(projectId, repoId, slotId, (key) => digitalOceanAdapter.servers(key));
	}

	cloudAccount(projectId: string, repoId: string, slotId: string): Promise<VendorAnswer<CloudAccount>> {
		return this.cloud(projectId, repoId, slotId, (key) => digitalOceanAdapter.account(key));
	}

	zones(projectId: string, repoId: string, slotId: string): Promise<VendorAnswer<EdgeZone[]>> {
		return this.edge(projectId, repoId, slotId, (key) => cloudflareAdapter.zones(key));
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
		const key = await githubCliToken();
		if (!key)
			return notConnected('The GitHub CLI is not signed in on this computer. Run gh auth login in a terminal.');
		try {
			const text = await githubAdapter.file(q.repository, '.release-console.json', key);
			if (text === null)
				return { state: 'ok', readAt: new Date().toISOString(), data: { found: false, menus: [] } };
			const file = repositoryFileSchema.parse(JSON.parse(text));
			return { state: 'ok', readAt: new Date().toISOString(), data: { found: true, menus: file.menus } };
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
