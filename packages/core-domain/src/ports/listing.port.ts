import type { ListingFacet, ListingFilters, ListingSort } from '../catalog/listing';

export interface ListingQuery {
	/** Unset is the all-products page. */
	categoryId?: string;
	filters: ListingFilters;
	sort?: ListingSort;
	page: number;
	pageSize: number;
	locale: string;
}

export interface ListingPage {
	/** One page, in order. */
	productIds: string[];
	total: number;
	facets: ListingFacet[];
}

/**
 * A category listing and its filter counts, always from one engine, so the numbers beside the
 * filters match the products shown. Mongo stays the source of truth; cart and checkout check
 * real stock, so an index a moment behind can never sell what is gone.
 */
export interface ListingPort {
	page(query: ListingQuery): Promise<ListingPage>;
}
