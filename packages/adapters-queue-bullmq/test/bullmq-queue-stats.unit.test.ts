import { describe, expect, it } from 'vitest';

import { BullMqQueueStats } from '../src/bullmq-queue-stats.js';

const redis = { host: 'localhost', port: 6379, db: 0 };

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
});
