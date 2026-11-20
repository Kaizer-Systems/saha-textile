import { Injectable } from '@nestjs/common';
import type { AttentionCount, AttentionItem } from '@saha-textile/release-console-contracts';

import { keyAttention, runAttention } from './attention.js';
import { LocalAlerts } from '../local/local-alerts.js';
import { ProjectsService } from './projects.service.js';
import { VendorReadsService } from './vendor-reads.service.js';

const CACHE_MS = 60_000;

/** What needs the owner, per project; the console level sees names and counts only. */
@Injectable()
export class AttentionService {
	private readonly cache = new Map<string, { at: number; items: AttentionItem[] }>();

	constructor(
		private readonly projects: ProjectsService,
		private readonly reads: VendorReadsService,
		private readonly alerts: LocalAlerts,
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
		}
		this.cache.set(projectId, { at: Date.now(), items });
		return items;
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
