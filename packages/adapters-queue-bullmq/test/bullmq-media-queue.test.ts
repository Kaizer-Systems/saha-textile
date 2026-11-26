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
					'weekly-insight': async () => {},
					'stock-alerts': async () => {},
					'product-videos-check': async () => {},
					'search-outbox': async () => {},
					'search-check': async () => {},
					'trash-purge': async () => {},
					'upload-sweep': async () => {},
					'cut-sweep': async () => {},
					cut: async () => {},
					'drop-cut': async () => {},
					replace: async () => {},
					'kept-files-sweep': async () => {},
					'spaces-check': async () => {},
					'zip-sweep': async () => {},
					zip: async () => {},
					'page-go-live-waiting': async () => {},
					'word-spots': async () => {},
					'page-builder-nightly': async () => {},
					'page-warm': async () => {},
					'fx-fetch-due': async () => {},
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

	it('runs a second reprocess of the same picture once the first has finished', { timeout: 20_000 }, async () => {
		const queue = new BullMqMediaJobQueue(connection);
		const assetId = `it-again-${Date.now()}`;
		let runs = 0;
		let release: () => void = () => {};
		const idle = async () => {};
		const worker = startMediaWorker({
			connection,
			concurrency: 1,
			handlers: {
				process: idle,
				reprocess: async () => {
					runs += 1;
					release();
				},
				'delete-objects': idle,
				purge: idle,
				gc: idle,
				'youtube-refresh': idle,
				'reprocess-stale': idle,
				'weekly-insight': idle,
				'stock-alerts': idle,
				'product-videos-check': idle,
				'search-outbox': idle,
				'search-check': idle,
				'trash-purge': idle,
				'upload-sweep': idle,
				'cut-sweep': idle,
				cut: idle,
				'drop-cut': idle,
				replace: idle,
				'kept-files-sweep': idle,
				'spaces-check': idle,
				'zip-sweep': idle,
				zip: idle,
				'page-go-live-waiting': idle,
				'word-spots': idle,
				'page-builder-nightly': idle,
				'page-warm': idle,
				'fx-fetch-due': idle,
			},
		});
		const ran = () => new Promise<void>((resolve) => (release = resolve));
		let next = ran();
		await queue.enqueue({ type: 'reprocess', assetId, reason: 'manual' });
		await next;
		await new Promise((settle) => setTimeout(settle, 300));
		next = ran();
		await queue.enqueue({ type: 'reprocess', assetId, reason: 'manual' });
		await next;
		await new Promise((settle) => setTimeout(settle, 300));
		await worker.close();
		expect(runs).toBe(2);
		await queue.close();
	});
});
