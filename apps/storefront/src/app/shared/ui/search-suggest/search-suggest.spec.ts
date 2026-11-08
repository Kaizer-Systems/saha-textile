import { CurrencyPipe } from '@angular/common';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import { Router } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { Subject, of, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConsentStore } from '@core/consent/consent.store';
import { ACTIVE_LOCALE } from '@core/i18n/active-locale';
import { CategoryService } from '@data-access/services/category.service';
import { ProductService, type SearchPage } from '@data-access/services/product.service';

import { SearchSuggest } from './search-suggest';
import { highlight, matchCategories } from './search-suggest-options';

import type { IProduct } from '@data-access/interfaces/product.interface';

const product = (id: number, name: string): IProduct =>
	({
		id,
		name,
		slug: name.toLowerCase().replace(/\s+/g, '-'),
		sale_price: 1000,
		price: 1000,
		variations: [],
	}) as unknown as IProduct;

const jamdani = product(1, 'Ruby Red Jamdani Saree');
const tant = product(2, 'Off White Tant Saree');
const silk = product(3, 'Sindoor Red Silk Saree');

const categories = [
	{ id: 'c1', name: 'Sarees', slug: 'sarees', canonical_path: 'sarees', level: 1, products_count: 900 },
	{ id: 'c2', name: 'Jamdani', slug: 'jamdani', canonical_path: 'sarees/jamdani', level: 2, products_count: 140 },
];

@Component({
	template: `
		<input
			#field
			[value]="control.value"
		/>
		<app-search-suggest
			[field]="field"
			[control]="control"
			(submitted)="submitted.push($event)"
			(escaped)="escaped = escaped + 1"
			(navigated)="navigated = navigated + 1"
		/>
	`,
	imports: [SearchSuggest],
})
class Host {
	control = new FormControl<string | null>('');
	submitted: string[] = [];
	escaped = 0;
	navigated = 0;
}

interface Options {
	search?: (term: string) => Observable<SearchPage>;
	functional?: boolean;
	trending?: IProduct[];
}

function render(options: Options = {}) {
	const functional = signal(options.functional ?? true);
	const service = {
		search: vi.fn(options.search ?? (() => of<SearchPage>({ items: [jamdani], total: 84 }))),
		trending: vi.fn(() => of({ kind: 'trending' as const, items: options.trending ?? [tant, silk] })),
		cardsFor: vi.fn((slugs: string[]) => of([jamdani, tant, silk].filter((row) => slugs.includes(row.slug)))),
		searchClick: vi.fn(),
	};
	const router = { navigate: vi.fn(), navigateByUrl: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [Host, TranslocoTestingModule.forRoot({ langs: { en: {} }, translocoConfig: { defaultLang: 'en' } })],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: ProductService, useValue: service },
			{ provide: CategoryService, useValue: { getCategories: () => of({ data: categories, total: 2 }) } },
			{ provide: ConsentStore, useValue: { allows: () => functional() } },
			{ provide: Router, useValue: router },
			{ provide: ACTIVE_LOCALE, useValue: 'en' },
			CurrencyPipe,
		],
	});
	const fixture = TestBed.createComponent(Host);
	fixture.autoDetectChanges();
	const el = fixture.nativeElement as HTMLElement;
	const field = el.querySelector('input') as HTMLInputElement;
	const type = (value: string) => {
		field.value = value;
		field.dispatchEvent(new Event('input'));
	};
	const key = (name: string) => field.dispatchEvent(new KeyboardEvent('keydown', { key: name, cancelable: true }));
	/** Testing Transloco prints a missing key as `en.key`. */
	const text = (row: Element) =>
		row.textContent
			?.replace(/\ben\./g, '')
			.replace(/\s+/g, ' ')
			.trim();
	const rows = () => [...el.querySelectorAll('[role="option"]')].map(text);
	const titles = () => [...el.querySelectorAll('.suggest-title')].map(text);
	return {
		fixture,
		el,
		field,
		type,
		key,
		rows,
		titles,
		service,
		router,
		host: fixture.componentInstance,
		functional,
	};
}

afterEach(() => localStorage.clear());

describe('search suggestion box', () => {
	it('starts closed, and sets up the field as a combobox', () => {
		const { el, field } = render();
		expect(el.querySelector('.search-suggestion')).toBeNull();
		expect(field.getAttribute('role')).toBe('combobox');
		expect(field.getAttribute('aria-autocomplete')).toBe('list');
		expect(field.getAttribute('aria-expanded')).toBe('false');
		expect(field.getAttribute('aria-controls')).toMatch(/^search-suggest-\d+$/);
	});

	it('shows trending products to a shopper with no history', async () => {
		const { field, rows, titles, el } = render();
		field.dispatchEvent(new Event('focus'));
		await vi.waitFor(() => expect(rows()).toHaveLength(2));
		expect(titles()).toEqual(['trending_now']);
		expect(rows()[0]).toContain('Off White Tant Saree');
		expect(field.getAttribute('aria-expanded')).toBe('true');
		expect(el.querySelector('[role="listbox"]')?.id).toBe(field.getAttribute('aria-controls'));
	});

	it('shows recent words and products opened from search, newest first', async () => {
		localStorage.setItem(
			'st_search',
			JSON.stringify({ terms: ['red banarasi', 'tant'], products: ['ruby-red-jamdani-saree'] }),
		);
		const { field, rows, titles } = render();
		field.dispatchEvent(new Event('focus'));
		await vi.waitFor(() => expect(rows()).toHaveLength(3));
		expect(titles()).toEqual(['recent_searches clear_all', 'opened_from_search']);
		expect(rows()[0]).toBe('red banarasi');
		expect(rows()[2]).toContain('Ruby Red Jamdani Saree');
	});

	it('hides the history and shows trending when Functional cookies are off', async () => {
		localStorage.setItem('st_search', JSON.stringify({ terms: ['tant'], products: [] }));
		const { field, titles } = render({ functional: false });
		field.dispatchEvent(new Event('focus'));
		await vi.waitFor(() => expect(titles()).toEqual(['trending_now']));
	});

	it('suggests categories and products after a pause, with the typed part in bold', async () => {
		const { type, rows, titles, service, el } = render();
		type('j');
		await new Promise((resolve) => setTimeout(resolve, 260));
		expect(service.search).not.toHaveBeenCalled();
		type('jamd');
		await vi.waitFor(() => expect(titles()).toEqual(['categories', 'products']));
		expect(service.search).toHaveBeenCalledTimes(1);
		expect(service.search).toHaveBeenCalledWith('jamd', { pageSize: 6 });
		expect(rows()[0]).toBe('JamdaniSarees');
		expect(rows()[1]).toContain('Ruby Red Jamdani Saree');
		expect(rows()[2]).toBe('search_see_all');
		expect([...el.querySelectorAll('b')].map((bold) => bold.textContent)).toEqual(['Jamd', 'Jamd']);
	});

	it('waits for a Bengali letter to finish before searching', async () => {
		const { field, type, service } = render();
		field.dispatchEvent(new CompositionEvent('compositionstart'));
		type('জা');
		type('জাম');
		await new Promise((resolve) => setTimeout(resolve, 260));
		expect(service.search).not.toHaveBeenCalled();
		field.dispatchEvent(new CompositionEvent('compositionend'));
		await vi.waitFor(() => expect(service.search).toHaveBeenCalledWith('জাম', { pageSize: 6 }));
	});

	it('moves through rows with the arrow keys and opens a product with Enter', async () => {
		const { type, key, field, service, router, rows, host } = render();
		type('jamd');
		await vi.waitFor(() => expect(rows()).toHaveLength(3));
		key('ArrowDown');
		key('ArrowDown');
		await vi.waitFor(() => expect(field.getAttribute('aria-activedescendant')).toMatch(/-r0$/));
		key('ArrowUp');
		key('ArrowUp');
		await vi.waitFor(() => expect(field.getAttribute('aria-activedescendant')).toMatch(/-a0$/));
		key('ArrowDown');
		key('ArrowDown');
		key('Enter');
		expect(service.searchClick).toHaveBeenCalledWith('jamd', 1);
		expect(router.navigate).toHaveBeenCalledWith(['/product', 'ruby-red-jamdani-saree']);
		expect(host.navigated).toBe(1);
		expect(JSON.parse(localStorage.getItem('st_search') ?? '{}')).toEqual({
			terms: ['jamd'],
			products: ['ruby-red-jamdani-saree'],
		});
		await vi.waitFor(() => expect(field.getAttribute('aria-expanded')).toBe('false'));
	});

	it('opens a category, and "See all" opens the results', async () => {
		const { type, el, router, host, rows, fixture } = render();
		type('jamd');
		await vi.waitFor(() => expect(rows()).toHaveLength(3));
		(el.querySelectorAll('[role="option"]')[0] as HTMLElement).click();
		expect(router.navigateByUrl).toHaveBeenCalledWith('/collections/sarees/jamdani');
		type('jamda');
		await fixture.whenStable();
		await vi.waitFor(() => expect(rows()).toHaveLength(3));
		(el.querySelectorAll('[role="option"]')[2] as HTMLElement).click();
		expect(host.submitted).toEqual(['jamda']);
	});

	it('submits the typed words with Enter when no row is chosen, remembering them', () => {
		const { type, key, host } = render();
		type('  red   silk ');
		key('Enter');
		expect(host.submitted).toEqual(['red silk']);
		expect(localStorage.getItem('st_search')).toContain('red silk');
	});

	it('does not remember anything without Functional cookies', () => {
		const { type, key, host } = render({ functional: false });
		type('silk');
		key('Enter');
		expect(host.submitted).toEqual(['silk']);
		expect(localStorage.getItem('st_search')).toBeNull();
	});

	it('runs a recent search, removes one and clears them all', async () => {
		localStorage.setItem('st_search', JSON.stringify({ terms: ['red banarasi', 'tant'], products: [] }));
		const { field, el, host, rows } = render();
		field.dispatchEvent(new Event('focus'));
		await vi.waitFor(() => expect(rows()).toEqual(['red banarasi', 'tant']));
		(el.querySelector('.suggest-remove') as HTMLElement).click();
		await vi.waitFor(() => expect(rows()).toEqual(['tant']));
		(el.querySelector('[role="option"]') as HTMLElement).click();
		expect(host.submitted).toEqual(['tant']);
		expect(host.control.value).toBe('tant');
		field.dispatchEvent(new Event('focus'));
		await vi.waitFor(() => expect(rows()).toEqual(['tant']));
		(el.querySelector('.suggest-clear') as HTMLElement).click();
		await vi.waitFor(() => expect(rows()).toHaveLength(2));
		expect(localStorage.getItem('st_search')).toBeNull();
	});

	it('removes the highlighted recent search with Delete', async () => {
		localStorage.setItem('st_search', JSON.stringify({ terms: ['tant', 'silk'], products: [] }));
		const { field, key, rows } = render();
		field.dispatchEvent(new Event('focus'));
		await vi.waitFor(() => expect(rows()).toEqual(['tant', 'silk']));
		key('ArrowDown');
		key('Delete');
		await vi.waitFor(() => expect(rows()).toEqual(['silk']));
	});

	it('says nothing matched, then shows trending', async () => {
		const { type, el, titles } = render({ search: () => of({ items: [], total: 0 }) });
		type('zxqv');
		await vi.waitFor(() => expect(el.querySelector('.suggest-message')?.textContent).toContain('search_no_match'));
		expect(titles()).toEqual(['trending_now']);
	});

	it('says search is down when the API fails', async () => {
		const { type, el, rows } = render({ search: () => throwError(() => new Error('503')) });
		type('silk');
		await vi.waitFor(() =>
			expect(el.querySelector('.suggest-message')?.textContent).toContain('search_unavailable'),
		);
		expect(rows()).toEqual([]);
	});

	it('keeps the last list while a newer word is on its way', async () => {
		const later = new Subject<SearchPage>();
		const { type, rows } = render({
			search: (term) => (term === 'silk' ? of({ items: [silk], total: 1 }) : later),
		});
		type('silk');
		await vi.waitFor(() => expect(rows()[0]).toContain('Sindoor Red Silk Saree'));
		type('silk s');
		await new Promise((resolve) => setTimeout(resolve, 260));
		expect(rows()[0]).toContain('Sindoor Red Silk Saree');
	});

	it('closes on Escape or an outside press, then lets the host close its bar', async () => {
		const { field, key, rows, host } = render();
		field.dispatchEvent(new Event('focus'));
		await vi.waitFor(() => expect(rows()).toHaveLength(2));
		key('Escape');
		await vi.waitFor(() => expect(rows()).toHaveLength(0));
		key('Escape');
		expect(host.escaped).toBe(1);
		field.dispatchEvent(new Event('click'));
		await vi.waitFor(() => expect(rows()).toHaveLength(2));
		document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		await vi.waitFor(() => expect(rows()).toHaveLength(0));
		key('ArrowDown');
		await vi.waitFor(() => expect(rows()).toHaveLength(2));
		key('Tab');
		await vi.waitFor(() => expect(rows()).toHaveLength(0));
	});
});

describe('suggestion helpers', () => {
	it('marks the first place the words appear, in any script', () => {
		expect(highlight('Ruby Red Jamdani', 'jamd')).toEqual([
			{ text: 'Ruby Red ', hit: false },
			{ text: 'Jamd', hit: true },
			{ text: 'ani', hit: false },
		]);
		expect(highlight('রুবি লাল জামদানি', 'জামদা')).toEqual([
			{ text: 'রুবি লাল ', hit: false },
			{ text: 'জামদা', hit: true },
			{ text: 'নি', hit: false },
		]);
		expect(highlight('Silk', 'cotton')).toEqual([{ text: 'Silk', hit: false }]);
		expect(highlight('Silk', ' ')).toEqual([{ text: 'Silk', hit: false }]);
	});

	it('matches category names or English slugs, top levels first, with the parent name', () => {
		const bengali = [
			{ ...categories[0], name: 'শাড়ি' },
			{ ...categories[1], name: 'জামদানি' },
			{
				id: 'c3',
				name: 'পিওর সিল্ক',
				slug: 'pure-silk',
				canonical_path: 'sarees/pure-silk',
				level: 2,
				products_count: 300,
			},
		] as never;
		expect(matchCategories(bengali, 'jamdani')).toEqual([{ category: bengali[1], parent: 'শাড়ি' }]);
		expect(matchCategories(bengali, 'pure silk').map((row) => row.category.slug)).toEqual(['pure-silk']);
		expect(matchCategories(bengali, 'শাড়').map((row) => row.parent)).toEqual([null]);
		expect(matchCategories(bengali, 'j')).toEqual([]);
	});
});
