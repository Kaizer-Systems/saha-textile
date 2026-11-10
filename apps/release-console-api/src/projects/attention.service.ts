import { Injectable } from '@nestjs/common';
import type { AttentionCount, AttentionItem } from '@saha-textile/release-console-contracts';

import { keyAttention, runAttention } from './attention.js';
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
	) {}

	async forProject(projectId: string): Promise<AttentionItem[]> {
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
