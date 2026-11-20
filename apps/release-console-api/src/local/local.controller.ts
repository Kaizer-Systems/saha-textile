import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import {
	type AlertsView,
	type RequestsView,
	type Environment,
	type SaveSecretsResult,
	type SecretsPlace,
	type SecretsPlaces,
	type SecretsView,
	formatSecretsPlace,
	saveSecretsSchema,
	secretsQuerySchema,
	secretsSourceOf,
	type DockerSnapshot,
	type HelperStatus,
	type Job,
	type Logs,
	type MacSnapshot,
	type Series,
	type ShopHealth,
	confirmPinSchema,
	localActionSchema,
	startLocalSchema,
} from '@saha-textile/release-console-contracts';
import { z } from 'zod';

import { LocalAlerts } from './local-alerts.js';
import { RequestLog } from './request-log.js';
import { StatsCollector } from './stats-collector.js';
import { parseBody } from '../common/parse.js';
import { LockService } from '../lock/lock.service.js';
import { sessionOf } from '../lock/session.guard.js';
import { ProjectsService } from '../projects/projects.service.js';
import { HelperError, RunnerClient } from '../runner/runner-client.js';
import { ConsoleStore } from '../store/console-store.js';

type Req = Parameters<typeof sessionOf>[0];

const historyQuery = z.object({
	source: z.string().regex(/^(mac|container:saha-textile[a-z0-9_.-]*)$/),
	names: z.string().regex(/^[a-z0-9_]+(,[a-z0-9_]+)*$/),
	minutes: z.coerce.number().int().min(1).max(10080).default(60),
});
const logsQuery = z.object({
	container: z.string().regex(/^saha-textile[a-z0-9_.-]*$/),
	tail: z.coerce.number().int().min(1).max(5000).default(300),
	since: z
		.string()
		.regex(/^(\d+[smh])?$/)
		.default(''),
});

/** This Mac as an environment: its figures, Docker's, logs, history, and jobs run by the Mac helper. */
@Controller('api/local')
export class LocalController {
	constructor(
		private readonly runner: RunnerClient,
		private readonly stats: StatsCollector,
		private readonly lock: LockService,
		private readonly store: ConsoleStore,
		private readonly alerts: LocalAlerts,
		private readonly requests: RequestLog,
		private readonly projects: ProjectsService,
	) {}

	/**
	 * The place an environment's Secrets tab reads, from that environment's own "reads secrets from"
	 * setting in its repository (never from what the browser sends); anything else is refused.
	 */
	private secretsPlace(
		projectId: string,
		repositoryId: string,
		environment: string,
	): { place: SecretsPlace; env: Environment } {
		const { repo } = this.projects.repository(projectId, repositoryId);
		const env = repo.environments.find((e) => e.name === environment);
		if (!env) throw new HelperError(`${repo.name} has no environment ${environment}.`, 404);
		const source = secretsSourceOf(repo, environment);
		if (source.kind !== 'infisical')
			throw new HelperError(
				`${repo.name} · ${env.label} does not name a place in Infisical Cloud. Set where it reads its secrets in Project settings › Repositories.`,
				409,
			);
		return { place: source.place, env };
	}

	/** Per service and route: requests per minute, p50/p95/p99, error rates and Apdex, from the edge's log. */
	@Get('requests')
	requestsView(@Query() query: Record<string, unknown>): RequestsView {
		const { minutes } = parseBody(
			z.object({ minutes: z.coerce.number().int().min(5).max(10080).default(60) }),
			query,
		);
		return this.requests.view(minutes);
	}

	/**
	 * Names in one environment's Infisical place, per folder, never values, read by the Mac helper with
	 * the owner's login; `fresh` reads again instead of the last minute's answer.
	 */
	@Get('secrets')
	secrets(@Query() query: unknown): Promise<SecretsView> {
		const { projectId, repositoryId, environment, fresh } = parseBody(secretsQuerySchema, query);
		const { place } = this.secretsPlace(projectId, repositoryId, environment);
		const q = new URLSearchParams({ project: place.project, environment: place.environment, folder: place.folder });
		if (fresh) q.set('fresh', '1');
		return this.runner.call<SecretsView>('GET', `/secrets?${q.toString()}`, undefined, 190_000);
	}

	/** The name list's places and the repository it belongs to, for filling in places in one click. */
	@Get('secrets/places')
	secretsPlaces(): Promise<SecretsPlaces> {
		return this.runner.call<SecretsPlaces>('GET', '/secrets/places');
	}

	/** Local alert rules, what fires now and what ended in the last 7 days. */
	@Get('alerts')
	alertsView(): AlertsView {
		return this.alerts.view();
	}

	@Get('helper')
	async helper(): Promise<HelperStatus> {
		try {
			const h = await this.runner.call<{ root: string }>('GET', '/health', undefined, 5000);
			const devServers = await this.runner.call<Record<string, boolean>>(
				'GET',
				'/dev-servers',
				undefined,
				10_000,
			);
			return { reachable: true, root: h.root, message: 'The Mac helper is answering.', devServers };
		} catch (err) {
			return { reachable: false, root: null, message: (err as Error).message, devServers: null };
		}
	}

	@Get('mac')
	mac(): Promise<MacSnapshot> {
		const l = this.stats.latest;
		return l.mac && Date.now() - l.at < 15_000 ? Promise.resolve(l.mac) : this.runner.call('GET', '/mac');
	}

	@Get('docker')
	docker(): Promise<DockerSnapshot> {
		const l = this.stats.latest;
		return l.docker && Date.now() - l.at < 15_000 ? Promise.resolve(l.docker) : this.runner.call('GET', '/docker');
	}

	@Get('shop-health')
	shopHealth(): Promise<ShopHealth> {
		return this.runner.call('GET', '/shop-health');
	}

	@Get('logs')
	logs(@Query() query: unknown): Promise<Logs> {
		const q = parseBody(logsQuery, query);
		return this.runner.call(
			'GET',
			`/logs?container=${encodeURIComponent(q.container)}&tail=${q.tail}&since=${q.since}`,
		);
	}

	@Get('history')
	history(@Query() query: unknown): Series[] {
		const q = parseBody(historyQuery, query);
		return this.stats.history(q.source, q.names.split(','), q.minutes);
	}

	@Get('jobs')
	jobs(): Promise<Job[]> {
		return this.runner.call('GET', '/jobs');
	}

	@Get('jobs/:id')
	job(@Param('id') id: string, @Query('after') after?: string): Promise<Job> {
		if (!/^[a-z0-9-]+$/.test(id)) throw new HelperError('No such job.', 404);
		return this.runner.call('GET', `/jobs/${id}?after=${Number(after ?? 0) || 0}`);
	}

	/**
	 * Saves a batch of Secrets drafts into the environment's own Infisical place after one PIN (and,
	 * for an environment on a server, its name typed). Values pass straight through to the Mac helper,
	 * which writes only a place in the name list; the activity log gets the project, folder and names.
	 */
	@Post('secrets/save')
	@HttpCode(200)
	async saveSecrets(@Req() req: Req, @Body() body: unknown): Promise<SaveSecretsResult> {
		const { projectId, repositoryId, environment, pin, confirmName, changes } = parseBody(saveSecretsSchema, body);
		const { place, env } = this.secretsPlace(projectId, repositoryId, environment);
		if (env.cloudId !== null && confirmName.trim().toLowerCase() !== env.name.toLowerCase())
			throw new HelperError(`Type ${env.name} to confirm saving into ${formatSecretsPlace(place)}.`, 400);
		this.lock.confirm(sessionOf(req), pin, `save secrets in ${env.name}`);
		const answer = await this.runner.call<SaveSecretsResult>('POST', '/secrets/save', { place, changes }, 190_000);
		for (const r of answer.results)
			this.store.audit(
				projectId,
				r.saved ? 'secrets-saved' : 'secrets-not-saved',
				`${answer.project} · ${answer.environment} · /${r.folder}: ${r.names.join(', ')}`,
			);
		return answer;
	}

	@Post('run/:action')
	@HttpCode(202)
	async run(@Req() req: Req, @Param('action') action: string, @Body() body: unknown): Promise<Job> {
		const a = parseBody(localActionSchema, action);
		const { pin, from, only } = parseBody(startLocalSchema, body);
		this.lock.confirm(sessionOf(req), pin, a);
		const job = await this.runner.call<Job>('POST', `/run/${a}`, a === 'pipeline' ? { from, only } : {});
		this.store.audit(null, 'local-job-started', job.label);
		return job;
	}

	@Post('jobs/:id/stop')
	@HttpCode(200)
	async stop(@Req() req: Req, @Param('id') id: string, @Body() body: unknown): Promise<Job> {
		this.lock.confirm(sessionOf(req), parseBody(confirmPinSchema, body).pin, 'stop a job');
		if (!/^[a-z0-9-]+$/.test(id)) throw new HelperError('No such job.', 404);
		const job = await this.runner.call<Job>('POST', `/jobs/${id}/stop`);
		this.store.audit(null, 'local-job-stopped', job.label);
		return job;
	}
}
