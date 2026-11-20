import type { QueueCounts, QueueStatsPort } from '@saha-textile/core-domain';
import { Queue } from 'bullmq';

import { DOCUMENT_QUEUE_NAME } from './bullmq-document-queue.js';
import { MEDIA_QUEUE_NAME, type RedisConnectionConfig } from './bullmq-media-queue.js';

/** The counts BullMQ keeps for a queue, as `getJobCounts` answers them. */
type JobCounts = Record<string, number>;

/** Opens a queue only to read its counts, then closes it. */
export type CountQueue = (name: string) => Promise<JobCounts>;

const openAndCount =
	(config: RedisConnectionConfig): CountQueue =>
	async (name) => {
		const queue = new Queue(name, {
			connection: {
				host: config.host,
				port: config.port,
				db: config.db,
				...(config.password ? { password: config.password } : {}),
				maxRetriesPerRequest: null,
			},
		});
		try {
			return await queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
		} finally {
			await queue.close();
		}
	};

/**
 * Counts of every queue the worker serves, read for the operations address. A queue Redis cannot
 * answer for is left out rather than failing the whole read.
 */
export class BullMqQueueStats implements QueueStatsPort {
	private readonly count: CountQueue;

	constructor(
		config: RedisConnectionConfig,
		private readonly names: readonly string[] = [MEDIA_QUEUE_NAME, DOCUMENT_QUEUE_NAME],
		count?: CountQueue,
	) {
		this.count = count ?? openAndCount(config);
	}

	async counts(): Promise<QueueCounts[]> {
		const out: QueueCounts[] = [];
		for (const queue of this.names) {
			try {
				const c = await this.count(queue);
				out.push({
					queue,
					waiting: c['waiting'] ?? 0,
					active: c['active'] ?? 0,
					delayed: c['delayed'] ?? 0,
					failed: c['failed'] ?? 0,
					completed: c['completed'] ?? 0,
				});
			} catch {
				// Redis did not answer for this queue: the screen shows it as unread.
			}
		}
		return out;
	}
}
