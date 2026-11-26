import { HttpErrorResponse } from '@angular/common/http';
import { type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { NotificationService } from '@data-access/services/notification.service';
import { SearchTermService } from '@data-access/services/search-term.service';

import { EditSearchTerm } from './edit-search-term/edit-search-term';
import { FormSearchTerm } from './form-search-term/form-search-term';
import { SearchTermList } from './search-term';

vi.mock('@data-access/queries/search-term.queries', () => ({
	injectSearchTermsQuery: (params: () => unknown) => (params(), { data: () => undefined }),
	injectSearchTermQuery: (id: () => unknown) => (id(), { data: () => undefined }),
}));
vi.mock('@data-access/queries/category.queries', () => ({
	injectCategoriesQuery: (params: () => unknown) => (params(), { data: () => undefined }),
}));
vi.mock('@data-access/queries/product.queries', () => ({
	injectCatalogProductsQuery: (params: () => unknown) => (params(), { data: () => undefined }),
}));

function render<T>(type: Type<T>, service: Record<string, unknown>, routeId?: string) {
	const toasts = { showError: vi.fn(), showSuccess: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: Router, useValue: { navigateByUrl: vi.fn() } },
			{
				provide: ActivatedRoute,
				useValue: {
					queryParamMap: new BehaviorSubject(convertToParamMap({})),
					params: new BehaviorSubject(routeId ? { id: routeId } : {}),
				},
			},
			{ provide: SearchTermService, useValue: service },
			{ provide: QueryClient, useValue: { invalidateQueries: vi.fn() } },
			{ provide: NotificationService, useValue: toasts },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
		],
	});
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(type);
	fixture.detectChanges();
	TestBed.tick();
	return { page: fixture.componentInstance, toasts };
}

describe('the search word list edges', () => {
	it('does nothing for no ticks or an unknown action, and names a refused word by its id when unseen', () => {
		const remove = vi.fn(() => of(undefined));
		const setStatus = vi.fn(() => of({ updated: [], refused: [{ id: 'sterm_gone', gaps: [] }] }));
		const { page, toasts } = render(SearchTermList, { remove, setStatus });
		page.deleteAll(null as never);
		expect(remove).not.toHaveBeenCalled();
		page.onActionClicked({ actionToPerform: 'other', data: {} } as never);
		page.tableConfig.update((config) => ({ ...config, data: undefined as never }));
		page.bulk(null as never, 'live');
		expect(setStatus).toHaveBeenCalledWith([], 'live');
		expect(toasts.showSuccess).not.toHaveBeenCalled();
		expect(toasts.showError).toHaveBeenCalledWith(expect.stringMatching(/^sterm_gone: /));
	});
});

describe('the search word form edges', () => {
	it('starts with no categories or products, and saves a draft with none picked', () => {
		const save = vi.fn(() => of({}));
		const { page } = render(FormSearchTerm, { save });
		expect(page.categories()).toEqual([]);
		expect(page.productOptions()).toEqual([]);
		page.selectCategories(null as never);
		page.fields.load({ name: { en: 'Puja' }, spellings: {} });
		page.form.patchValue({ products: null, status: false });
		page.submit();
		expect(save).toHaveBeenCalledWith(null, expect.objectContaining({ productIds: [], status: 'draft' }));
	});

	it('names what Go Live misses without moving language for a gap in the whole word', () => {
		const refused = new HttpErrorResponse({
			status: 400,
			error: { error: { issues: [{ code: 'go_live_blocked', path: ['products'] }] } },
		});
		const { page, toasts } = render(FormSearchTerm, { save: () => throwError(() => refused) });
		const moved = vi.spyOn(page, 'switchLanguage');
		page.fields.load({ name: { en: 'Puja' }, spellings: {} });
		page.submit();
		expect(toasts.showError).toHaveBeenCalled();
		expect(moved).not.toHaveBeenCalled();
	});
});

describe('editing a search word', () => {
	it('reads the word’s id from the address', () => {
		expect(render(EditSearchTerm, {}, 'sterm_1').page.id()).toBe('sterm_1');
	});
});
