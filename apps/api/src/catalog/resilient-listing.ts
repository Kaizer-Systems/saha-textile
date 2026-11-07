import { Logger } from '@nestjs/common';
import {
	SearchUnavailableError,
	type ListingPage,
	type ListingPort,
	type ListingQuery,
} from '@saha-textile/core-domain';

const nothingTicked = ({ filters }: ListingQuery): boolean =>
	!filters.priceRanges.length &&
	filters.minRating === null &&
	!filters.categoryIds.length &&
	filters.attributes.size === 0;

/**
 * Search first, Mongo when search cannot answer, so a listing never breaks. An empty unfiltered
 * listing also asks Mongo: a category with products always has some, so that means the index
 * has not been filled yet.
 */
export class ResilientListing implements ListingPort {
	private readonly logger = new Logger(ResilientListing.name);

	constructor(
		private readonly primary: ListingPort,
		private readonly fallback: ListingPort,
	) {}

	async page(query: ListingQuery): Promise<ListingPage> {
		try {
			const page = await this.primary.page(query);
			if (page.total > 0 || !nothingTicked(query)) return page;
		} catch (error) {
			if (!(error instanceof SearchUnavailableError)) throw error;
			this.logger.warn(`Listing fell back to Mongo: ${error.message}`);
		}
		return this.fallback.page(query);
	}
}
