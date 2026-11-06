import { SimpleChange } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { Pagination } from './pagination';

const render = () => {
	TestBed.resetTestingModule();
	TestBed.overrideComponent(Pagination, { set: { imports: [], template: '' } });
	return TestBed.createComponent(Pagination).componentInstance;
};

describe('Pagination.getPager', () => {
	it.each([
		['fits in the range', 24, 1, 12, [1, 2]],
		['near the beginning', 100, 1, 10, [1, 2, 3]],
		['in the middle', 100, 5, 10, [4, 5, 6]],
		['near the end', 100, 10, 10, [8, 9, 10]],
		['clamped below one', 100, 0, 10, [1, 2, 3]],
		['clamped past the end', 100, 99, 10, [8, 9, 10]],
	])('%s', (_name, total, page, size, pages) => {
		expect(render().getPager(total, page, size).pages).toEqual(pages);
	});

	it('reports the item range', () => {
		expect(render().getPager(25, 3, 10)).toMatchObject({
			totalPages: 3,
			currentPage: 3,
			startIndex: 20,
			endIndex: 24,
		});
	});
});

describe('Pagination', () => {
	it('recomputes from whichever inputs changed', () => {
		const pager = render();
		pager.ngOnChanges({
			total: new SimpleChange(0, 100, true),
			currentPage: new SimpleChange(1, 5, true),
			pageSize: new SimpleChange(12, 10, true),
		});
		expect(pager.paginate.pages).toEqual([4, 5, 6]);
		pager.total = 20;
		pager.ngOnChanges({});
		expect(pager.paginate).toMatchObject({ totalItems: 20, totalPages: 2, pageSize: 10 });
	});

	it('emits the chosen page', () => {
		const pager = render();
		const seen: number[] = [];
		pager.setPage.subscribe((page) => seen.push(page));
		pager.pageSet(2);
		expect(seen).toEqual([2]);
	});
});
