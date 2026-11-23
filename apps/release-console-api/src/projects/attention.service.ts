import { Injectable } from '@nestjs/common';
import {
	type AttentionCount,
	type AttentionItem,
	TOKEN_WARN_DAYS,
	graceDaysLeft,
	rotateRowsOf,
} from '@saha-textile/release-console-contracts';

import { keyAttention, runAttention } from './attention.js';
import { LocalAlerts } from '../local/local-alerts.js';
import { ProjectsService } from './projects.service.js';
import { VendorReadsService } from './vendor-reads.service.js';
import { DropletJobs } from '../servers/droplet-jobs.js';

const CACHE_MS = 60_000;

/** What needs the owner, per project; the console level sees names and counts only. */
@Injectable()
export class AttentionService {
	private readonly cache = new Map<string, { at: number; items: AttentionItem[] }>();

	constructor(
		private readonly projects: ProjectsService,
		private readonly reads: VendorReadsService,
		private readonly alerts: LocalAlerts,
		private readonly jobs: DropletJobs,
	) {}

	async forProject(projectId: string): Promise<AttentionItem[]> {
		return [...(await this.cached(projectId)), ...this.localAlerts(projectId)];
	}

	/**
	 * This Mac's firing alerts, for a project with an environment on this computer. Key alerts are
	 * left out here: the project's own key rows already say the same.
	 */
	private localAlerts(projectId: string): AttentionItem[] {
		const project = this.projects.project(projectId);
		const local = project.repositories.some((r) => r.environments.some((e) => e.cloudId === null));
		if (!local) return [];
		return this.alerts
			.firing()
			.filter((a) => a.rule !== 'key-expiring')
			.map((a) => ({
				projectId,
				repositoryId: null,
				kind: 'local-alert' as const,
				title: a.title,
				detail: `${a.detail} This Mac · since ${a.firedAt.slice(11, 16)}.`,
			}));
	}

	private async cached(projectId: string): Promise<AttentionItem[]> {
		const hit = this.cache.get(projectId);
		if (hit && Date.now() - hit.at < CACHE_MS) return hit.items;
		const project = this.projects.project(projectId);
		const items = keyAttention(project);
		for (const r of project.repositories) {
			const runs = await this.reads.runs(project.id, r.id);
			if (runs.state === 'ok') items.push(...runAttention(project.id, r.id, runs.data));
			items.push(...this.rotationItems(project.id, r.id, r.environments));
		}
		items.push(...(await this.tokenItems(project.id)));
		this.cache.set(projectId, { at: Date.now(), items });
		return items;
	}

	/** Values waiting for a deploy with rotation, and old keys due for removal (Release Path brief C1, C9). */
	private rotationItems(
		projectId: string,
		repositoryId: string,
		envs: readonly { name: string; label: string }[],
	): AttentionItem[] {
		const out: AttentionItem[] = [];
		for (const e of envs) {
			const state = this.projects.rotation(projectId, repositoryId, e.name);
			if (state.pending.length)
				out.push({
					projectId,
					repositoryId,
					kind: 'rotation-waiting',
					title: `${e.label}: deploy with rotation`,
					detail: `${rotateRowsOf(state.pending)
						.map((x) => x.label)
						.join(
							', ',
						)} changed in Infisical; the server still runs the old values. Ship › Live deploy › Deploy and rotate.`,
				});
			const days = graceDaysLeft(state);
			if (days !== null && days <= 0)
				out.push({
					projectId,
					repositoryId,
					kind: 'old-keys',
					title: `${e.label}: remove the old keys`,
					detail: `${state.graceNames.join(', ')} kept since ${state.graceAt?.slice(0, 10) ?? '—'}. Run › Secrets › Rotate › Remove the old keys, then a deploy.`,
				});
		}
		return out;
	}

	/** Deploy tokens that end within 30 days (Release Path brief C6). */
	private async tokenItems(projectId: string): Promise<AttentionItem[]> {
		const tokens = await this.jobs.deployTokens(projectId).catch(() => []);
		const soon = Date.now() + TOKEN_WARN_DAYS * 86_400_000;
		return tokens
			.filter((t) => t.expiresAt && Date.parse(t.expiresAt) < soon)
			.map((t) => ({
				projectId,
				repositoryId: t.repositoryId,
				kind: 'deploy-token-expiring' as const,
				title: `${t.environment}: the deploy token ends ${t.expiresAt?.slice(0, 10)}`,
				detail: `${t.name} deploy signs deploy.yml in through the tunnel; after its end every deploy is refused. DigitalOcean › Droplets › Creating › Renew token.`,
			}));
	}

	async counts(): Promise<AttentionCount[]> {
		const all = this.projects.view().projects;
		return Promise.all(
			all.map(async (p) => ({ projectId: p.id, name: p.name, count: (await this.forProject(p.id)).length })),
		);
	}

	forget(projectId: string): void {
		this.cache.delete(projectId);
	}
}
