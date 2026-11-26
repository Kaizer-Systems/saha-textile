/**
 * The search change queue (outbox). Every product change asks for that product's search entry
 * to be refreshed; the row stays until the search engine has taken the change, so nothing is
 * lost while search is down. One row per product: a newer change replaces an older request.
 */
export interface SearchOutboxEntry {
	productId: string;
	/** When the latest change was asked for. A row is done only if this has not moved since. */
	changedAt: Date;
	attempts: number;
	nextAttemptAt: Date;
	lastError: string | null;
	/** Set once the search engine took the change; kept a while so a new index can replay it. */
	doneAt: Date | null;
}

export type SearchOutboxKey = Pick<SearchOutboxEntry, 'productId' | 'changedAt'>;

export interface SearchOutboxStats {
	/** Changes not yet in search. */
	waiting: number;
	/** Of those, how many have failed at least once. */
	failing: number;
	oldestWaitingAt: Date | null;
}

/** One run of the nightly comparison between the database and the search index. */
export interface SearchCheckResult {
	checkedAt: Date;
	/** Live products in the database. */
	live: number;
	/** Documents in the search index. */
	indexed: number;
	/** Live products missing from search. */
	missing: number;
	/** Documents in search for products that are no longer live. */
	extra: number;
	/** Products changed in the last day, refreshed again as a safety net. */
	recent: number;
	/** Products put back in the queue by this check. */
	requested: number;
}

export interface SearchOutboxRepository {
	/** Asks for these products' search entries to be refreshed, as of `at`. */
	request(productIds: readonly string[], at: Date): Promise<void>;
	/** Waiting rows whose next attempt is due, oldest change first. */
	due(now: Date, limit: number): Promise<SearchOutboxEntry[]>;
	/** Rows changed at or after `since`, done or not, ordered by product id after `afterProductId`. */
	changedSince(since: Date, limit: number, afterProductId?: string): Promise<SearchOutboxEntry[]>;
	/** Marks rows done, but only those whose `changedAt` still matches (a newer change stays waiting). */
	markDone(entries: readonly SearchOutboxKey[], at: Date): Promise<void>;
	/** Counts a failed attempt and sets when to try again. */
	markFailed(entries: readonly SearchOutboxKey[], error: string, now: Date): Promise<void>;
	stats(): Promise<SearchOutboxStats>;
	recordCheck(result: SearchCheckResult): Promise<void>;
	lastCheck(): Promise<SearchCheckResult | null>;
}
