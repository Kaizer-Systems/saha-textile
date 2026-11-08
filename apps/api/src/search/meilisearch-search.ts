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

/** A hung index must not hold a page open. */
const REQUEST_TIMEOUT_MS = 2000;
/** Indexing runs in the background on Meilisearch, and a full rebuild takes a moment. */
const TASK_WAIT_MS = 60_000;
const TASK_POLL_MS = 100;
const BATCH = 500;

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

	constructor(
		private readonly host: string | undefined,
		private readonly apiKey: string | undefined,
		private readonly loadProducts: (ids: readonly string[]) => Promise<Product[]>,
		readonly index: string,
		private readonly locales: readonly string[],
	) {}

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
	 * Builds the new index beside the live one and swaps them, so a rebuild on a deploy never
	 * shows shoppers an empty or half-filled list. Applying settings creates an index that does
	 * not exist yet, and the swap needs both to exist.
	 */
	async replaceIndex(entries: readonly SearchEntry[]): Promise<void> {
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

	private async waitFor(taskUid: number): Promise<void> {
		const deadline = Date.now() + TASK_WAIT_MS;
		while (Date.now() < deadline) {
			const task = await this.send<{ status?: string }>(`/tasks/${taskUid}`, 'GET');
			if (task.status === 'succeeded') return;
			if (task.status === 'failed' || task.status === 'canceled') break;
			await new Promise((done) => setTimeout(done, TASK_POLL_MS));
		}
		throw new SearchUnavailableError('The search index did not finish updating');
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
		if (!response.ok) throw new SearchUnavailableError('Search is unavailable');
		if (response.status === 204) return {} as T;
		return (await response.json()) as T;
	}
}
