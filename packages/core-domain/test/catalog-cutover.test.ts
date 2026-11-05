import { describe, expect, it } from 'vitest';

import { SEARCH_SYNONYMS, searchDocument } from '../src/catalog/search-index';
import { dedupeById, liveRelations } from '../src/catalog/relation-rules';

describe('search document', () => {
	it('stores words and ids and leaves the price in Mongo', () => {
		const doc = searchDocument({
			id: 'prd_1',
			slug: 'silk',
			sku: 'SILK',
			title: { en: 'Silk', fr: 'Soie' },
			categoryIds: ['cat_1'],
		});
		expect(doc).toEqual({ id: 'prd_1', words: 'Silk Soie silk SILK', categoryIds: ['cat_1'] });
		expect('price' in doc || 'basePriceINR' in doc).toBe(false);
	});

	it('links the short ikat spellings both ways and ikkatsilk only toward the two words', () => {
		expect(SEARCH_SYNONYMS.ikat).toContain('ikkat');
		expect(SEARCH_SYNONYMS.ikkat).toContain('ikat');
		expect(SEARCH_SYNONYMS.ikkatsilk).toEqual(['ikkat silk']);
		expect(SEARCH_SYNONYMS.ikat).not.toContain('ikkatsilk');
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
