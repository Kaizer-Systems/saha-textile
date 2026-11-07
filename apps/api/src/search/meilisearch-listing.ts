import type {
	ListingFacet,
	ListingFilters,
	ListingPage,
	ListingPort,
	ListingQuery,
	ListingSort,
} from '@saha-textile/core-domain';

import type { FacetValue } from './listing-document';
import type { MeilisearchClient } from './meilisearch-search';

const SORTS: Record<ListingSort, (locale: string) => string[]> = {
	asc: () => ['idOrder:asc'],
	desc: () => ['idOrder:desc'],
	'low-high': () => ['minINR:asc', 'idOrder:asc'],
	'high-low': () => ['minINR:desc', 'idOrder:asc'],
	'a-z': (locale) => [`titleOrder.${locale}:asc`, 'idOrder:asc'],
	'z-a': (locale) => [`titleOrder.${locale}:desc`, 'idOrder:desc'],
	'discount-high-low': () => ['percentOff:desc', 'idOrder:asc'],
};

/** The order Mongo lists products in when no sort is chosen: newest first. */
const DEFAULT_SORT = ['createdOrder:desc', 'idOrder:asc'];

interface SearchAnswer {
	hits?: Array<{ id?: string }>;
	totalHits?: number;
	facetDistribution?: Record<string, Record<string, number>>;
}

const quote = (value: string): string => JSON.stringify(value);
const anyOf = (field: string, values: Iterable<string>): string => `${field} IN [${[...values].map(quote).join(', ')}]`;

function priceFilter(filters: ListingFilters): string[] {
	if (!filters.priceRanges.length) return [];
	const ranges = filters.priceRanges.map(({ min, max }) =>
		max === null ? `maxINR >= ${min}` : `(maxINR >= ${min} AND minINR <= ${max})`,
	);
	return [`(${ranges.join(' OR ')})`];
}

/** Every filter, leaving out one facet's own ticks when counting that facet. */
function filterFor(query: ListingQuery, exceptFacet?: string): string[] {
	const { filters, categoryId } = query;
	const ticked = [...filters.attributes]
		.filter(([code]) => code !== exceptFacet)
		.map(([code, terms]) =>
			anyOf(
				'terms',
				[...terms].map((term) => `${code}:${term}`),
			),
		);
	return [
		...(categoryId ? [`categoryIds = ${quote(categoryId)}`] : []),
		...priceFilter(filters),
		...(filters.minRating === null ? [] : [`rating >= ${filters.minRating}`]),
		...(filters.categoryIds.length ? [anyOf('categoryIds', filters.categoryIds)] : []),
		...ticked,
	];
}

function readFacetValues(distribution: Record<string, number>): Array<{ value: FacetValue; count: number }> {
	return Object.entries(distribution).map(([encoded, count]) => ({
		value: JSON.parse(encoded) as FacetValue,
		count,
	}));
}

const labelIn = (labels: Record<string, string>, locale: string): string => labels[locale] || labels['en'] || '';

/**
 * Listings from Meilisearch, in one request. Counts are disjunctive: each ticked facet gets its
 * own sub-query without its own ticks, so ticking Silk does not zero out Cotton. All of them run
 * in parallel inside one multi-search call.
 */
export class MeilisearchListing implements ListingPort {
	constructor(private readonly client: MeilisearchClient) {}

	async page(query: ListingQuery): Promise<ListingPage> {
		const ticked = [...query.filters.attributes.keys()];
		const scope = query.categoryId ? [`categoryIds = ${quote(query.categoryId)}`] : [];
		const facetsOnly = (filter: string[]) => ({
			indexUid: this.client.index,
			q: '',
			filter,
			hitsPerPage: 0,
			facets: ['facetValues', 'filterCodes'],
		});
		const results = await this.client.multiSearch<SearchAnswer>([
			{
				indexUid: this.client.index,
				q: '',
				filter: filterFor(query),
				sort: query.sort ? SORTS[query.sort](query.locale) : DEFAULT_SORT,
				page: query.page,
				hitsPerPage: query.pageSize,
				attributesToRetrieve: ['id'],
				facets: ['facetValues'],
			},
			facetsOnly(scope),
			...ticked.map((code) => facetsOnly(filterFor(query, code))),
		]);
		const [main, everything, ...perFacet] = results as [SearchAnswer, SearchAnswer, ...SearchAnswer[]];
		const countsFor = (code: string): SearchAnswer => {
			const index = ticked.indexOf(code);
			return index >= 0 ? (perFacet[index] as SearchAnswer) : main;
		};
		return {
			productIds: (main.hits ?? []).flatMap((hit) => (hit.id ? [hit.id] : [])),
			total: main.totalHits ?? 0,
			facets: this.facets(everything, countsFor, query.locale),
		};
	}

	private facets(
		everything: SearchAnswer,
		countsFor: (code: string) => SearchAnswer,
		locale: string,
	): ListingFacet[] {
		const filterable = new Set(Object.keys(everything.facetDistribution?.['filterCodes'] ?? {}));
		const groups = new Map<string, { label: string; terms: Map<string, string> }>();
		for (const { value } of readFacetValues(everything.facetDistribution?.['facetValues'] ?? {})) {
			if (!filterable.has(value.code)) continue;
			const entry = groups.get(value.code) ?? { label: labelIn(value.group, locale), terms: new Map() };
			if (!entry.terms.has(value.term)) entry.terms.set(value.term, labelIn(value.label, locale));
			groups.set(value.code, entry);
		}
		return [...groups.entries()]
			.sort(([a], [b]) => a.localeCompare(b, 'en'))
			.map(([code, group]) => {
				const counts = new Map<string, number>();
				for (const { value, count } of readFacetValues(
					countsFor(code).facetDistribution?.['facetValues'] ?? {},
				)) {
					if (value.code === code) counts.set(value.term, (counts.get(value.term) ?? 0) + count);
				}
				return {
					code,
					label: group.label,
					terms: [...group.terms.entries()]
						.map(([term, label]) => ({ code: term, label, count: counts.get(term) ?? 0 }))
						.sort((a, b) => a.label.localeCompare(b.label, 'en')),
				};
			});
	}
}
