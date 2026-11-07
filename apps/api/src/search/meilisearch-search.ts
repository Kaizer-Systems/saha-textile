import type { Product } from '@saha-textile/contracts';
import {
	SEARCH_SYNONYMS,
	SearchUnavailableError,
	searchDocument,
	type Paginated,
	type SearchPort,
	type SearchQuery,
} from '@saha-textile/core-domain';

/** A hung index must not hold a page open. */
const REQUEST_TIMEOUT_MS = 2000;

/**
 * Meilisearch behind `SearchPort`. The index stores ids and words. Prices are
 * loaded from Mongo after the ids come back. A down index throws
 * `SearchUnavailableError` and never falls through to a Mongo text query.
 */
export class MeilisearchSearch implements SearchPort {
	constructor(
		private readonly host: string | undefined,
		private readonly apiKey: string | undefined,
		private readonly loadProducts: (ids: readonly string[]) => Promise<Product[]>,
		private readonly index: string,
	) {}

	async indexProduct(product: Product): Promise<void> {
		await this.ensureSettings();
		await this.send(`/indexes/${this.index}/documents`, 'POST', [searchDocument(product)]);
	}

	async removeProduct(productId: string): Promise<void> {
		await this.send(`/indexes/${this.index}/documents/${encodeURIComponent(productId)}`, 'DELETE');
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
		await this.send(`/indexes/${this.index}/settings`, 'PATCH', {
			searchableAttributes: ['words'],
			filterableAttributes: ['categoryIds'],
			sortableAttributes: [],
			synonyms: SEARCH_SYNONYMS,
		});
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
