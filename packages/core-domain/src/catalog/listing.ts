/**
 * The rules behind a category listing: which products a set of ticked filters keeps, in what
 * order, and how many each filter value would show.
 *
 * Counts are disjunctive: a facet's counts ignore that facet's own ticks, so ticking Silk does
 * not zero out Cotton. Within a facet ticks are OR; across facets they are AND.
 */
export interface ListingFacetTerm {
	code: string;
	label: string;
}

export interface ListingFacetValue {
	code: string;
	label: string;
	terms: readonly ListingFacetTerm[];
}

export interface ListingRow {
	id: string;
	title: string;
	/** The range the product sells at. Equal for a single price. */
	minINR: number;
	maxINR: number;
	percentOff: number;
	rating: number;
	categoryIds: readonly string[];
	facets: readonly ListingFacetValue[];
}

export type ListingSort = 'asc' | 'desc' | 'low-high' | 'high-low' | 'a-z' | 'z-a' | 'discount-high-low';

export interface PriceRange {
	min: number;
	max: number | null;
}

export interface ListingFilters {
	/** Empty keeps everything. A product matches when its price overlaps any range. */
	priceRanges: readonly PriceRange[];
	minRating: number | null;
	/** Empty keeps everything. */
	categoryIds: readonly string[];
	/** facet code to ticked term codes. */
	attributes: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface ListingFacet {
	code: string;
	label: string;
	terms: Array<{ code: string; label: string; count: number }>;
}

export function parseAttributeFilter(groups: readonly string[]): Map<string, Set<string>> {
	const ticks = new Map<string, Set<string>>();
	for (const group of groups.flatMap((value) => value.split('|'))) {
		const [code = '', values = ''] = group.split(':');
		const terms = ticks.get(code) ?? new Set<string>();
		for (const term of values.split(',')) terms.add(term);
		ticks.set(code, terms);
	}
	return ticks;
}

export function parsePriceRanges(input: {
	price?: string | undefined;
	min?: number | undefined;
	max?: number | undefined;
}): PriceRange[] {
	const ranges = (input.price ?? '')
		.split(',')
		.filter(Boolean)
		.map((range) => {
			const [min = '0', max = ''] = range.split('-');
			return { min: Number(min), max: max ? Number(max) : null };
		});
	if (input.min !== undefined || input.max !== undefined) {
		ranges.push({ min: input.min ?? 0, max: input.max ?? null });
	}
	return ranges;
}

const inRange = (row: ListingRow, range: PriceRange): boolean =>
	row.maxINR >= range.min && (range.max === null || row.minINR <= range.max);

function hasTerm(row: ListingRow, code: string, terms: ReadonlySet<string>): boolean {
	return row.facets.some((facet) => facet.code === code && facet.terms.some((term) => terms.has(term.code)));
}

/** Whether a row survives the filters, leaving out one facet's own ticks when counting it. */
export function matchesListing(row: ListingRow, filters: ListingFilters, exceptFacet?: string): boolean {
	if (filters.priceRanges.length && !filters.priceRanges.some((range) => inRange(row, range))) return false;
	if (filters.minRating !== null && row.rating < filters.minRating) return false;
	if (filters.categoryIds.length && !filters.categoryIds.some((id) => row.categoryIds.includes(id))) return false;
	for (const [code, terms] of filters.attributes) {
		if (code !== exceptFacet && !hasTerm(row, code, terms)) return false;
	}
	return true;
}

const byId = (a: ListingRow, b: ListingRow): number => a.id.localeCompare(b.id, 'en', { numeric: true });
const byTitle = (a: ListingRow, b: ListingRow): number => a.title.localeCompare(b.title, 'en') || byId(a, b);

const ORDER: Record<ListingSort, (a: ListingRow, b: ListingRow) => number> = {
	asc: byId,
	desc: (a, b) => byId(b, a),
	'low-high': (a, b) => a.minINR - b.minINR || byId(a, b),
	'high-low': (a, b) => b.minINR - a.minINR || byId(a, b),
	'a-z': byTitle,
	'z-a': (a, b) => byTitle(b, a),
	'discount-high-low': (a, b) => b.percentOff - a.percentOff || byId(a, b),
};

/** An unset sort keeps the order the rows arrived in. */
export function sortListing<T extends ListingRow>(rows: readonly T[], sort?: ListingSort): T[] {
	return sort ? [...rows].sort(ORDER[sort]) : [...rows];
}

/** Every value a listing can offer stays on the list; only its count moves with the filters. */
export function listingFacets(rows: readonly ListingRow[], filters: ListingFilters): ListingFacet[] {
	const facets = new Map<string, { label: string; terms: Map<string, string> }>();
	for (const row of rows) {
		for (const facet of row.facets) {
			const entry = facets.get(facet.code) ?? { label: facet.label, terms: new Map<string, string>() };
			for (const term of facet.terms) if (!entry.terms.has(term.code)) entry.terms.set(term.code, term.label);
			facets.set(facet.code, entry);
		}
	}
	return [...facets.entries()]
		.sort(([a], [b]) => a.localeCompare(b, 'en'))
		.map(([code, facet]) => {
			const matching = rows.filter((row) => matchesListing(row, filters, code));
			return {
				code,
				label: facet.label,
				terms: [...facet.terms.entries()]
					.map(([termCode, label]) => ({
						code: termCode,
						label,
						count: matching.filter((row) => hasTerm(row, code, new Set([termCode]))).length,
					}))
					.sort((a, b) => a.label.localeCompare(b.label, 'en')),
			};
		});
}

const LISTING_PARAMS: Record<'category' | 'sortBy' | 'rating' | 'price' | 'attribute', RegExp> = {
	category: /^[a-z0-9-]+(,[a-z0-9-]+)*$/,
	sortBy: /^(asc|desc|low-high|high-low|a-z|z-a|discount-high-low)$/,
	rating: /^[1-5](,[1-5])*$/,
	price: /^\d+-\d*(,\d+-\d*)*$/,
	attribute: /^[a-z0-9-]+:[^|:,]+(,[^|:,]+)*(\|[a-z0-9-]+:[^|:,]+(,[^|:,]+)*)*$/,
};

/**
 * The listing's address filters with anything malformed dropped, so a hand-edited URL still
 * shows products instead of a refused request. The API rejects the same values with a 400.
 */
export function cleanListingParams(input: Record<string, unknown>): Record<string, string | number> {
	const page = Number(input['page']);
	const clean: Record<string, string | number> = { page: Number.isInteger(page) && page > 0 ? page : 1 };
	for (const [key, pattern] of Object.entries(LISTING_PARAMS)) {
		const value = input[key];
		if (typeof value === 'string' && pattern.test(value)) clean[key] = value;
	}
	return clean;
}
