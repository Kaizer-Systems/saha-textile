import { HttpErrorResponse } from '@angular/common/http';
import { signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NotificationService } from '@data-access/services/notification.service';
import { SearchTermService } from '@data-access/services/search-term.service';

import { StorefrontSetting } from '../storefront-setting/storefront-setting';
import { FormSearchTerm, splitSpellings } from './form-search-term/form-search-term';
import { SearchTermList, toRow } from './search-term';

const client = vi.hoisted(() => ({ invalidateQueries: vi.fn() }));
const list = signal<unknown>(undefined);
const detail = signal<unknown>(undefined);
const settings = signal<unknown>(undefined);
const categories = signal<unknown>({ data: [{ id: 'cat_1', name: 'Sarees' }] });
const products = signal<unknown>({ items: [{ id: 'prd_2', title: 'Silk', thumbnailUrl: null }] });
let productQuery: (() => unknown) | undefined;

vi.mock('@data-access/queries/search-term.queries', () => ({
	injectSearchTermsQuery: (params: () => unknown) => (params(), { data: list }),
	injectSearchTermQuery: (id: () => unknown) => (id(), { data: detail }),
	injectStorefrontSearchSettingsQuery: () => ({ data: settings }),
}));
vi.mock('@data-access/queries/category.queries', () => ({
	injectCategoriesQuery: (params: () => unknown) => (params(), { data: categories }),
}));
vi.mock('@data-access/queries/product.queries', () => ({
	injectCatalogProductsQuery: (params: () => unknown) => ((productQuery = params), params(), { data: products }),
}));

const translate = (key: string, params?: Record<string, unknown>) =>
	params ? `${key} ${JSON.stringify(params)}` : key;

function render<T>(type: Type<T>, service: Partial<Record<keyof SearchTermService, unknown>>) {
	const router = { navigateByUrl: vi.fn() };
	const toasts = { showError: vi.fn(), showSuccess: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: Router, useValue: router },
			{ provide: SearchTermService, useValue: service },
			{ provide: QueryClient, useValue: client },
			{ provide: NotificationService, useValue: toasts },
			{ provide: TranslocoService, useValue: { translate } },
		],
	});
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(type);
	TestBed.tick();
	return { page: fixture.componentInstance, fixture, router, toasts };
}

const term = {
	id: 'sterm_1',
	name: { en: 'Puja', bn: 'পুজো' },
	spellings: { en: ['pujo', 'pooja'], bn: ['পূজা'] },
	categoryIds: ['cat_1'],
	productIds: ['prd_1'],
	status: 'live' as const,
	updatedAt: '2026-11-08T10:00:00.000Z',
};

afterEach(() => {
	list.set(undefined);
	detail.set(undefined);
	settings.set(undefined);
	client.invalidateQueries.mockClear();
});

describe('Search words list', () => {
	it('draws a word with its other names, spellings and counts', () => {
		expect(toRow(term, translate)).toEqual({
			id: 'sterm_1',
			name: 'Puja · পুজো',
			spellings: 'pujo, pooja, পূজা',
			finds: 'search_word_finds {"categories":1,"products":1}',
			status: '1',
			updated_at: '2026-11-08T10:00:00.000Z',
		});
		expect(toRow({ ...term, name: { bn: 'পুজো' }, status: 'draft' }, translate)).toMatchObject({
			name: 'পুজো',
			status: '0',
		});
	});

	it('fills the table, opens a word and deletes', () => {
		const service = { remove: vi.fn(() => of(undefined)) };
		const { page, router, toasts } = render(SearchTermList, service);
		list.set({ items: [term], total: 1 });
		TestBed.tick();
		expect(page.tableConfig()).toMatchObject({ total: 1, data: [{ id: 'sterm_1' }] });
		page.onTableChange({ page: 2 });
		page.onActionClicked({ actionToPerform: 'edit', data: { id: 'sterm_1' } } as never);
		expect(router.navigateByUrl).toHaveBeenCalledWith('/search-term/edit/sterm_1');
		page.onActionClicked({ actionToPerform: 'delete', data: { id: 'sterm_1' } } as never);
		expect(toasts.showSuccess).toHaveBeenCalledWith('search_word_deleted');
		page.onActionClicked({ actionToPerform: 'deleteAll', data: ['sterm_1', 'sterm_2'] } as never);
		expect(service.remove).toHaveBeenCalledTimes(3);
		service.remove.mockReturnValueOnce(throwError(() => new Error('no')));
		page.delete({ id: 'x' } as never);
		expect(toasts.showError).toHaveBeenCalledWith('search_word_rejected');
	});

	it('goes live in bulk, naming what each refused word lacks', () => {
		const service = {
			setStatus: vi.fn(() =>
				of({ updated: ['sterm_1'], refused: [{ id: 'sterm_2', gaps: [{ field: 'name', locale: 'bn' }] }] }),
			),
		};
		const { page, toasts } = render(SearchTermList, service);
		list.set({ items: [term, { ...term, id: 'sterm_2', name: { en: 'Bare' } }], total: 2 });
		TestBed.tick();
		page.onActionClicked({ actionToPerform: 'bulk_go_live', data: ['sterm_1', 'sterm_2'] } as never);
		expect(service.setStatus).toHaveBeenCalledWith(['sterm_1', 'sterm_2'], 'live');
		expect(toasts.showSuccess).toHaveBeenCalledWith('search_word_bulk_live {"count":1}');
		expect(toasts.showError).toHaveBeenCalledWith('Bare: বাংলা: search_word_gap_name');
		page.onActionClicked({ actionToPerform: 'bulk_take_down', data: ['sterm_1'] } as never);
		expect(service.setStatus).toHaveBeenLastCalledWith(['sterm_1'], 'draft');
		page.onActionClicked({ actionToPerform: 'status', data: { id: 'sterm_1', status: 1 } } as never);
		expect(service.setStatus).toHaveBeenLastCalledWith(['sterm_1'], 'live');
		service.setStatus.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		page.onActionClicked({ actionToPerform: 'status', data: { id: 'sterm_1', status: 0 } } as never);
		expect(toasts.showError).toHaveBeenCalledWith('search_word_rejected');
		expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['search-terms'] });
	});
});

describe('Search word form', () => {
	it('splits spellings on commas', () => {
		expect(splitSpellings(' pujo, , pooja ,durga puja ')).toEqual(['pujo', 'pooja', 'durga puja']);
		expect(splitSpellings(undefined)).toEqual([]);
	});

	it('loads a word in every language and saves one shared set of tags', () => {
		const service = { save: vi.fn(() => of({ id: 'sterm_1' })) };
		const { page, fixture, router, toasts } = render(FormSearchTerm, service);
		fixture.componentRef.setInput('id', 'sterm_1');
		detail.set({ term, products: [{ id: 'prd_1', name: 'Laal Paar', image: null }] });
		TestBed.tick();
		expect(page.form.value).toMatchObject({
			name: 'Puja',
			spellings: 'pujo, pooja',
			products: ['prd_1'],
			status: true,
		});
		expect(page.selectedCategories()).toEqual(['cat_1']);
		expect(page.productOptions().map((row) => ('value' in row ? row.value : null))).toEqual(['prd_1', 'prd_2']);
		page.switchLanguage('bn');
		expect(page.form.value.name).toBe('পুজো');
		page.selectCategories(['cat_1', 'cat_2']);
		page.submit();
		expect(service.save).toHaveBeenCalledWith('sterm_1', {
			name: { en: 'Puja', bn: 'পুজো' },
			spellings: { en: ['pujo', 'pooja'], bn: ['পূজা'] },
			categoryIds: ['cat_1', 'cat_2'],
			productIds: ['prd_1'],
			status: 'live',
		});
		expect(toasts.showSuccess).toHaveBeenCalledWith('saved');
		expect(router.navigateByUrl).toHaveBeenCalledWith('/search-term');
	});

	it('needs an English name, and opens the language a refusal names', () => {
		const refusal = new HttpErrorResponse({
			status: 400,
			error: { error: { issues: [{ path: ['name', 'bn'], code: 'go_live_blocked' }] } },
		});
		const service = { save: vi.fn(() => throwError(() => refusal)) };
		const { page, toasts } = render(FormSearchTerm, service);
		page.submit();
		expect(service.save).not.toHaveBeenCalled();
		page.form.patchValue({ name: 'Puja' });
		page.submit();
		expect(toasts.showError).toHaveBeenCalled();
		expect(page.fields.locale()).toBe('bn');
		service.save.mockReturnValueOnce(throwError(() => new Error('offline')));
		page.switchLanguage('en');
		page.submit();
		expect(toasts.showError).toHaveBeenLastCalledWith('search_word_rejected');
		page.openLanguageGap({ key: 'name', locale: 'bn' });
		expect(page.fields.locale()).toBe('bn');
	});

	it('searches products after a pause', () => {
		vi.useFakeTimers();
		const { page } = render(FormSearchTerm, {});
		page.searchProducts({ search: ' silk ' } as never);
		vi.advanceTimersByTime(300);
		expect(productQuery?.()).toEqual({ search: 'silk', pageSize: 50 });
		vi.useRealTimers();
	});
});

describe('Storefront settings', () => {
	it('loads and saves the show-first categories', () => {
		const service = { saveSearchSettings: vi.fn(() => of({ showFirstCategoryIds: ['cat_1'] })) };
		const { page, toasts } = render(StorefrontSetting, service);
		settings.set({ showFirstCategoryIds: ['cat_1'] });
		TestBed.tick();
		expect(page.showFirst()).toEqual(['cat_1']);
		expect(page.categories()).toEqual([{ id: 'cat_1', name: 'Sarees' }]);
		page.selectShowFirst(['cat_1', 'cat_2']);
		page.submit();
		expect(service.saveSearchSettings).toHaveBeenCalledWith({ showFirstCategoryIds: ['cat_1', 'cat_2'] });
		expect(toasts.showSuccess).toHaveBeenCalledWith('storefront_settings_saved');
		service.saveSearchSettings.mockReturnValueOnce(throwError(() => new Error('no')) as never);
		page.submit();
		expect(toasts.showError).toHaveBeenCalledWith('storefront_settings_rejected');
	});
});
