import type { Product } from '@saha-textile/contracts';
import {
	SEARCH_SYNONYMS,
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

	constructor(
		private readonly host: string | undefined,
		private readonly apiKey: string | undefined,
		private readonly loadProducts: (ids: readonly string[]) => Promise<Product[]>,
		readonly index: string,
		private readonly locales: readonly string[],
	) {}

	async indexProduct(entry: SearchEntry): Promise<void> {
		await this.ensureSettings();
		await this.send(`/indexes/${this.index}/documents`, 'POST', [listingDocument(entry, this.locales)]);
	}

	async replaceIndex(entries: readonly SearchEntry[]): Promise<void> {
		this.settingsApplied = false;
		await this.ensureSettings();
		let task = await this.send<{ taskUid: number }>(`/indexes/${this.index}/documents`, 'DELETE');
		for (let start = 0; start < entries.length; start += BATCH) {
			const documents = entries.slice(start, start + BATCH).map((entry) => listingDocument(entry, this.locales));
			task = await this.send<{ taskUid: number }>(`/indexes/${this.index}/documents`, 'POST', documents);
		}
		await this.waitFor(task.taskUid);
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
		const task = await this.send<{ taskUid: number }>(`/indexes/${this.index}/settings`, 'PATCH', {
			searchableAttributes: ['words'],
			filterableAttributes: ['categoryIds', 'terms', 'filterCodes', 'facetValues', 'minINR', 'maxINR', 'rating'],
			sortableAttributes: [
				'idOrder',
				'createdOrder',
				'minINR',
				'percentOff',
				...this.locales.map((locale) => `titleOrder.${locale}`),
			],
			synonyms: SEARCH_SYNONYMS,
			faceting: { maxValuesPerFacet: 10_000, sortFacetValuesBy: { '*': 'alpha' } },
			pagination: { maxTotalHits: 1_000_000 },
		});
		await this.waitFor(task.taskUid);
		this.settingsApplied = true;
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
