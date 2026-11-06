import { SimpleChange, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { FooterCategories } from './categories';

const data = signal<unknown>(undefined);
vi.mock('@data-access/queries/category.queries', () => ({
	injectCategoriesQuery: (params: () => unknown) => {
		params();
		return { data };
	},
}));

const render = () => {
	TestBed.resetTestingModule();
	TestBed.overrideComponent(FooterCategories, { set: { imports: [], template: '' } });
	const widget = TestBed.createComponent(FooterCategories).componentInstance;
	TestBed.tick();
	return widget;
};
const change = (ids: unknown) => ({ data: new SimpleChange(null, { footer: { footer_categories: ids } }, true) });

afterEach(() => data.set(undefined));

describe('FooterCategories', () => {
	it('shows the chosen categories', () => {
		data.set({ data: [{ id: 1 }, { id: 2 }] });
		const widget = render();
		widget.ngOnChanges(change([2]));
		expect(widget.categories).toEqual([{ id: 2 }]);
	});

	it('ignores a change with no list', () => {
		const widget = render();
		widget.ngOnChanges({});
		widget.ngOnChanges(change('x'));
		expect(widget.categories).toBeUndefined();
	});

	it('waits for a real list', () => {
		data.set({});
		const widget = render();
		widget.ngOnChanges(change([1]));
		expect(widget.categories).toBeUndefined();
	});
});
