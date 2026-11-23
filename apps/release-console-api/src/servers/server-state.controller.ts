import { Controller, Get, Param } from '@nestjs/common';
import { type ServerState, opsJobsSchema, serverTargetOf } from '@saha-textile/release-console-contracts';

import { KeySourceService } from '../keys/key-source.js';
import { keySlot } from '../products/products.service.js';
import { dropletSeries } from '../products/do-kit.js';
import type { ProductCtx } from '../products/kit.js';
import { ProjectsService } from '../projects/projects.service.js';
import { HelperError } from '../runner/runner-client.js';
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
 * containers and logs wait for the observer login the first-boot file adds (the Infisical chat, M9).
 */
@Controller('api/projects/:p/repos/:r/server-state/:env')
export class ServerStateController {
	constructor(
		private readonly projects: ProjectsService,
		private readonly keyFile: KeySourceService,
	) {}

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
			containers: {
				state: 'waiting',
				message:
					'Containers and their logs come through the read-only observer login, which the first-boot file adds to each server (the deploy-side work, M9).',
			},
			readAt: new Date().toISOString(),
		};
	}
}
