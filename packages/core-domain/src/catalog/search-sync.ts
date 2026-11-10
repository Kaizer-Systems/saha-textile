import type { Product } from '@saha-textile/contracts';

import type {
	SearchCheckResult,
	SearchOutboxEntry,
	SearchOutboxKey,
	SearchOutboxRepository,
} from '../ports/search-outbox.repository';

/** How many queued changes one pass takes. */
export const SEARCH_OUTBOX_BATCH = 200;
const FIRST_RETRY_MS = 30_000;
const MAX_RETRY_MS = 30 * 60_000;
/** Products changed this recently are refreshed again by the nightly check. */
const RECENT_MS = 26 * 60 * 60_000;

/** 30 s after the first failure, doubling each time, never more than 30 minutes. */
export function searchRetryDelayMs(attempts: number): number {
	return Math.min(FIRST_RETRY_MS * 2 ** Math.max(0, attempts - 1), MAX_RETRY_MS);
}

export interface SearchSyncDeps {
	outbox: SearchOutboxRepository;
	/** The product as staff see it, or null (or undefined) when it no longer exists. */
	loadProduct(productId: string): Promise<Product | null | undefined>;
	/** Writes live products into search and removes the rest. */
	apply(live: readonly Product[], removedIds: readonly string[]): Promise<void>;
	now(): Date;
}

export interface SearchFlushResult {
	indexed: number;
	removed: number;
	failed: number;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

async function split(deps: Pick<SearchSyncDeps, 'loadProduct'>, keys: readonly Pick<SearchOutboxKey, 'productId'>[]) {
	const live: Product[] = [];
	const removed: string[] = [];
	for (const { productId } of keys) {
		const product = await deps.loadProduct(productId);
		if (product?.status === 'live') live.push(product);
		else removed.push(productId);
	}
	return { live, removed };
}

/**
 * Sends these queued changes to search. On success they are marked done; on failure they stay
 * in the queue with a later retry time, and the save that caused them is never affected.
 */
export async function flushSearchChanges(
	deps: SearchSyncDeps,
	entries: readonly SearchOutboxKey[],
): Promise<SearchFlushResult> {
	if (!entries.length) return { indexed: 0, removed: 0, failed: 0 };
	const { live, removed } = await split(deps, entries);
	try {
		await deps.apply(live, removed);
	} catch (error) {
		await deps.outbox.markFailed(entries, message(error), deps.now());
		return { indexed: 0, removed: 0, failed: entries.length };
	}
	await deps.outbox.markDone(entries, deps.now());
	return { indexed: live.length, removed: removed.length, failed: 0 };
}

/** Queues these products and tries to send them at once; what fails waits for the worker. */
export async function requestSearchSync(
	deps: SearchSyncDeps,
	productIds: readonly string[],
): Promise<SearchFlushResult> {
	const ids = [...new Set(productIds)];
	if (!ids.length) return { indexed: 0, removed: 0, failed: 0 };
	const at = deps.now();
	await deps.outbox.request(ids, at);
	return flushSearchChanges(
		deps,
		ids.map((productId) => ({ productId, changedAt: at })),
	);
}

/** One worker pass over the queue. */
export async function drainSearchOutbox(deps: SearchSyncDeps, limit = SEARCH_OUTBOX_BATCH): Promise<SearchFlushResult> {
	const due: SearchOutboxEntry[] = await deps.outbox.due(deps.now(), limit);
	return flushSearchChanges(deps, due);
}

/**
 * Replays every change made since `since` into an index, for example one just built for a new
 * search version while the old release kept taking saves. It leaves the queue's own state alone,
 * and throws on failure so a release step can stop.
 */
export async function replaySearchChanges(
	deps: Pick<SearchSyncDeps, 'outbox' | 'loadProduct' | 'apply'>,
	since: Date,
	batch = SEARCH_OUTBOX_BATCH,
): Promise<number> {
	let replayed = 0;
	let after: string | undefined;
	for (;;) {
		const rows = await deps.outbox.changedSince(since, batch, after);
		if (!rows.length) return replayed;
		const { live, removed } = await split(deps, rows);
		await deps.apply(live, removed);
		replayed += rows.length;
		after = rows[rows.length - 1]?.productId;
		if (rows.length < batch) return replayed;
	}
}

export interface SearchCheckDeps {
	outbox: SearchOutboxRepository;
	/** Every product as staff see them: id, status and when it last changed. */
	products(): Promise<readonly Pick<Product, 'id' | 'status' | 'updatedAt'>[]>;
	/** Every document id in the search index. */
	indexedIds(): Promise<readonly string[]>;
	now(): Date;
}

/**
 * The nightly safety net: compares the database with the search index, queues every
 * difference, and refreshes products changed in the last day again. The worker then repairs
 * them like any other change.
 */
export async function checkSearchIndex(deps: SearchCheckDeps): Promise<SearchCheckResult> {
	const now = deps.now();
	const products = await deps.products();
	const indexed = new Set(await deps.indexedIds());
	const live = products.filter((product) => product.status === 'live');
	const liveIds = new Set(live.map((product) => product.id));
	const missing = live.filter((product) => !indexed.has(product.id)).map((product) => product.id);
	const extra = [...indexed].filter((id) => !liveIds.has(id));
	const recent = products
		.filter((product) => product.updatedAt && now.getTime() - Date.parse(product.updatedAt) <= RECENT_MS)
		.map((product) => product.id);
	const requested = [...new Set([...missing, ...extra, ...recent])];
	if (requested.length) await deps.outbox.request(requested, now);
	const result: SearchCheckResult = {
		checkedAt: now,
		live: live.length,
		indexed: indexed.size,
		missing: missing.length,
		extra: extra.length,
		recent: recent.length,
		requested: requested.length,
	};
	await deps.outbox.recordCheck(result);
	return result;
}
