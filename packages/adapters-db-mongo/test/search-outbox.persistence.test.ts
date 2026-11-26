import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { SearchCheckModel, SearchOutboxModel } from '../src/models/index';
import { MongoSearchOutboxRepository } from '../src/repositories/search-outbox.repository';
import { MongoTransactionManager } from '../src/transaction-manager';
import { hasMongoEnv } from './mongo-test-env';

describe.skipIf(!hasMongoEnv())('search change queue (integration)', () => {
	const prefix = `prd_queue_${randomUUID().slice(0, 8)}_`;
	const id = (name: string) => `${prefix}${name}`;
	const outbox = new MongoSearchOutboxRepository();
	const checkIds: string[] = [];

	beforeAll(async () => {
		await connectMongo();
		await SearchOutboxModel.init();
	});

	afterAll(async () => {
		await SearchOutboxModel.deleteMany({ _id: { $regex: `^${prefix}` } });
		await SearchCheckModel.deleteMany({ _id: { $in: checkIds } });
		await disconnectMongo();
	});

	it('keeps one row per product, and a newer change replaces the older request', async () => {
		await outbox.request([id('a'), id('b')], new Date(1_000));
		await outbox.request([id('a')], new Date(2_000));
		await outbox.request([], new Date(3_000));
		const due = (await outbox.due(new Date(5_000), 100)).filter((row) => row.productId.startsWith(prefix));
		expect(due.map((row) => [row.productId, row.changedAt.getTime()])).toEqual([
			[id('b'), 1_000],
			[id('a'), 2_000],
		]);
	});

	it('marks done only an unchanged row, and counts failures with a later retry', async () => {
		await outbox.request([id('c')], new Date(10_000));
		await outbox.markDone([{ productId: id('c'), changedAt: new Date(9_000) }], new Date(11_000));
		await outbox.markDone([], new Date(11_000));
		expect((await SearchOutboxModel.findById(id('c')).lean())?.doneAt).toBeNull();

		await outbox.markFailed(
			[{ productId: id('c'), changedAt: new Date(10_000) }],
			'x'.repeat(600),
			new Date(20_000),
		);
		await outbox.markFailed([{ productId: id('c'), changedAt: new Date(10_000) }], 'down again', new Date(20_000));
		await outbox.markFailed([{ productId: id('c'), changedAt: new Date(1) }], 'stale', new Date(20_000));
		const row = await SearchOutboxModel.findById(id('c')).lean();
		expect(row).toMatchObject({ attempts: 2, lastError: 'down again' });
		expect(row?.nextAttemptAt.getTime()).toBe(20_000 + 60_000);
		expect((await outbox.due(new Date(21_000), 1_000)).some((entry) => entry.productId === id('c'))).toBe(false);

		const stats = await outbox.stats();
		expect(stats.waiting).toBeGreaterThanOrEqual(3);
		expect(stats.failing).toBeGreaterThanOrEqual(1);
		expect(stats.oldestWaitingAt).toBeInstanceOf(Date);

		await outbox.markDone([{ productId: id('c'), changedAt: new Date(10_000) }], new Date(30_000));
		expect((await SearchOutboxModel.findById(id('c')).lean())?.doneAt?.getTime()).toBe(30_000);
	});

	it('lists changes since a moment, done or not, in product-id pages', async () => {
		const at = new Date(Date.UTC(2099, 0, 1));
		await outbox.request([id('p1'), id('p2'), id('p3')], at);
		await outbox.markDone([{ productId: id('p2'), changedAt: at }], at);
		const first = await outbox.changedSince(at, 2);
		expect(first.map((row) => row.productId)).toEqual([id('p1'), id('p2')]);
		const next = await outbox.changedSince(at, 2, id('p2'));
		expect(next.map((row) => row.productId)).toEqual([id('p3')]);
	});

	it('joins a save transaction, so a rolled-back save leaves no request', async () => {
		const transactions = new MongoTransactionManager();
		await expect(
			transactions.withTransaction(async () => {
				await outbox.request([id('rolled-back')], new Date(1));
				throw new Error('save failed');
			}),
		).rejects.toThrow('save failed');
		expect(await SearchOutboxModel.findById(id('rolled-back')).lean()).toBeNull();
	});

	it('records each nightly check and returns the latest', async () => {
		const later = new Date(Date.UTC(2099, 5, 1));
		const result = { checkedAt: later, live: 3, indexed: 3, missing: 0, extra: 0, recent: 1, requested: 1 };
		await outbox.recordCheck({ ...result, checkedAt: new Date(Date.UTC(2099, 4, 1)) });
		await outbox.recordCheck(result);
		const rows = await SearchCheckModel.find({ checkedAt: { $gte: new Date(Date.UTC(2099, 0, 1)) } }).lean();
		checkIds.push(...rows.map((row) => row._id));
		await expect(outbox.lastCheck()).resolves.toEqual(result);
	});
});

describe.skipIf(!hasMongoEnv())('search change queue with no checks yet', () => {
	it('returns null when no check ever ran', async () => {
		await connectMongo();
		const held = await SearchCheckModel.find().lean();
		await SearchCheckModel.deleteMany({});
		try {
			await expect(new MongoSearchOutboxRepository().lastCheck()).resolves.toBeNull();
		} finally {
			if (held.length) await SearchCheckModel.insertMany(held);
			await disconnectMongo();
		}
	});
});
