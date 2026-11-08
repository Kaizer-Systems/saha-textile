import { describe, expect, it } from 'vitest';

import {
	MAX_PRODUCTS,
	MAX_TERMS,
	clearSearchHistory,
	forgetSearchTerm,
	readSearchHistory,
	rememberSearchProduct,
	rememberSearchTerm,
} from './search-history';

function memoryStorage(initial: Record<string, string> = {}): Storage {
	const rows = new Map(Object.entries(initial));
	return {
		get length() {
			return rows.size;
		},
		clear: () => rows.clear(),
		getItem: (key) => rows.get(key) ?? null,
		key: (index) => [...rows.keys()][index] ?? null,
		removeItem: (key) => void rows.delete(key),
		setItem: (key, value) => void rows.set(key, value),
	};
}

describe('search history', () => {
	it('starts empty and survives broken or foreign data', () => {
		expect(readSearchHistory(memoryStorage())).toEqual({ terms: [], products: [] });
		expect(readSearchHistory(memoryStorage({ st_search: '{oops' }))).toEqual({ terms: [], products: [] });
		expect(readSearchHistory(memoryStorage({ st_search: '"text"' }))).toEqual({ terms: [], products: [] });
		expect(readSearchHistory(memoryStorage({ st_search: '{"terms":[1,"silk",""],"products":"x"}' }))).toEqual({
			terms: ['silk'],
			products: [],
		});
	});

	it('keeps the newest words first, once each whatever the case, up to the limit', () => {
		const storage = memoryStorage();
		rememberSearchTerm(storage, 'silk');
		rememberSearchTerm(storage, '  Red   Banarasi ');
		rememberSearchTerm(storage, 'SILK');
		expect(readSearchHistory(storage).terms).toEqual(['SILK', 'Red Banarasi']);
		for (let index = 0; index < 10; index += 1) rememberSearchTerm(storage, `term ${index}`);
		expect(readSearchHistory(storage).terms).toHaveLength(MAX_TERMS);
		expect(rememberSearchTerm(storage, '   ').terms[0]).toBe('term 9');
	});

	it('forgets one word, remembers products and clears everything', () => {
		const storage = memoryStorage();
		rememberSearchTerm(storage, 'জামদানি');
		rememberSearchTerm(storage, 'tant');
		expect(forgetSearchTerm(storage, 'TANT').terms).toEqual(['জামদানি']);
		for (const slug of ['a', 'b', 'a', 'c', 'd', 'e']) rememberSearchProduct(storage, slug);
		expect(readSearchHistory(storage).products).toEqual(['e', 'd', 'c', 'a'].slice(0, MAX_PRODUCTS));
		expect(clearSearchHistory(storage)).toEqual({ terms: [], products: [] });
		expect(storage.getItem('st_search')).toBeNull();
	});

	it('shrugs off a store that refuses writes', () => {
		const storage = memoryStorage();
		storage.setItem = () => {
			throw new Error('quota');
		};
		storage.removeItem = () => {
			throw new Error('blocked');
		};
		expect(rememberSearchTerm(storage, 'silk').terms).toEqual(['silk']);
		expect(clearSearchHistory(storage).terms).toEqual([]);
	});
});
