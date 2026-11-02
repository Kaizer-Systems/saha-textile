import { describe, expect, it } from 'vitest';

import { BullMqMediaJobQueue, startMediaWorker, type MediaQueueJob } from '../src/index.js';

/**
 * Runs against a real Redis when `RUN_REDIS_IT=1` (the mode-3 stack or `pnpm redis:up`);
 * skipped otherwise, like the Mongo integration suites.
 */
const connection = {
	host: process.env.REDIS_HOST ?? '127.0.0.1',
	port: Number(process.env.REDIS_PORT ?? 6379),
	db: 15,
};

describe.runIf(process.env.RUN_REDIS_IT === '1')('BullMQ media queue (integration)', () => {
	it('delivers an enqueued job to the matching handler, once per asset', { timeout: 20_000 }, async () => {
		const queue = new BullMqMediaJobQueue(connection);
		const seen: MediaQueueJob[] = [];
		let worker: ReturnType<typeof startMediaWorker> | undefined;
		const done = new Promise<void>((resolve) => {
			worker = startMediaWorker({
				connection,
				concurrency: 1,
				handlers: {
					process: async (job) => {
						seen.push(job);
						resolve();
					},
					reprocess: async () => {},
					'delete-objects': async () => {},
					purge: async () => {},
					gc: async () => {},
					'youtube-refresh': async () => {},
					'reprocess-stale': async () => {},
				},
			});
		});
		const assetId = `it-${Date.now()}`;
		await queue.enqueue({ type: 'process', assetId });
		await queue.enqueue({ type: 'process', assetId });
		await done;
		// Closing from inside a handler would wait on itself; close once the job has run.
		await new Promise((settle) => setTimeout(settle, 300));
		await worker?.close();
		expect(seen).toEqual([{ type: 'process', assetId }]);
		expect(await queue.ping()).toBe(true);
		await queue.close();
	});
});
