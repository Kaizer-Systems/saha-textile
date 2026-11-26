import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { Injectable } from '@nestjs/common';
import {
	type DockerSnapshot,
	type Readiness,
	type ServiceStatus,
	type ServicesSnapshot,
	type ShopHealth,
} from '@saha-textile/release-console-contracts';

import { toServices } from './docker-output.js';
import { StatsCollector } from '../local/stats-collector.js';
import { RunnerClient } from '../runner/runner-client.js';

const run = promisify(execFile);

const STATES = new Set<ServiceStatus['state']>([
	'running',
	'restarting',
	'paused',
	'exited',
	'created',
	'dead',
	'removing',
]);

/** The helper's Docker figures as the Services screen's rows, for containers starting with `prefix`. */
export function servicesFromSnapshot(snapshot: DockerSnapshot, prefix: string): ServiceStatus[] {
	const stats = new Map(snapshot.stats.map((s) => [s.name, s]));
	return snapshot.containers
		.filter((c) => c.name.startsWith(prefix))
		.map((c) => {
			const s = stats.get(c.name);
			const state = STATES.has(c.state as ServiceStatus['state']) ? (c.state as ServiceStatus['state']) : 'dead';
			return {
				name: c.name,
				image: c.image,
				state,
				health: c.status.includes('(healthy)')
					? 'healthy'
					: c.status.includes('(unhealthy)')
						? 'unhealthy'
						: c.status.includes('(health: starting)')
							? 'starting'
							: 'none',
				uptime: c.status,
				cpuPercent: s?.cpuPercent ?? null,
				memoryBytes: s?.memoryBytes ?? null,
				memoryLimitBytes: s?.memoryLimitBytes ?? null,
			} satisfies ServiceStatus;
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Reads this computer's Docker containers and the shop API's readiness, through the Mac helper when
 * it answers (always so inside Docker), or with the Docker CLI directly when the console runs on the
 * Mac itself. Read-only: it changes nothing.
 */
@Injectable()
export class LocalStackService {
	constructor(
		private readonly stats: StatsCollector,
		private readonly runner: RunnerClient,
	) {}

	private readonly prefix = process.env['CONSOLE_STACK_PREFIX'] ?? 'saha-textile';
	private readonly readyUrl = process.env['CONSOLE_LOCAL_READY_URL'] ?? 'http://localhost:4000/health/ready';

	/** Containers whose names start with the repository's id (the default stack when none is given). */
	async services(repo?: string): Promise<ServicesSnapshot> {
		const prefix = repo ?? this.prefix;
		const fresh =
			this.stats.latest.docker && Date.now() - this.stats.latest.at < 15_000 ? this.stats.latest.docker : null;
		const snapshot = fresh ?? (await this.runner.call<DockerSnapshot>('GET', '/docker').catch(() => null));
		if (snapshot)
			return { environment: 'local', readAt: snapshot.at, services: servicesFromSnapshot(snapshot, prefix) };
		const opts = { timeout: 8000, maxBuffer: 4 * 1024 * 1024 };
		const [ps, stats] = await Promise.all([
			run('docker', ['ps', '-a', '--format', '{{json .}}'], opts),
			run('docker', ['stats', '--no-stream', '--format', '{{json .}}'], opts).catch(() => ({ stdout: '' })),
		]);
		return {
			environment: 'local',
			readAt: new Date().toISOString(),
			services: toServices(ps.stdout, stats.stdout, repo ?? this.prefix),
		};
	}

	/** The shop API's readiness; other repositories have no readiness address yet, so they read `unknown`. */
	async readiness(repo?: string): Promise<Readiness> {
		const checkedAt = new Date().toISOString();
		if (repo && repo !== this.prefix)
			return { environment: 'local', reachable: false, status: 'unknown', checkedAt };
		const viaHelper = await this.runner
			.call<ShopHealth>('GET', '/shop-health', undefined, 10_000)
			.catch(() => null);
		if (viaHelper) {
			const dev = viaHelper.dev;
			const body = dev?.body && typeof dev.body === 'object' ? (dev.body as Record<string, unknown>) : {};
			if (!dev) return { environment: 'local', reachable: false, status: 'down', checkedAt };
			const ok = (dev.status ?? 500) < 400;
			return {
				environment: 'local',
				reachable: true,
				status: ok ? (body['status'] === 'degraded' ? 'degraded' : 'ok') : 'down',
				checkedAt,
				detail: body,
			};
		}
		try {
			const res = await fetch(this.readyUrl, { signal: AbortSignal.timeout(4000) });
			const body: unknown = await res.json().catch(() => ({}));
			const detail = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
			const status = res.ok ? (detail['status'] === 'degraded' ? 'degraded' : 'ok') : 'down';
			return { environment: 'local', reachable: true, status, checkedAt, detail };
		} catch {
			return { environment: 'local', reachable: false, status: 'down', checkedAt };
		}
	}
}
