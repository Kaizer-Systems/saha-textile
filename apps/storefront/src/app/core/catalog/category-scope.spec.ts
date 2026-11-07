import { describe, expect, it } from 'vitest';

import { ICategory } from '@data-access/interfaces/category.interface';

import { browseCategories, childCategories } from './category-scope';

const row = (id: string, slug: string, canonical_path: string, parent_id?: string) =>
	({ id, slug, canonical_path, parent_id }) as ICategory;

const all = [
	row('a', 'sarees', 'sarees'),
	row('b', 'silk', 'sarees/silk', 'a'),
	row('c', 'cotton', 'sarees/cotton', 'a'),
	row('d', 'suits', 'suits'),
];
const ids = (rows: ICategory[]) => rows.map((category) => category.id);

describe('category scope', () => {
	it('shows the top categories on the plain collections page', () => {
		expect(ids(browseCategories(all, undefined))).toEqual(['a', 'd']);
		expect(ids(childCategories(all, ''))).toEqual(['a', 'd']);
	});

	it('goes one level down', () => {
		expect(ids(browseCategories(all, 'sarees'))).toEqual(['b', 'c']);
	});

	it('shows the categories beside a last-level page, but no filter', () => {
		expect(ids(browseCategories(all, 'sarees/silk'))).toEqual(['b', 'c']);
		expect(childCategories(all, 'sarees/silk')).toEqual([]);
	});

	it('finds a second placement by its slug', () => {
		expect(ids(browseCategories(all, 'gifts/sarees'))).toEqual(['b', 'c']);
	});

	it('treats an unknown path like the plain page', () => {
		expect(ids(browseCategories(all, 'gone'))).toEqual(['a', 'd']);
	});

	it('is empty with nothing in the catalogue', () => {
		expect(browseCategories([], undefined)).toEqual([]);
	});

	it('copes with a top category that has no children', () => {
		expect(ids(browseCategories(all, 'suits'))).toEqual(['a', 'd']);
	});
});
