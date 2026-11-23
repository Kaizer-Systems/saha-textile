import { Controller, Get, Param, Query } from '@nestjs/common';
import {
	type DbReport,
	type ServerLogs,
	type ServerState,
	dbReportSchema,
	opsJobsSchema,
	serverLogsSchema,
	serverStateSchema,
	serverTargetOf,
	sshHostOf,
} from '@saha-textile/release-console-contracts';
import { z } from 'zod';

import { KeySourceService } from '../keys/key-source.js';
import { keySlot } from '../products/products.service.js';
import { dropletSeries } from '../products/do-kit.js';
import type { ProductCtx } from '../products/kit.js';
import { ProjectsService } from '../projects/projects.service.js';
import { parseBody } from '../common/parse.js';
import { HelperError, RunnerClient } from '../runner/runner-client.js';
import { zoneFor } from '../vendors/cf-writes.js';
import { doWrites } from '../vendors/do-writes.js';

/** The console's copy of each server's ops key (OPS_TOKEN on the server). */
const OPS_KEY: Record<string, string> = {
	staging: 'CONSOLE_OPS_TOKEN_STAGING',
	production: 'CONSOLE_OPS_TOKEN_PRODUCTION',
	development: 'CONSOLE_OPS_TOKEN_DEV',
};

const last = (points: Array<[number, number]> | undefined) => points?.at(-1)?.[1] ?? null;

/**
 * A server environment's live state (Release Path brief Part 7, Q8 approved 23 Nov): no new open
 * port and no agent. Machine figures come from DigitalOcean's monitoring with the console's
 * DigitalOcean key; the shop's queues from the API's read-only /ops address with its own key;
 * containers and logs through the observer login the first-boot file adds (the Infisical chat, M9),
 * run by the Mac helper with the observer key and token kept on this Mac.
 */
@Controller('api/projects/:p/repos/:r/server-state/:env')
export class ServerStateController {
	private readonly helper = new RunnerClient();

	constructor(
		private readonly projects: ProjectsService,
		private readonly keyFile: KeySourceService,
	) {}

	/** The server's SSH host through its tunnel, for the observer login. */
	private sshHost(p: string, r: string, envName: string): string | null {
		const { repo } = this.projects.repository(p, r);
		const env = repo.environments.find((e) => e.name === envName);
		if (!env || env.cloudId === null) throw new HelperError(`${envName} does not run on a server.`, 409);
		const zones = repo.edge.find((e) => e.vendor === 'cloudflare')?.zones ?? [];
		const zone = zoneFor(env.domains[0] ?? '', zones) ?? zones[0];
		return zone ? sshHostOf(env.name, zone) : null;
	}

	/** observe.sh `logs` for one service, through the observer login (Live logs on a server tab). */
	@Get('logs')
	async logs(
		@Param('p') p: string,
		@Param('r') r: string,
		@Param('env') envName: string,
		@Query() query: unknown,
	): Promise<ServerLogs> {
		const q = parseBody(
			z.object({
				service: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,40}$/),
				since: z.coerce.number().int().min(1).max(60).default(15),
				errors: z.enum(['0', '1']).default('0'),
			}),
			query,
		);
		const host = this.sshHost(p, r, envName);
		if (!host) throw new HelperError('The repository names no Cloudflare zone for the SSH host.', 409);
		const answer = await this.helper.call<unknown>(
			'POST',
			'/server/observe',
			{
				project: p,
				environment: envName,
				host,
				request: `logs ${q.service} --since ${q.since}${q.errors === '1' ? ' --errors' : ''}`,
			},
			45_000,
		);
		const parsed = serverLogsSchema.safeParse(answer);
		if (!parsed.success) throw new HelperError('observe.sh answered in a shape the console does not know.', 502);
		return parsed.data;
	}

	/**
	 * Database monitor on a server tab (Release Path brief Q9): observe.sh `db-report` with the
	 * read-only monitor login. Answers `{ error }` when the server has no monitor login yet.
	 */
	@Get('db-report')
	async dbReport(
		@Param('p') p: string,
		@Param('r') r: string,
		@Param('env') envName: string,
	): Promise<DbReport | { error: string }> {
		const host = this.sshHost(p, r, envName);
		if (!host) throw new HelperError('The repository names no Cloudflare zone for the SSH host.', 409);
		const answer = await this.helper.call<unknown>(
			'POST',
			'/server/observe',
			{ project: p, environment: envName, host, request: 'db-report' },
			60_000,
		);
		const said = (answer as { error?: unknown } | null)?.error;
		if (typeof said === 'string') return { error: said };
		const parsed = dbReportSchema.safeParse(answer);
		if (!parsed.success) throw new HelperError('observe.sh answered in a shape the console does not know.', 502);
		return parsed.data;
	}

	/** observe.sh `containers`, through the observer login; says why when it cannot be read. */
	private async containers(p: string, r: string, envName: string): Promise<ServerState['containers']> {
		const host = this.sshHost(p, r, envName);
		if (!host)
			return { state: 'none', message: 'The repository names no Cloudflare zone for the SSH host.', items: [] };
		try {
			const answer = await this.helper.call<unknown>(
				'POST',
				'/server/observe',
				{ project: p, environment: envName, host, request: 'containers' },
				45_000,
			);
			const items = serverStateSchema.shape.containers.shape.items.safeParse(
				(answer as { containers?: unknown } | null)?.containers,
			);
			if (!items.success)
				return {
					state: 'error',
					message: 'observe.sh answered in a shape the console does not know.',
					items: [],
				};
			const restarting = items.data.filter((c) => c.state === 'restarting').length;
			const running = items.data.filter((c) => c.state === 'running').length;
			return {
				state: 'ok',
				message: `${running} running · ${restarting} restarting · through ${host}`,
				items: items.data,
			};
		} catch (err) {
			return {
				state: 'none',
				message: `The observer login did not answer: ${(err as Error).message}`,
				items: [],
			};
		}
	}

	@Get()
	async read(@Param('p') p: string, @Param('r') r: string, @Param('env') envName: string): Promise<ServerState> {
		const { project, repo } = this.projects.repository(p, r);
		const env = repo.environments.find((e) => e.name === envName);
		if (!env || env.cloudId === null) throw new HelperError(`${envName} does not run on a server.`, 409);
		const name = `${p}-${env.name}`;

		const machine = await (async (): Promise<ServerState['machine']> => {
			const none = { cpuPercent: null, memoryPercent: null, diskPercent: null };
			const slot = keySlot('digitalocean', repo, project.keys);
			const ref = project.keys.find((k) => slot?.keyIds.includes(k.id));
			const key = ref ? await this.projects.valueOf(ref) : null;
			if (!key) return { state: 'none', message: 'DigitalOcean is not connected for this repository.', ...none };
			const server = (await doWrites.dropletsTagged(key, p).catch(() => [])).find((d) => d.name === name);
			if (!server) return { state: 'none', message: `No server named ${name} yet.`, ...none };
			const series = await dropletSeries({ key, range: '1h' } as unknown as ProductCtx, String(server.id)).catch(
				() => [],
			);
			if (!series.length)
				return {
					state: 'none',
					message:
						'DigitalOcean has no figures yet: the metrics agent reports a few minutes after the first boot.',
					...none,
				};
			const of = (n: string) => last(series.find((s) => s.name === n)?.points);
			return {
				state: 'ok',
				message: `${server.name} · DigitalOcean monitoring, last minute`,
				cpuPercent: of('CPU'),
				memoryPercent: of('Memory used'),
				diskPercent: of('Disk used'),
			};
		})();

		const shop = await (async (): Promise<ServerState['shop']> => {
			const target = serverTargetOf(env.name);
			const token = target ? this.keyFile.get(OPS_KEY[target] ?? '') : null;
			const api = env.domains.find((h) => /^api[.-]/.test(h));
			if (!api) return { state: 'none', message: `${env.label} names no API host.`, queues: [] };
			if (!token)
				return {
					state: 'none',
					message: `No ops key for ${env.label} in the console's key file (${target ? OPS_KEY[target] : 'none'}).`,
					queues: [],
				};
			const res = await fetch(`https://${api}/ops/jobs`, {
				headers: { authorization: `Bearer ${token}`, 'user-agent': 'release-console' },
				signal: AbortSignal.timeout(10_000),
			}).catch(() => null);
			if (!res) return { state: 'error', message: `${api} did not answer.`, queues: [] };
			if (res.status !== 200)
				return {
					state: res.status === 404 ? 'none' : 'error',
					message:
						res.status === 404
							? `${api}/ops answered 404: OPS_TOKEN is not set on the server yet.`
							: `${api}/ops answered ${res.status}.`,
					queues: [],
				};
			const parsed = opsJobsSchema.safeParse(await res.json().catch(() => null));
			if (!parsed.success)
				return { state: 'error', message: `${api}/ops answered in an unknown shape.`, queues: [] };
			const failed = parsed.data.queues.reduce((n, q) => n + q.failed, 0);
			const waiting = parsed.data.queues.reduce((n, q) => n + q.waiting, 0);
			return {
				state: 'ok',
				message: failed ? `${failed} failed jobs` : waiting ? `${waiting} jobs waiting` : 'queues empty',
				queues: parsed.data.queues,
			};
		})();

		return {
			environment: env.name,
			machine,
			shop,
			containers: await this.containers(p, r, envName),
			readAt: new Date().toISOString(),
		};
	}
}

/**
 * The Database monitor on this Mac (Release Path brief Q9): the same db-report as the servers, run by
 * the Mac helper with the local read-only monitor login.
 */
@Controller('api/local/db-report')
export class LocalDbReportController {
	private readonly helper = new RunnerClient();

	@Get()
	async read(): Promise<DbReport | { error: string }> {
		const answer = await this.helper.call<unknown>('GET', '/inspect/monitor', undefined, 60_000);
		const said = (answer as { error?: unknown } | null)?.error;
		if (typeof said === 'string') return { error: said };
		const parsed = dbReportSchema.safeParse(answer);
		if (!parsed.success)
			throw new HelperError('The local report answered in a shape the console does not know.', 502);
		return parsed.data;
	}
}
