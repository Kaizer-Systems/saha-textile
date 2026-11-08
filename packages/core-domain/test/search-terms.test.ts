import type { SearchTerm } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import {
	cleanSpellings,
	cleanWord,
	searchTermGaps,
	searchVocabulary,
	termWords,
	withDescendants,
} from '../src/catalog/search-terms';

const term = (over: Partial<SearchTerm> = {}): SearchTerm => ({
	id: 'sterm_puja',
	name: { en: 'Puja', bn: 'পুজো' },
	spellings: { en: ['pujo', 'durga puja'], bn: ['পূজা'] },
	categoryIds: ['cat_red_white'],
	productIds: ['prd_9'],
	status: 'live',
	...over,
});

const tree = [
	{ id: 'cat_sarees', ancestors: [] },
	{ id: 'cat_red_white', ancestors: ['cat_sarees'] },
	{ id: 'cat_laal', ancestors: ['cat_sarees', 'cat_red_white'] },
	{ id: 'cat_suits', ancestors: [] },
];

describe('search word clean-up', () => {
	it('folds spacing and case, keeps Bengali, drops repeats and the name itself', () => {
		expect(cleanWord('  Durga   PUJA ')).toBe('durga puja');
		expect(
			cleanSpellings({ en: ['Pujo', 'pujo ', 'PUJA', ''], bn: ['পূজা', 'পুজো'] }, { en: 'Puja', bn: 'পুজো' }),
		).toEqual({
			en: ['pujo'],
			bn: ['পূজা'],
		});
		expect(cleanSpellings({ en: ['puja'] }, { en: 'Puja' })).toEqual({});
	});

	it('lists every name and spelling once', () => {
		expect(termWords(term())).toEqual(['puja', 'পুজো', 'pujo', 'durga puja', 'পূজা']);
	});
});

describe('search word Go Live', () => {
	it('needs a name in every language and something to find', () => {
		expect(searchTermGaps(term(), ['en', 'bn'])).toEqual([]);
		expect(
			searchTermGaps(term({ name: { en: 'Puja', bn: ' ' }, categoryIds: [], productIds: [] }), ['en', 'bn']),
		).toEqual([
			{ field: 'name', locale: 'bn' },
			{ field: 'tags', locale: null },
		]);
	});
});

describe('search vocabulary', () => {
	it('finds categories under a chosen one', () => {
		expect(withDescendants(['cat_red_white'], tree).sort()).toEqual(['cat_laal', 'cat_red_white']);
	});

	it('gives tagged products, directly or through a category tree, the words of every live search word', () => {
		const vocabulary = searchVocabulary(
			[
				term(),
				term({
					id: 'sterm_draft',
					name: { en: 'Draft' },
					spellings: {},
					status: 'draft',
					productIds: ['prd_1'],
				}),
			],
			tree,
		);
		expect(vocabulary.wordsFor({ id: 'prd_1', categoryIds: ['cat_laal'] })).toEqual(termWords(term()));
		expect(vocabulary.wordsFor({ id: 'prd_9', categoryIds: [] })).toEqual(termWords(term()));
		expect(vocabulary.wordsFor({ id: 'prd_2', categoryIds: ['cat_suits'] })).toEqual([]);
		expect(vocabulary.synonyms['pujo']).toEqual(['puja', 'পুজো', 'durga puja', 'পূজা']);
		expect(vocabulary.synonyms['draft']).toBeUndefined();
	});

	it('merges the synonyms of a word two search words share', () => {
		const vocabulary = searchVocabulary(
			[term(), term({ id: 'sterm_festive', name: { en: 'Festive', bn: 'উৎসব' }, spellings: { en: ['pujo'] } })],
			tree,
		);
		expect(vocabulary.synonyms['pujo']).toEqual(['puja', 'পুজো', 'durga puja', 'পূজা', 'festive', 'উৎসব']);
	});

	it('shows first only what sits in a chosen category, and nothing when none is chosen', () => {
		const first = searchVocabulary([], tree, ['cat_sarees']);
		expect(first.showsFirst({ categoryIds: ['cat_laal'] })).toBe(true);
		expect(first.showsFirst({ categoryIds: ['cat_suits'] })).toBe(false);
		expect(searchVocabulary([], tree).showsFirst({ categoryIds: ['cat_sarees'] })).toBe(false);
	});
});
