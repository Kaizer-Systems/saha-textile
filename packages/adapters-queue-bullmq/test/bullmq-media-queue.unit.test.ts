import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BullMqMediaJobQueue, MEDIA_QUEUE_NAME, startMediaWorker, type MediaJobHandlers } from '../src/index.js';

const { queueCalls, queueApi, workerCalls, workerOn } = vi.hoisted(() => ({
	queueCalls: [] as unknown[][],
	queueApi: {
		add: vi.fn(async () => undefined),
		upsertJobScheduler: vi.fn(async () => undefined),
		count: vi.fn(async () => 0),
		getWorkersCount: vi.fn(async () => 2),
		close: vi.fn(async () => undefined),
	},
	workerCalls: [] as unknown[][],
	workerOn: vi.fn(),
}));

vi.mock('bullmq', () => ({
	Queue: class {
		add = queueApi.add;
		upsertJobScheduler = queueApi.upsertJobScheduler;
		count = queueApi.count;
		getWorkersCount = queueApi.getWorkersCount;
		close = queueApi.close;
		constructor(...args: unknown[]) {
			queueCalls.push(args);
		}
	},
	Worker: class {
		on = workerOn;
		constructor(...args: unknown[]) {
			workerCalls.push(args);
		}
	},
}));

const connection = { host: '127.0.0.1', port: 6379, db: 3 };

beforeEach(() => {
	queueCalls.length = 0;
	workerCalls.length = 0;
	vi.clearAllMocks();
});

describe('BullMqMediaJobQueue', () => {
	it('opens no connection until the queue is used, then reuses one', async () => {
		const queue = new BullMqMediaJobQueue(connection);
		expect(queueCalls).toHaveLength(0);
		await queue.ping();
		await queue.ping();
		expect(queueCalls).toHaveLength(1);
		expect(queueCalls[0]?.[0]).toBe(MEDIA_QUEUE_NAME);
		expect(queueCalls[0]?.[1]).toMatchObject({
			connection: { host: '127.0.0.1', port: 6379, db: 3, maxRetriesPerRequest: null },
		});
		expect((queueCalls[0]?.[1] as { connection: object }).connection).not.toHaveProperty('password');
	});

	it('passes the Redis password only when there is one', async () => {
		await new BullMqMediaJobQueue({ ...connection, password: 'test-redis-value' }).ping();
		expect(queueCalls[0]?.[1]).toMatchObject({ connection: { password: 'test-redis-value' } });
	});

	it('collapses repeat work on one asset with a stable job id', async () => {
		const queue = new BullMqMediaJobQueue(connection);
		await queue.enqueue({ type: 'process', assetId: 'a1' });
		await queue.enqueue({ type: 'reprocess', assetId: 'a1', reason: 'ladder' });
		expect(queueApi.add).toHaveBeenNthCalledWith(1, 'process', expect.anything(), { jobId: 'process-a1' });
		expect(queueApi.add).toHaveBeenNthCalledWith(2, 'reprocess', expect.anything(), {
			jobId: 'reprocess-a1-ladder',
		});
	});

	it('leaves other jobs without an id and honours a delay', async () => {
		const queue = new BullMqMediaJobQueue(connection);
		const job = { type: 'purge' as const, urls: ['https://cdn.test/a.webp'] };
		await queue.enqueue(job);
		await queue.enqueue(job, { delayMs: 500 });
		expect(queueApi.add).toHaveBeenNthCalledWith(1, 'purge', job, {});
		expect(queueApi.add).toHaveBeenNthCalledWith(2, 'purge', job, { delay: 500 });
	});

	it('registers every recurring job', async () => {
		await new BullMqMediaJobQueue(connection).registerSchedules();
		expect(queueApi.upsertJobScheduler.mock.calls.map((call: unknown[]) => call[0])).toEqual([
			'media-gc',
			'youtube-refresh',
			'reprocess-stale',
			'stock-alerts',
			'weekly-insight',
		]);
	});

	it('reports Redis as down when a queue read fails', async () => {
		const queue = new BullMqMediaJobQueue(connection);
		expect(await queue.ping()).toBe(true);
		queueApi.count.mockRejectedValueOnce(new Error('connection refused'));
		expect(await queue.ping()).toBe(false);
	});

	it('counts workers', async () => {
		expect(await new BullMqMediaJobQueue(connection).workerCount()).toBe(2);
	});

	it('closes the open queue, and closing twice is harmless', async () => {
		const queue = new BullMqMediaJobQueue(connection);
		await queue.close();
		expect(queueApi.close).not.toHaveBeenCalled();
		await queue.ping();
		await queue.close();
		await queue.close();
		expect(queueApi.close).toHaveBeenCalledTimes(1);
	});
});

describe('startMediaWorker', () => {
	const handlers = { gc: vi.fn(async () => 'collected') } as unknown as MediaJobHandlers;

	it('routes each job to the handler for its type', async () => {
		startMediaWorker({ connection, handlers, concurrency: 2 });
		const processor = workerCalls[0]?.[1] as (job: { data: { type: string } }) => Promise<unknown>;
		expect(await processor({ data: { type: 'gc' } })).toBe('collected');
		expect(workerCalls[0]?.[2]).toMatchObject({ concurrency: 2 });
	});

	it('listens for failures only when asked', () => {
		startMediaWorker({ connection, handlers, concurrency: 1 });
		expect(workerOn).not.toHaveBeenCalled();
		const onFailed = vi.fn();
		startMediaWorker({ connection, handlers, concurrency: 1, onFailed });
		expect(workerOn).toHaveBeenCalledWith('failed', onFailed);
	});
});
