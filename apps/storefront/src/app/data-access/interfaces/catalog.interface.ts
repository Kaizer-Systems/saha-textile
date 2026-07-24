import { IProduct } from './product.interface';

/** One filter facet's value + its (disjunctive) count for the current query. */
export interface IFacetValue {
	value: string;
	count: number;
}

/**
 * Response envelope of the catalog listing route: a paginated slice + ride-along
 * disjunctive facets. Cards are lean (~16 of IProduct's fields; config blocks only
 * on configurable products) but typed as IProduct so the shared card components —
 * which optional-chain every field — consume them unchanged.
 */
export interface ICatalogResponse {
	data: IProduct[];
	total: number;
	page: number;
	limit: number;
	last_page: number;
	/** Resolved category node (canonical identity, even via an extra-placement URL); null on the general page. */
	category?: { id: number; name: string; canonical_path: string } | null;
	/** L1→node trail (names + canonical paths) for the breadcrumb. */
	breadcrumb?: { name: string; path: string }[];
	facets: Record<string, IFacetValue[]>;
	price_range: { min: number; max: number };
}
