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
	| { type: 'product-videos-check' }
	| { type: 'stock-alerts' }
	/** Sends waiting search changes (the search change queue). */
	| { type: 'search-outbox' }
	/** Compares the database with the search index and queues any difference. */
	| { type: 'search-check' }
	/** Removes for good what has been in the Media page's Trash for 30 days. */
	| { type: 'trash-purge' }
	/** Removes uploads still waiting for their bytes a day after they started. */
	| { type: 'upload-sweep' }
	/** Deletes files kept after a Replace once their 7 days are over (decision 11). */
	| { type: 'kept-files-sweep' }
	/** The nightly Spaces check (R5-5): missing pictures the website uses, files no record knows. */
	| { type: 'spaces-check' }
	/** Deletes .zip downloads past their 24 hours, and cancelled or failed ones (media step 5). */
	| { type: 'zip-sweep' }
	/** Page Builder Go Lives waiting for pictures still being made (E5): each goes once they are ready. */
	| { type: 'page-go-live-waiting' }
	/** Page Builder nightly check (SG-12) and History upkeep (Q12: last 20 Go Lives, drafts for 30 days). */
	| { type: 'page-builder-nightly' }
	/** The daily exchange-rate fetch, checked every 15 minutes against the time set in Admin › Currencies. */
	| { type: 'fx-fetch-due' };
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
	// One warm per page and switch moment, however often the schedule is saved (Page Builder FX-8).
	if (job.type === 'page-warm') return `page-warm-${job.pageType}-${Date.parse(job.at)}`;
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

	/**
	 * For the readiness probe. Bounded here because this connection waits for Redis forever by
	 * design (`maxRetriesPerRequest: null`), and a probe must answer.
	 */
	async isReachable(timeoutMs = 1500): Promise<boolean> {
		let timer: NodeJS.Timeout | undefined;
		const expired = new Promise<boolean>((done) => {
			timer = setTimeout(() => done(false), timeoutMs);
		});
		const answered = this.queue.count().then(
			() => true,
			() => false,
		);
		try {
			return await Promise.race([answered, expired]);
		} finally {
			clearTimeout(timer);
		}
	}

	async enqueue(job: MediaJob, options?: { delayMs?: number }): Promise<void> {
		const jobId = jobIdFor(job);
		// The stable id folds a request into one still waiting or running. A finished job keeps
		// its id for a day of history, which would silently swallow the next reprocess of the
		// same picture (the admin's Reprocess button would work once a day), so a finished or
		// failed reprocess is cleared first and the new one runs.
		if (jobId && job.type === 'reprocess') {
			const earlier = await this.queue.getJob(jobId);
			if (earlier && ((await earlier.isCompleted()) || (await earlier.isFailed()))) await earlier.remove();
		}
		await this.queue.add(job.type, job, {
			...(jobId ? { jobId } : {}),
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
		// Product videos made private or deleted on YouTube since they were added (Mondays 04:30 IST).
		await this.queue.upsertJobScheduler(
			'product-videos-check',
			{ pattern: '30 4 * * 1', tz },
			{ name: 'product-videos-check', data: { type: 'product-videos-check' } },
		);
		// Search changes that could not be sent at save time wait here; 30 s keeps search close.
		await this.queue.upsertJobScheduler(
			'search-outbox',
			{ every: 30_000 },
			{ name: 'search-outbox', data: { type: 'search-outbox' } },
		);
		// The nightly safety net for search, before the media GC (03:00 IST).
		await this.queue.upsertJobScheduler(
			'search-check',
			{ pattern: '0 3 * * *', tz },
			{ name: 'search-check', data: { type: 'search-check' } },
		);
		// The Media page's Trash: items 30 days old go for good (03:45 IST, after the media GC).
		await this.queue.upsertJobScheduler(
			'trash-purge',
			{ pattern: '45 3 * * *', tz },
			{ name: 'trash-purge', data: { type: 'trash-purge' } },
		);
		// Uploads never finished (a closed tab, a lost line): gone after a day (03:50 IST).
		await this.queue.upsertJobScheduler(
			'upload-sweep',
			{ pattern: '50 3 * * *', tz },
			{ name: 'upload-sweep', data: { type: 'upload-sweep' } },
		);
		// Files kept 7 days after a Replace (decision 11): deleted once due (03:55 IST).
		await this.queue.upsertJobScheduler(
			'kept-files-sweep',
			{ pattern: '55 3 * * *', tz },
			{ name: 'kept-files-sweep', data: { type: 'kept-files-sweep' } },
		);
		// The nightly Spaces check, after the clean-ups so it sees what they left (04:15 IST).
		await this.queue.upsertJobScheduler(
			'spaces-check',
			{ pattern: '15 4 * * *', tz },
			{ name: 'spaces-check', data: { type: 'spaces-check' } },
		);
		// .zip downloads end 24 hours after they are ready: checked every hour.
		await this.queue.upsertJobScheduler(
			'zip-sweep',
			{ every: 60 * 60_000 },
			{ name: 'zip-sweep', data: { type: 'zip-sweep' } },
		);
		await this.queue.upsertJobScheduler(
			'weekly-insight',
			{ pattern: '0 4 * * 1', tz },
			{ name: 'weekly-insight', data: { type: 'weekly-insight' } },
		);
		// A Go Live waiting for a picture goes within a minute of it being ready (Page Builder E5).
		await this.queue.upsertJobScheduler(
			'page-go-live-waiting',
			{ every: 60_000 },
			{ name: 'page-go-live-waiting', data: { type: 'page-go-live-waiting' } },
		);
		// Live and scheduled layouts checked again, then History kept to its limits (04:30 IST, after the
		// nightly Spaces check, so a picture it found gone is caught too).
		await this.queue.upsertJobScheduler(
			'page-builder-nightly',
			{ pattern: '30 4 * * *', tz },
			{ name: 'page-builder-nightly', data: { type: 'page-builder-nightly' } },
		);
		// Exchange rates (shipping rules brief fx01): the fetch time is set in the admin, so the job only
		// checks every 15 minutes whether today's fetch is due; a missed time catches up.
		await this.queue.upsertJobScheduler(
			'fx-fetch-due',
			{ every: 15 * 60_000 },
			{ name: 'fx-fetch-due', data: { type: 'fx-fetch-due' } },
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
