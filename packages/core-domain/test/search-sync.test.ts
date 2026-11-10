import type { Product } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
	checkSearchIndex,
	drainSearchOutbox,
	flushSearchChanges,
	replaySearchChanges,
	requestSearchSync,
	searchRetryDelayMs,
	type SearchSyncDeps,
} from '../src/catalog/search-sync';
import type {
	SearchCheckResult,
	SearchOutboxEntry,
	SearchOutboxRepository,
} from '../src/ports/search-outbox.repository';

/** The queue's rules, in memory: one row per product, done only if unchanged. */
function memoryOutbox() {
	const rows = new Map<string, SearchOutboxEntry>();
	let check: SearchCheckResult | null = null;
	const outbox: SearchOutboxRepository = {
		request: async (ids, at) => {
			for (const productId of ids)
				rows.set(productId, {
					productId,
					changedAt: at,
					attempts: 0,
					nextAttemptAt: at,
					lastError: null,
					doneAt: null,
				});
		},
		due: async (now, limit) =>
			[...rows.values()]
				.filter((row) => !row.doneAt && row.nextAttemptAt <= now)
				.sort((a, b) => +a.changedAt - +b.changedAt)
				.slice(0, limit),
		changedSince: async (since, limit, after) =>
			[...rows.values()]
				.filter((row) => row.changedAt >= since && (!after || row.productId > after))
				.sort((a, b) => a.productId.localeCompare(b.productId))
				.slice(0, limit),
		markDone: async (keys, at) => {
			for (const key of keys) {
				const row = rows.get(key.productId);
				if (row && +row.changedAt === +key.changedAt) row.doneAt = at;
			}
		},
		markFailed: async (keys, error, now) => {
			for (const key of keys) {
				const row = rows.get(key.productId);
				if (!row) continue;
				row.attempts += 1;
				row.lastError = error;
				row.nextAttemptAt = new Date(+now + searchRetryDelayMs(row.attempts));
			}
		},
		stats: async () => ({ waiting: 0, failing: 0, oldestWaitingAt: null }),
		recordCheck: async (result) => {
			check = result;
		},
		lastCheck: async () => check,
	};
	return { outbox, rows, lastCheck: () => check };
}

const product = (id: string, status: Product['status'] = 'live', updatedAt?: string) =>
	({ id, status, updatedAt }) as Product;

function deps(products: Record<string, Product | null>, apply = vi.fn(async () => undefined)) {
	let clock = Date.parse('2026-11-10T00:00:00Z');
	const memory = memoryOutbox();
	const d: SearchSyncDeps = {
		outbox: memory.outbox,
		loadProduct: async (id) => products[id] ?? null,
		apply,
		now: () => new Date((clock += 1000)),
	};
	return { d, apply, ...memory };
}

describe('search sync through the queue', () => {
	it('backs off from 30 seconds to at most 30 minutes', () => {
		expect([0, 1, 2, 3, 10].map(searchRetryDelayMs)).toEqual([30_000, 30_000, 60_000, 120_000, 1_800_000]);
	});

	it('queues, sends at once, indexes live products and removes the rest', async () => {
		const { d, apply, rows } = deps({ a: product('a'), b: product('b', 'draft') });
		await expect(requestSearchSync(d, ['a', 'b', 'gone', 'a'])).resolves.toEqual({
			indexed: 1,
			removed: 2,
			failed: 0,
		});
		expect(apply).toHaveBeenCalledWith([product('a')], ['b', 'gone']);
		expect([...rows.values()].every((row) => row.doneAt)).toBe(true);
		await expect(requestSearchSync(d, [])).resolves.toEqual({ indexed: 0, removed: 0, failed: 0 });
		await expect(flushSearchChanges(d, [])).resolves.toEqual({ indexed: 0, removed: 0, failed: 0 });
	});

	it('keeps a change waiting when search is down, and the worker sends it later', async () => {
		const apply = vi.fn().mockRejectedValueOnce(new Error('search down')).mockResolvedValue(undefined);
		const { d, rows } = deps({ a: product('a') }, apply);
		await expect(requestSearchSync(d, ['a'])).resolves.toEqual({ indexed: 0, removed: 0, failed: 1 });
		expect(rows.get('a')).toMatchObject({ attempts: 1, lastError: 'search down', doneAt: null });
		await expect(drainSearchOutbox(d)).resolves.toEqual({ indexed: 0, removed: 0, failed: 0 });
		rows.get('a')!.nextAttemptAt = new Date(0);
		await expect(drainSearchOutbox(d)).resolves.toEqual({ indexed: 1, removed: 0, failed: 0 });
		expect(rows.get('a')?.doneAt).toBeInstanceOf(Date);
	});

	it('never marks a newer change done by mistake', async () => {
		const { d, rows, outbox } = deps({ a: product('a') });
		await outbox.request(['a'], new Date(5));
		await outbox.markDone([{ productId: 'a', changedAt: new Date(4) }], new Date(6));
		expect(rows.get('a')?.doneAt).toBeNull();
		await expect(flushSearchChanges(d, [{ productId: 'a', changedAt: new Date(5) }])).resolves.toMatchObject({
			indexed: 1,
		});
		expect(rows.get('a')?.doneAt).toBeInstanceOf(Date);
		const failed = await flushSearchChanges({ ...d, apply: async () => Promise.reject('plain') }, [
			{ productId: 'a', changedAt: new Date(5) },
		]);
		expect(failed.failed).toBe(1);
		expect(rows.get('a')?.lastError).toBe('plain');
	});

	it('replays every change since a moment into a new index, page by page', async () => {
		const { d, apply, outbox } = deps({ a: product('a'), b: product('b'), c: product('c', 'draft') });
		await outbox.request(['old'], new Date(1));
		await outbox.request(['a', 'b', 'c'], new Date(10));
		await expect(replaySearchChanges(d, new Date(5), 2)).resolves.toBe(3);
		expect(apply).toHaveBeenNthCalledWith(1, [product('a'), product('b')], []);
		expect(apply).toHaveBeenNthCalledWith(2, [], ['c']);
		await expect(replaySearchChanges(d, new Date(50))).resolves.toBe(0);
		await outbox.request(['d', 'e'], new Date(60));
		await expect(replaySearchChanges(d, new Date(55), 2)).resolves.toBe(2);
	});
});

describe('the nightly check', () => {
	it('queues missing, extra and recently changed products, and records the run', async () => {
		const { outbox, rows, lastCheck } = memoryOutbox();
		const now = new Date('2026-11-10T03:00:00Z');
		const result = await checkSearchIndex({
			outbox,
			now: () => now,
			products: async () => [
				product('a', 'live', '2026-11-01T00:00:00Z'),
				product('b', 'live', '2026-11-09T20:00:00Z'),
				product('c', 'live'),
				product('d', 'draft', '2026-11-01T00:00:00Z'),
			],
			indexedIds: async () => ['a', 'b', 'd', 'zombie'],
		});
		expect(result).toEqual({ checkedAt: now, live: 3, indexed: 4, missing: 1, extra: 2, recent: 1, requested: 4 });
		expect([...rows.keys()].sort()).toEqual(['b', 'c', 'd', 'zombie']);
		expect(lastCheck()).toEqual(result);
	});

	it('records a clean run without queueing anything', async () => {
		const { outbox, rows } = memoryOutbox();
		const result = await checkSearchIndex({
			outbox,
			now: () => new Date(0),
			products: async () => [product('a', 'live')],
			indexedIds: async () => ['a'],
		});
		expect(result.requested).toBe(0);
		expect(rows.size).toBe(0);
	});
});
