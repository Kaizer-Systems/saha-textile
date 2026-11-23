import { describe, expect, it, vi } from 'vitest';

import { BullMqQueueStats } from '../src/bullmq-queue-stats.js';

const redis = { host: 'localhost', port: 6379, db: 0 };

const queue = vi.hoisted(() => ({
	open: vi.fn(),
	getJobCounts: vi.fn<() => Promise<Record<string, number>>>(),
	close: vi.fn(async () => undefined),
}));

vi.mock('bullmq', () => ({
	Queue: class {
		getJobCounts = queue.getJobCounts;
		close = queue.close;
		constructor(...args: unknown[]) {
			queue.open(...args);
		}
	},
}));

describe('BullMqQueueStats', () => {
	it('reads each queue’s counts and leaves out one Redis cannot answer for', async () => {
		const stats = new BullMqQueueStats(redis, ['saha-textile-media', 'saha-textile-documents'], async (name) => {
			if (name === 'saha-textile-documents') throw new Error('no answer');
			return { waiting: 2, active: 1, failed: 3, completed: 40 };
		});
		expect(await stats.counts()).toEqual([
			{ queue: 'saha-textile-media', waiting: 2, active: 1, delayed: 0, failed: 3, completed: 40 },
		]);
	});

	it('serves the media and document queues by default', async () => {
		const asked: string[] = [];
		await new BullMqQueueStats(redis, undefined, async (name) => {
			asked.push(name);
			return {};
		}).counts();
		expect(asked).toEqual(['saha-textile-media', 'saha-textile-documents']);
	});

	it.each([undefined, 'test-redis-value'])(
		'closes each connection after reading Redis (password %s)',
		async (password) => {
			vi.clearAllMocks();
			queue.getJobCounts.mockResolvedValueOnce({ delayed: 3 }).mockRejectedValueOnce(new Error('no answer'));
			const stats = new BullMqQueueStats({ ...redis, password }, ['available', 'unavailable']);
			expect(await stats.counts()).toEqual([
				{ queue: 'available', waiting: 0, active: 0, delayed: 3, failed: 0, completed: 0 },
			]);
			const connection = { ...redis, ...(password ? { password } : {}), maxRetriesPerRequest: null };
			expect(queue.open).toHaveBeenNthCalledWith(1, 'available', { connection });
			expect(queue.open).toHaveBeenNthCalledWith(2, 'unavailable', { connection });
			expect(queue.getJobCounts).toHaveBeenCalledWith('waiting', 'active', 'delayed', 'failed', 'completed');
			expect(queue.close).toHaveBeenCalledTimes(2);
		},
	);
});
