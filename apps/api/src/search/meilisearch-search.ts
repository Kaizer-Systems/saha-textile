import type { Product } from '@saha-textile/contracts';
import {
	SEARCH_STOP_WORDS,
	SearchUnavailableError,
	type Paginated,
	type SearchEntry,
	type SearchPort,
	type SearchQuery,
} from '@saha-textile/core-domain';

import { listingDocument } from './listing-document';
import { SEARCH_INDEX_VERSION, versionedIndex } from './search-index-version';

/** A hung index must not hold a page open. */
const REQUEST_TIMEOUT_MS = 2000;
/**
 * Indexing runs in the background on Meilisearch. A wait ends on success, on a failed task, or
 * when the engine reports no progress for this long; never on a stopwatch, because a large
 * catalogue legitimately takes minutes.
 */
const STALL_MS = 60_000;
const TASK_POLL_MS = 100;
const TASK_POLL_MAX_MS = 1000;
const BATCH = 500;

/** For callers that only write to the index and never turn search hits into products. */
export const noProductsLoaded = async (): Promise<Product[]> => [];

/** A missing index or document. Still "unavailable" to every caller that does not ask. */
class SearchNotFoundError extends SearchUnavailableError {}

/** Whether the index this release reads has been completely built. */
export type SearchBuildState = 'ready' | 'missing';

/** What the index remembers about its own build. */
export interface SearchBuildRecord {
	/** When the build began; changes saved from then on are replayed into it. */
	startedAt: string;
	/** The last replay of queued changes into this index. */
	caughtUpAt: string | null;
}

const PAGE = 1000;

/** The HTTP side of the index, shared by search and listings. */
export interface MeilisearchClient {
	readonly index: string;
	multiSearch<T>(queries: readonly Record<string, unknown>[]): Promise<T[]>;
}

/**
 * Meilisearch behind `SearchPort`. Prices shown to a shopper are loaded from Mongo after the ids
 * come back; the index holds what filtering and sorting need. A down index throws
 * `SearchUnavailableError` and never falls through to a Mongo text query.
 */
export class MeilisearchSearch implements SearchPort, MeilisearchClient {
	private settingsApplied = false;
	/** The admin's search words as synonyms, kept so a rebuilt index starts with them. */
	private synonyms: Readonly<Record<string, readonly string[]>> | null = null;
	/** The index this code reads: the configured name plus the search version, e.g. `products_v1`. */
	readonly index: string;
	/** Records which versions finished building, so a release can skip a rebuild it does not need. */
	private readonly builds: string;

	constructor(
		private readonly host: string | undefined,
		private readonly apiKey: string | undefined,
		private readonly loadProducts: (ids: readonly string[]) => Promise<Product[]>,
		private readonly baseIndex: string,
		private readonly locales: readonly string[],
	) {
		this.index = versionedIndex(baseIndex);
		this.builds = `${baseIndex}_builds`;
	}

	async indexProduct(entry: SearchEntry): Promise<void> {
		await this.indexProducts([entry]);
	}

	async indexProducts(entries: readonly SearchEntry[]): Promise<void> {
		if (!entries.length) return;
		await this.ensureSettings();
		for (let start = 0; start < entries.length; start += BATCH) {
			const documents = entries.slice(start, start + BATCH).map((entry) => listingDocument(entry, this.locales));
			await this.send(`/indexes/${this.index}/documents`, 'POST', documents);
		}
	}

	/** Query-time only: no document is rewritten, so this is quick at any catalogue size. */
	async updateSynonyms(synonyms: Readonly<Record<string, readonly string[]>>): Promise<void> {
		this.synonyms = synonyms;
		await this.ensureSettings();
		const task = await this.send<{ taskUid: number }>(`/indexes/${this.index}/settings/synonyms`, 'PUT', synonyms);
		await this.waitFor(task.taskUid);
	}

	/**
	 * `ready` when this version's index exists and its build was recorded as complete. A release
	 * whose search version is unchanged finds it ready and skips the rebuild.
	 */
	async buildState(): Promise<SearchBuildState> {
		try {
			await this.send(`/indexes/${this.index}`, 'GET');
			const record = await this.send<{ status?: string }>(
				`/indexes/${this.builds}/documents/v${SEARCH_INDEX_VERSION}`,
				'GET',
			);
			return record.status === 'complete' ? 'ready' : 'missing';
		} catch (error) {
			if (error instanceof SearchNotFoundError) return 'missing';
			throw error;
		}
	}

	/** Cheap work for a release that keeps the search version: settings only, no documents. */
	async applyCurrentSettings(): Promise<void> {
		await this.applySettings(this.index);
		this.settingsApplied = true;
	}

	/**
	 * Builds this version's index beside any copy of it and swaps them, so shoppers never see an
	 * empty or half-filled list. Applying settings creates an index that does not exist yet, and
	 * the swap needs both to exist. The build is recorded as complete only after the swap, and
	 * versions older than the previous one are removed: the previous one stays for a rollback.
	 */
	async replaceIndex(entries: readonly SearchEntry[]): Promise<void> {
		const startedAt = new Date().toISOString();
		const next = `${this.index}_next`;
		await this.applySettings(this.index);
		await this.applySettings(next);
		this.settingsApplied = true;
		let task = await this.send<{ taskUid: number }>(`/indexes/${next}/documents`, 'DELETE');
		for (let start = 0; start < entries.length; start += BATCH) {
			const documents = entries.slice(start, start + BATCH).map((entry) => listingDocument(entry, this.locales));
			task = await this.send<{ taskUid: number }>(`/indexes/${next}/documents`, 'POST', documents);
		}
		await this.waitFor(task.taskUid);
		const swap = await this.send<{ taskUid: number }>('/swap-indexes', 'POST', [{ indexes: [this.index, next] }]);
		await this.waitFor(swap.taskUid);
		const removal = await this.send<{ taskUid: number }>(`/indexes/${next}`, 'DELETE');
		await this.waitFor(removal.taskUid);
		const record = await this.send<{ taskUid: number }>(`/indexes/${this.builds}/documents?primaryKey=id`, 'POST', [
			{
				id: `v${SEARCH_INDEX_VERSION}`,
				status: 'complete',
				documents: entries.length,
				startedAt,
				caughtUpAt: null,
				builtAt: new Date().toISOString(),
			},
		]);
		await this.waitFor(record.taskUid);
		await this.removeOldVersions();
	}

	/** This version's build record, or null when it was never recorded (or the index is missing). */
	async buildRecord(): Promise<SearchBuildRecord | null> {
		try {
			const row = await this.send<{ startedAt?: string; caughtUpAt?: string | null }>(
				`/indexes/${this.builds}/documents/v${SEARCH_INDEX_VERSION}`,
				'GET',
			);
			return row.startedAt ? { startedAt: row.startedAt, caughtUpAt: row.caughtUpAt ?? null } : null;
		} catch (error) {
			if (error instanceof SearchNotFoundError) return null;
			throw error;
		}
	}

	/** Notes that queued changes up to `at` are now in this index. */
	async recordCatchUp(at: Date): Promise<void> {
		const task = await this.send<{ taskUid: number }>(`/indexes/${this.builds}/documents?primaryKey=id`, 'PUT', [
			{ id: `v${SEARCH_INDEX_VERSION}`, caughtUpAt: at.toISOString() },
		]);
		await this.waitFor(task.taskUid);
	}

	/** Every document id in this index, for the nightly comparison with the database. */
	async indexedIds(): Promise<string[]> {
		const ids: string[] = [];
		for (let offset = 0; ; offset += PAGE) {
			const page = await this.send<{ results?: Array<{ id?: string }> }>(
				`/indexes/${this.index}/documents?fields=id&limit=${PAGE}&offset=${offset}`,
				'GET',
			);
			const rows = page.results ?? [];
			ids.push(...rows.flatMap((row) => (row.id ? [row.id] : [])));
			if (rows.length < PAGE) return ids;
		}
	}

	/** Writes live products and removes the rest, waiting until search has taken them. */
	async applyChanges(entries: readonly SearchEntry[], removedIds: readonly string[]): Promise<void> {
		await this.ensureSettings();
		let last: number | null = null;
		for (let start = 0; start < entries.length; start += BATCH) {
			const documents = entries.slice(start, start + BATCH).map((entry) => listingDocument(entry, this.locales));
			last = (await this.send<{ taskUid: number }>(`/indexes/${this.index}/documents`, 'POST', documents))
				.taskUid;
		}
		if (removedIds.length) {
			const removal = await this.send<{ taskUid: number }>(
				`/indexes/${this.index}/documents/delete-batch`,
				'POST',
				removedIds,
			);
			last = removal.taskUid;
		}
		if (last !== null) await this.waitFor(last);
	}

	/** Deletes versions older than the previous one, and any half-built copy left by a failed run. */
	private async removeOldVersions(): Promise<void> {
		const listed = await this.send<{ results?: Array<{ uid?: string }> }>('/indexes?limit=1000', 'GET');
		const pattern = new RegExp(`^${this.baseIndex.replace(/[-]/g, '\\-')}_v(\\d+)(_next)?$`);
		for (const { uid } of listed.results ?? []) {
			const match = uid ? pattern.exec(uid) : null;
			if (!match || !uid) continue;
			const version = Number(match[1]);
			const halfBuilt = !!match[2] && version !== SEARCH_INDEX_VERSION;
			if (version < SEARCH_INDEX_VERSION - 1 || halfBuilt) {
				const task = await this.send<{ taskUid: number }>(`/indexes/${uid}`, 'DELETE');
				await this.waitFor(task.taskUid);
			}
		}
	}

	/** For the readiness probe. An authenticated read, so it proves the key as well as the host. */
	async indexStatus(): Promise<{ up: boolean; detail: string }> {
		if (!this.host) return { up: false, detail: 'not configured' };
		try {
			await this.send(`/indexes/${this.index}`, 'GET');
			return { up: true, detail: 'index ready' };
		} catch {
			return { up: false, detail: 'unavailable or index missing' };
		}
	}

	async removeProduct(productId: string): Promise<void> {
		await this.send(`/indexes/${this.index}/documents/${encodeURIComponent(productId)}`, 'DELETE');
	}

	async multiSearch<T>(queries: readonly Record<string, unknown>[]): Promise<T[]> {
		const body = await this.send<{ results?: T[] }>('/multi-search', 'POST', { queries });
		return body.results ?? [];
	}

	async search(query: SearchQuery): Promise<Paginated<Product>> {
		// The request sorts by `rankFirst`, which the index refuses until its settings allow it.
		await this.ensureSettings();
		const page = query.page && query.page > 0 ? query.page : 1;
		const pageSize = query.pageSize && query.pageSize > 0 ? query.pageSize : 24;
		const body = await this.send<{ hits?: Array<{ id?: string }>; estimatedTotalHits?: number }>(
			`/indexes/${this.index}/search`,
			'POST',
			{
				q: query.q,
				offset: (page - 1) * pageSize,
				limit: pageSize,
				// Storefront settings' "show first" categories lead when the words fit equally.
				sort: ['rankFirst:asc'],
				...(query.categoryId ? { filter: `categoryIds = ${JSON.stringify(query.categoryId)}` } : {}),
			},
		);
		const ids = (body.hits ?? []).map((hit) => hit.id).filter((id): id is string => !!id);
		const found = await this.loadProducts(ids);
		const byId = new Map(found.map((product) => [product.id, product]));
		return {
			items: ids.flatMap((id) => {
				const product = byId.get(id);
				return product && product.status === 'live' ? [product] : [];
			}),
			total: body.estimatedTotalHits ?? ids.length,
			page,
			pageSize,
		};
	}

	private async ensureSettings(): Promise<void> {
		if (this.settingsApplied) return;
		await this.applySettings(this.index);
		this.settingsApplied = true;
	}

	private async applySettings(index: string): Promise<void> {
		const task = await this.send<{ taskUid: number }>(`/indexes/${index}/settings`, 'PATCH', {
			// Order is rank: the name, then the admin's search words, then the facts, then the description.
			searchableAttributes: ['words', 'searchTerms', 'facts', 'description'],
			// A word in the title beats the same word further down, before closeness is weighed.
			// `sort` sits after typos so a search's "show first" order applies only among equal fits;
			// a listing has no words, so its own sort is untouched.
			rankingRules: ['words', 'typo', 'sort', 'attribute', 'proximity', 'exactness'],
			displayedAttributes: ['id'],
			filterableAttributes: ['categoryIds', 'terms', 'filterCodes', 'facetValues', 'minINR', 'maxINR', 'rating'],
			sortableAttributes: [
				'idOrder',
				'createdOrder',
				'minINR',
				'percentOff',
				'rankFirst',
				...this.locales.map((locale) => `titleOrder.${locale}`),
			],
			// Left out until known, so a first product save never wipes the admin's list.
			...(this.synonyms ? { synonyms: this.synonyms } : {}),
			stopWords: [...SEARCH_STOP_WORDS],
			// Weave names are short, so a typo in a four-letter word still has to find it.
			typoTolerance: { minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 } },
			searchCutoffMs: 150,
			faceting: { maxValuesPerFacet: 10_000, sortFacetValuesBy: { '*': 'alpha' } },
			pagination: { maxTotalHits: 1_000_000 },
		});
		await this.waitFor(task.taskUid);
	}

	/**
	 * Waits for a task by the engine's own progress: finished tasks and the running batch's
	 * percentage. It fails at once on a failed task and after `STALL_MS` without any movement.
	 */
	private async waitFor(taskUid: number): Promise<void> {
		let lastMove = Date.now();
		let lastSeen = '';
		let pause = TASK_POLL_MS;
		for (;;) {
			const task = await this.send<{
				status?: string;
				indexUid?: string | null;
				error?: { message?: string } | null;
			}>(`/tasks/${taskUid}`, 'GET');
			if (task.status === 'succeeded') return;
			if (task.status === 'failed' || task.status === 'canceled') {
				const reason = task.error?.message ? `: ${task.error.message}` : '';
				throw new SearchUnavailableError(
					`The search index did not finish updating (task ${task.status}${reason})`,
				);
			}
			const seen = `${task.status ?? ''}|${await this.progress(task.indexUid ?? null)}`;
			if (seen !== lastSeen) {
				lastSeen = seen;
				lastMove = Date.now();
			} else if (Date.now() - lastMove > STALL_MS) {
				throw new SearchUnavailableError(
					'The search index did not finish updating: no progress for 60 seconds',
				);
			}
			await new Promise((done) => setTimeout(done, pause));
			pause = Math.min(TASK_POLL_MAX_MS, pause * 2);
		}
	}

	/** A fingerprint that changes whenever the engine moves: the newest finished task and the running batch's percentage. */
	private async progress(indexUid: string | null): Promise<string> {
		const scope = indexUid ? `&indexUids=${encodeURIComponent(indexUid)}` : '';
		const done = await this.send<{ results?: Array<{ uid?: number }> }>(
			`/tasks?statuses=succeeded,failed,canceled&limit=1${scope}`,
			'GET',
		);
		const running = await this.send<{ results?: Array<{ progress?: { percentage?: number } | null }> }>(
			'/batches?statuses=processing&limit=1',
			'GET',
		);
		return `${done.results?.[0]?.uid ?? ''}|${running.results?.[0]?.progress?.percentage ?? ''}`;
	}

	private async send<T>(path: string, method: string, body?: unknown): Promise<T> {
		if (!this.host) throw new SearchUnavailableError('Search is not configured');
		let response: Response;
		try {
			response = await fetch(`${this.host.replace(/\/$/, '')}${path}`, {
				method,
				headers: {
					'content-type': 'application/json',
					...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch {
			throw new SearchUnavailableError('Search is unavailable');
		}
		if (response.status === 404) throw new SearchNotFoundError('Not in the search index');
		if (!response.ok) throw new SearchUnavailableError('Search is unavailable');
		if (response.status === 204) return {} as T;
		return (await response.json()) as T;
	}
}
