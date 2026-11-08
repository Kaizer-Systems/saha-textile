import { describe, expect, it } from 'vitest';

import { SEARCH_STOP_WORDS, searchDocument } from '../src/catalog/search-index';
import { dedupeById, liveRelations } from '../src/catalog/relation-rules';

describe('search document', () => {
	it('stores words and ids and leaves the price in Mongo', () => {
		const doc = searchDocument({
			id: 'prd_1',
			slug: 'silk',
			sku: 'SILK',
			title: { en: 'Silk', bn: 'সিল্ক' },
			categoryIds: ['cat_1'],
		});
		expect(doc).toEqual({ id: 'prd_1', words: 'Silk সিল্ক silk SILK', categoryIds: ['cat_1'] });
		expect('price' in doc || 'basePriceINR' in doc).toBe(false);
	});

	it('keeps only English filler words; spellings belong to the admin search words', () => {
		expect(SEARCH_STOP_WORDS).toEqual(['a', 'an', 'and', 'for', 'in', 'of', 'the', 'with']);
	});
});

describe('faq and relations', () => {
	it('shows one copy of an entry that matched twice', () => {
		expect(dedupeById([{ id: 'a' }, { id: 'a' }, { id: 'b' }])).toEqual([{ id: 'a' }, { id: 'b' }]);
	});

	it('omits a relation whose target is not live', () => {
		expect(liveRelations([{ targetId: 'live' }, { targetId: 'hidden' }], new Set(['live']))).toEqual([
			{ targetId: 'live' },
		]);
	});
});
