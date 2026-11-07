import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { getMongoose } from '@saha-textile/adapters-db-mongo';
import type { FastifyReply } from 'fastify';
import { Public } from '../auth/session.guard';
import { READINESS_PROBES } from '../infra/tokens';
import { API_TAGS } from '../openapi-tags';
import type { ReadinessProbe } from './readiness-probe';

interface LivenessStatus {
	status: 'ok';
	service: string;
	timestamp: string;
}

interface DependencyStatus {
	name: string;
	status: 'up' | 'down';
	detail: string;
}

interface ReadinessStatus {
	status: 'ready' | 'not_ready';
	service: string;
	timestamp: string;
	dependencies: DependencyStatus[];
}

const SERVICE = 'saha-textile-api';

/** Mongoose `readyState`: 0 disconnected, 1 connected, 2 connecting, 3 disconnecting. */
const MONGO_READY_STATE_CONNECTED = 1;

@ApiTags(API_TAGS.health)
@Controller('health')
/** Liveness and readiness must answer without a session — a probe has no cookies. */
@Public()
export class HealthController {
	constructor(@Inject(READINESS_PROBES) private readonly probes: readonly ReadinessProbe[]) {}

	/**
	 * Liveness: is the PROCESS alive? Deliberately dependency-free — if this checked
	 * MongoDB, a database blip would make the orchestrator kill and restart healthy API
	 * containers, turning a recoverable outage into a crash loop.
	 */
	@Get('live')
	@ApiOperation({
		operationId: 'checkLiveness',
		summary: 'Liveness probe — process is running (no dependency checks)',
	})
	@ApiOkResponse({ description: 'Process is alive' })
	live(): LivenessStatus {
		return { status: 'ok', service: SERVICE, timestamp: new Date().toISOString() };
	}

	/**
	 * Readiness: can this instance SERVE? It reports every required dependency and fails
	 * closed with 503 when one is down, so a starting or degraded instance is pulled out
	 * of the load balancer instead of serving errors.
	 */
	@Get('ready')
	@ApiOperation({ operationId: 'checkReadiness', summary: 'Readiness probe — required dependencies are usable' })
	@ApiOkResponse({ description: 'Ready to serve traffic' })
	@ApiResponse({ status: 503, description: 'A required dependency is unavailable' })
	async ready(@Res() reply: FastifyReply): Promise<void> {
		const readyState = getMongoose().connection.readyState;
		const mongoUp = readyState === MONGO_READY_STATE_CONNECTED;
		const probed = await Promise.all(this.probes.map(async (probe) => ({ probe, result: await probe.check() })));

		const dependencies: DependencyStatus[] = [
			{
				name: 'mongodb',
				status: mongoUp ? 'up' : 'down',
				detail: mongoUp ? 'connected' : `readyState=${readyState}`,
			},
			...probed.map(({ probe, result }): DependencyStatus => ({
				name: probe.name,
				status: result.up ? 'up' : 'down',
				detail: result.detail,
			})),
		];
		const serving = mongoUp && probed.every(({ probe, result }) => result.up || !probe.required);

		const body: ReadinessStatus = {
			status: serving ? 'ready' : 'not_ready',
			service: SERVICE,
			timestamp: new Date().toISOString(),
			dependencies,
		};

		void reply.status(serving ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).send(body);
	}

	/** Backwards-compatible alias for the original probe; prefer `/health/live`. */
	@Get()
	@ApiOperation({ operationId: 'checkHealthLegacy', summary: 'Legacy health probe (alias of /health/live)' })
	check(): LivenessStatus {
		return this.live();
	}
}
