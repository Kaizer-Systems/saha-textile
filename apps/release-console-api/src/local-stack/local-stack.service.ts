import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { Injectable } from '@nestjs/common';
import { type Readiness, type ServicesSnapshot } from '@saha-textile/release-console-contracts';

import { toServices } from './docker-output.js';

const run = promisify(execFile);

/** Reads this computer's Docker stack and the shop API's readiness. Read-only: it changes nothing. */
@Injectable()
export class LocalStackService {
	private readonly prefix = process.env['CONSOLE_STACK_PREFIX'] ?? 'saha-textile';
	private readonly readyUrl = process.env['CONSOLE_LOCAL_READY_URL'] ?? 'http://localhost:4000/health/ready';

	/** Containers whose names start with the repository's id (the default stack when none is given). */
	async services(repo?: string): Promise<ServicesSnapshot> {
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
