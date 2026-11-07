import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { FooterCategories } from './categories';

const data = signal<unknown>(undefined);
vi.mock('@data-access/queries/category.queries', () => ({
	injectCategoriesQuery: () => ({ data }),
}));

const render = () => {
	TestBed.resetTestingModule();
	TestBed.overrideComponent(FooterCategories, { set: { imports: [], template: '' } });
	return TestBed.createComponent(FooterCategories).componentInstance;
};

afterEach(() => data.set(undefined));

describe('FooterCategories', () => {
	it('lists the top categories only', () => {
		data.set({ data: [{ id: 1 }, { id: 2, parent_id: 1 }] });
		expect(render().categories()).toEqual([{ id: 1 }]);
	});

	it('is empty until the catalogue answers', () => {
		expect(render().categories()).toEqual([]);
	});
});
