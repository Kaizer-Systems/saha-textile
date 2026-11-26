import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { BehaviorSubject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AdminLanguagesGateway } from '@core/admin-languages/admin-languages.gateway';
import { keepBranches } from '@features/category/category';

import { injectMissingLanguage, keepMissing } from './missing-language';

const route = (query: Record<string, string>) => {
	const params = new BehaviorSubject(convertToParamMap(query));
	return { params, value: { queryParamMap: params, snapshot: { queryParamMap: params.value } } };
};

const build = (query: Record<string, string>, missing = vi.fn(() => of({ ids: ['prd_2'] }))) => {
	const { params, value } = route(query);
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ActivatedRoute, useValue: value },
			{ provide: AdminLanguagesGateway, useValue: { missing } },
		],
	});
	return { filter: TestBed.runInInjectionContext(() => injectMissingLanguage('products')), params, missing };
};

describe('a list filtered to what is missing in one language', () => {
	it('reads ?missing=, asks for that list’s ids, and follows the address', () => {
		const { filter, params, missing } = build({ missing: 'hi' });
		expect(filter.code()).toBe('hi');
		expect([...(filter.ids() ?? [])]).toEqual(['prd_2']);
		expect(missing).toHaveBeenCalledWith('products', 'hi');
		params.next(convertToParamMap({}));
		expect(filter.code()).toBeNull();
		expect(filter.ids()).toBeNull();
	});

	it('ignores a value that is not a language, and shows nothing when the ids are refused', () => {
		expect(build({ missing: '<b>' }).filter.code()).toBeNull();
		const refused = build(
			{ missing: 'hi' },
			vi.fn(() => throwError(() => new Error('403'))),
		);
		expect([...(refused.filter.ids() ?? ['x'])]).toEqual([]);
	});

	it('filters nothing outside a routed page', () => {
		TestBed.resetTestingModule();
		const filter = TestBed.runInInjectionContext(() => injectMissingLanguage('faqs'));
		expect([filter.code(), filter.ids()]).toEqual([null, null]);
	});

	it('keeps the matching rows of a fully loaded list, or all of them', () => {
		const rows = [{ id: 'a' }, { id: 'b' }];
		expect(keepMissing(rows, new Set(['b']), (row) => row.id)).toEqual([{ id: 'b' }]);
		expect(keepMissing(rows, null, (row) => row.id)).toEqual(rows);
	});

	it('keeps a missing category with the branch that leads to it', () => {
		const tree = [
			{ id: 'sarees', subcategories: [{ id: 'silk', subcategories: [{ id: 'banarasi' }] }, { id: 'cotton' }] },
			{ id: 'kurtis', subcategories: [] },
		] as never;
		expect(keepBranches(tree, new Set(['banarasi']))).toEqual([
			{ id: 'sarees', subcategories: [{ id: 'silk', subcategories: [{ id: 'banarasi', subcategories: [] }] }] },
		]);
		expect(keepBranches(tree, new Set())).toEqual([]);
	});
});
