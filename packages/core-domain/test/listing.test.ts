import { describe, expect, it } from 'vitest';

import {
	cleanListingParams,
	listingFacets,
	matchesListing,
	parseAttributeFilter,
	parsePriceRanges,
	sortListing,
	type ListingFilters,
	type ListingRow,
} from '../src/catalog/listing';

const row = (id: string, overrides: Partial<ListingRow> = {}): ListingRow => ({
	id,
	title: id,
	minINR: 1000,
	maxINR: 1000,
	percentOff: 0,
	rating: 0,
	categoryIds: [],
	facets: [],
	...overrides,
});

const facet = (code: string, ...terms: string[]) => ({
	code,
	label: code,
	terms: terms.map((term) => ({ code: term, label: term.toUpperCase() })),
});

const none: ListingFilters = { priceRanges: [], minRating: null, categoryIds: [], attributes: new Map() };

describe('listing filters', () => {
	it('reads grouped and repeated attribute params', () => {
		const ticks = parseAttributeFilter(['fabric:silk,cotton|color:red', 'fabric:linen']);

		expect([...(ticks.get('fabric') ?? [])]).toEqual(['silk', 'cotton', 'linen']);
		expect([...(ticks.get('color') ?? [])]).toEqual(['red']);
	});

	it('reads price ranges with an open end, and a plain min and max', () => {
		expect(parsePriceRanges({ price: '0-1000,20000-' })).toEqual([
			{ min: 0, max: 1000 },
			{ min: 20000, max: null },
		]);
		expect(parsePriceRanges({ min: 500 })).toEqual([{ min: 500, max: null }]);
		expect(parsePriceRanges({ max: 900 })).toEqual([{ min: 0, max: 900 }]);
		expect(parsePriceRanges({})).toEqual([]);
	});

	it('keeps a product whose price range overlaps a ticked range', () => {
		const ranged = row('a', { minINR: 900, maxINR: 1500 });

		expect(matchesListing(ranged, { ...none, priceRanges: [{ min: 1400, max: 2000 }] })).toBe(true);
		expect(matchesListing(ranged, { ...none, priceRanges: [{ min: 1600, max: null }] })).toBe(false);
		expect(matchesListing(ranged, { ...none, priceRanges: [{ min: 0, max: 800 }] })).toBe(false);
	});

	it('applies the rating floor and ticked categories', () => {
		expect(matchesListing(row('a', { rating: 3 }), { ...none, minRating: 4 })).toBe(false);
		expect(matchesListing(row('a', { rating: 4 }), { ...none, minRating: 4 })).toBe(true);
		expect(matchesListing(row('a', { categoryIds: ['x'] }), { ...none, categoryIds: ['y'] })).toBe(false);
		expect(matchesListing(row('a', { categoryIds: ['x'] }), { ...none, categoryIds: ['x', 'y'] })).toBe(true);
	});

	it('is OR inside a facet and AND across facets', () => {
		const product = row('a', { facets: [facet('fabric', 'silk'), facet('color', 'red')] });
		const attributes = (entries: Array<[string, string[]]>) =>
			new Map(entries.map(([code, terms]) => [code, new Set(terms)]));

		expect(matchesListing(product, { ...none, attributes: attributes([['fabric', ['silk', 'cotton']]]) })).toBe(
			true,
		);
		expect(
			matchesListing(product, {
				...none,
				attributes: attributes([
					['fabric', ['silk']],
					['color', ['blue']],
				]),
			}),
		).toBe(false);
		expect(
			matchesListing(
				product,
				{
					...none,
					attributes: attributes([
						['fabric', ['silk']],
						['color', ['blue']],
					]),
				},
				'color',
			),
		).toBe(true);
	});
});

describe('listing order', () => {
	const rows = [
		row('prd_10', { title: 'Beta', minINR: 300, percentOff: 5 }),
		row('prd_9', { title: 'alpha', minINR: 300, percentOff: 50 }),
		row('prd_100', { title: 'Gamma', minINR: 100, percentOff: 5 }),
	];
	const ids = (sort?: Parameters<typeof sortListing>[1]) => sortListing(rows, sort).map((item) => item.id);

	it('keeps the given order with no sort, without touching the input', () => {
		expect(ids()).toEqual(['prd_10', 'prd_9', 'prd_100']);
		sortListing(rows, 'asc');
		expect(rows[0]?.id).toBe('prd_10');
	});

	it('sorts every way the shop offers, with stable ties', () => {
		expect(ids('asc')).toEqual(['prd_9', 'prd_10', 'prd_100']);
		expect(ids('desc')).toEqual(['prd_100', 'prd_10', 'prd_9']);
		expect(ids('low-high')).toEqual(['prd_100', 'prd_9', 'prd_10']);
		expect(ids('high-low')).toEqual(['prd_9', 'prd_10', 'prd_100']);
		expect(ids('a-z')).toEqual(['prd_9', 'prd_10', 'prd_100']);
		expect(ids('z-a')).toEqual(['prd_100', 'prd_10', 'prd_9']);
		expect(ids('discount-high-low')).toEqual(['prd_9', 'prd_10', 'prd_100']);
	});
});

describe('listing facet counts', () => {
	const rows = [
		row('a', { facets: [facet('fabric', 'silk'), facet('color', 'red')] }),
		row('b', { facets: [facet('fabric', 'silk'), facet('color', 'blue')] }),
		row('c', { facets: [facet('fabric', 'cotton'), facet('color', 'red')] }),
	];
	const counts = (filters: ListingFilters, code: string) =>
		Object.fromEntries(
			listingFacets(rows, filters)
				.find((item) => item.code === code)
				?.terms.map((term) => [term.code, term.count]) ?? [],
		);

	it('lists every facet and value, labelled, in order', () => {
		const facets = listingFacets(rows, none);

		expect(facets.map((item) => item.code)).toEqual(['color', 'fabric']);
		expect(facets[0]?.terms.map((term) => term.label)).toEqual(['BLUE', 'RED']);
	});

	it('leaves a facet untouched by its own ticks, so siblings do not zero out', () => {
		const filters = { ...none, attributes: new Map([['fabric', new Set(['silk'])]]) };

		expect(counts(filters, 'fabric')).toEqual({ silk: 2, cotton: 1 });
	});

	it('narrows the other facets by those ticks, keeping a value at zero', () => {
		const filters = { ...none, attributes: new Map([['fabric', new Set(['cotton'])]]) };

		expect(counts(filters, 'color')).toEqual({ red: 1, blue: 0 });
	});
});

describe('cleaning address filters', () => {
	it('keeps good values and drops malformed ones', () => {
		expect(
			cleanListingParams({
				page: '2',
				sortBy: 'a-z',
				rating: '4,5',
				price: '0-1000,20000-',
				attribute: 'fabric:silk|color:red',
				category: 'pure-silk',
			}),
		).toEqual({
			page: 2,
			sortBy: 'a-z',
			rating: '4,5',
			price: '0-1000,20000-',
			attribute: 'fabric:silk|color:red',
			category: 'pure-silk',
		});
		expect(
			cleanListingParams({
				page: 'abc',
				sortBy: 'nope',
				rating: '9',
				price: 'x',
				attribute: 'bad',
				category: 'BAD',
			}),
		).toEqual({ page: 1 });
		expect(cleanListingParams({ page: -1 })).toEqual({ page: 1 });
		expect(cleanListingParams({ page: 1.5, rating: 5 })).toEqual({ page: 1 });
	});
});
