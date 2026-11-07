import type { MediaJob, MediaJobQueuePort } from '@saha-textile/core-domain';
import { type Job, Queue, Worker } from 'bullmq';

/** One queue for all media background work; job names are the job `type`. */
export const MEDIA_QUEUE_NAME = 'saha-textile-media';

export interface RedisConnectionConfig {
	host: string;
	port: number;
	password?: string;
	db: number;
}

/** Jobs that run on a schedule rather than on demand. */
export type ScheduledMediaJob =
	| { type: 'gc' }
	| { type: 'youtube-refresh' }
	| { type: 'reprocess-stale' }
	| { type: 'weekly-insight' }
	| { type: 'stock-alerts' };
export type MediaQueueJob = MediaJob | ScheduledMediaJob;

const connectionOptions = (config: RedisConnectionConfig) => ({
	host: config.host,
	port: config.port,
	db: config.db,
	...(config.password ? { password: config.password } : {}),
	// Required by BullMQ workers: a blocking command must wait for Redis, not give up.
	maxRetriesPerRequest: null,
});

/**
 * Retries with backoff, and bounded history: completed jobs are kept a day for debugging,
 * failed ones a week, so Redis (`noeviction`, AOF everysec) never grows without bound.
 */
const DEFAULT_JOB_OPTIONS = {
	attempts: 5,
	backoff: { type: 'exponential', delay: 10_000 },
	removeOnComplete: { age: 86_400, count: 2_000 },
	removeOnFail: { age: 7 * 86_400 },
} as const;

/**
 * A stable id per asset, so a double-clicked "finalize" or a reprocess requested while one
 * is still waiting collapses into a single job. Separators are `-`: BullMQ reserves `:`.
 */
const jobIdFor = (job: MediaQueueJob): string | undefined => {
	if (job.type === 'process') return `process-${job.assetId}`;
	if (job.type === 'reprocess') return `reprocess-${job.assetId}-${job.reason}`;
	return undefined;
};

/** BullMQ implementation of `MediaJobQueuePort`, used by the API to hand work to the worker. */
export class BullMqMediaJobQueue implements MediaJobQueuePort {
	private instance: Queue<MediaQueueJob> | null = null;

	constructor(private readonly config: RedisConnectionConfig) {}

	/**
	 * Connects on first use, not at construction: an API process that never touches media
	 * (a test, a docs build, a developer without Redis) must not open — and retry — a Redis
	 * connection just because the provider was composed.
	 */
	private get queue(): Queue<MediaQueueJob> {
		this.instance ??= new Queue<MediaQueueJob>(MEDIA_QUEUE_NAME, {
			connection: connectionOptions(this.config),
			defaultJobOptions: DEFAULT_JOB_OPTIONS,
		});
		return this.instance;
	}

	async enqueue(job: MediaJob, options?: { delayMs?: number }): Promise<void> {
		await this.queue.add(job.type, job, {
			...(jobIdFor(job) ? { jobId: jobIdFor(job) } : {}),
			...(options?.delayMs ? { delay: options.delayMs } : {}),
		});
	}

	/**
	 * Registers the recurring jobs. Idempotent (`upsertJobScheduler`), so every worker boot
	 * re-asserts the same schedule and an edited cron simply replaces the old one.
	 *
	 * - media GC daily at 03:30 IST, outside shopping hours;
	 * - YouTube rail refresh daily at 00:00 IST (owner lock);
	 * - stale-derivative sweep every 15 minutes, which finishes reprocessing a ladder edit in
	 *   bounded batches instead of one giant job.
	 */
	async registerSchedules(): Promise<void> {
		const tz = 'Asia/Kolkata';
		await this.queue.upsertJobScheduler(
			'media-gc',
			{ pattern: '30 3 * * *', tz },
			{ name: 'gc', data: { type: 'gc' } },
		);
		await this.queue.upsertJobScheduler(
			'youtube-refresh',
			{ pattern: '0 0 * * *', tz },
			{ name: 'youtube-refresh', data: { type: 'youtube-refresh' } },
		);
		await this.queue.upsertJobScheduler(
			'reprocess-stale',
			{ every: 15 * 60_000 },
			{ name: 'reprocess-stale', data: { type: 'reprocess-stale' } },
		);
		await this.queue.upsertJobScheduler(
			'stock-alerts',
			{ every: 15 * 60_000 },
			{ name: 'stock-alerts', data: { type: 'stock-alerts' } },
		);
		await this.queue.upsertJobScheduler(
			'weekly-insight',
			{ pattern: '0 4 * * 1', tz },
			{ name: 'weekly-insight', data: { type: 'weekly-insight' } },
		);
	}

	/** Liveness for `/health`: true when Redis answers a queue read. */
	async ping(): Promise<boolean> {
		try {
			await this.queue.count();
			return true;
		} catch {
			return false;
		}
	}

	/** How many worker processes are consuming — zero means uploads will sit in `queued`. */
	async workerCount(): Promise<number> {
		return this.queue.getWorkersCount();
	}

	async close(): Promise<void> {
		await this.instance?.close();
		this.instance = null;
	}
}

export type MediaJobHandlers = {
	[K in MediaQueueJob['type']]: (job: Extract<MediaQueueJob, { type: K }>) => Promise<unknown>;
};

/**
 * Starts the worker process's consumer. `concurrency` stays low (2) on the shared droplet so
 * an upload burst can never starve the storefront's SSR (owner lock, droplet sizing).
 */
export const startMediaWorker = (input: {
	connection: RedisConnectionConfig;
	handlers: MediaJobHandlers;
	concurrency: number;
	onFailed?: (job: Job<MediaQueueJob> | undefined, error: Error) => void;
}): Worker<MediaQueueJob> => {
	const worker = new Worker<MediaQueueJob>(
		MEDIA_QUEUE_NAME,
		async (job) => {
			const data = job.data;
			const handler = input.handlers[data.type] as (payload: MediaQueueJob) => Promise<unknown>;
			return handler(data);
		},
		{ connection: connectionOptions(input.connection), concurrency: input.concurrency },
	);
	if (input.onFailed) worker.on('failed', input.onFailed);
	return worker;
};
