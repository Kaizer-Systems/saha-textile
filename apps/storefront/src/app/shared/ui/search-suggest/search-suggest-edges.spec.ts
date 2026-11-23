import { CurrencyPipe } from '@angular/common';
import { Component, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConsentStore } from '@core/consent/consent.store';
import { ACTIVE_LOCALE } from '@core/i18n/active-locale';
import { CategoryService } from '@data-access/services/category.service';
import { ProductService } from '@data-access/services/product.service';

import { SearchSuggest } from './search-suggest';
import { matchCategories } from './search-suggest-options';

import type { ICategory } from '@data-access/interfaces/category.interface';
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

@Component({
	template: `
		<input
			#field
			[value]="control.value"
		/>
		<app-search-suggest
			[field]="field"
			[control]="control"
		/>
	`,
	imports: [SearchSuggest],
})
class Host {
	control = new FormControl<string | null>('');
}

interface Options {
	platform?: string;
	trendingKind?: string;
	cardsFor?: (slugs: string[]) => Observable<IProduct[]>;
	autoDetect?: boolean;
	functional?: boolean;
}

function render(options: Options = {}) {
	const service = {
		search: vi.fn(() => of({ items: [jamdani], total: 1 })),
		trending: vi.fn(() => of({ kind: options.trendingKind ?? 'trending', items: [tant] })),
		cardsFor: vi.fn(options.cardsFor ?? (() => of([jamdani]))),
		searchClick: vi.fn(),
	};
	const router = { navigate: vi.fn(), navigateByUrl: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [Host, TranslocoTestingModule.forRoot({ langs: { en: {} }, translocoConfig: { defaultLang: 'en' } })],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: ProductService, useValue: service },
			{ provide: CategoryService, useValue: { getCategories: () => of({ data: [], total: 0 }) } },
			{ provide: ConsentStore, useValue: { allows: () => options.functional ?? true } },
			{ provide: Router, useValue: router },
			{ provide: ACTIVE_LOCALE, useValue: 'en' },
			{ provide: PLATFORM_ID, useValue: options.platform ?? 'browser' },
			CurrencyPipe,
		],
	});
	const fixture = TestBed.createComponent(Host);
	if (options.autoDetect !== false) fixture.autoDetectChanges();
	const field = (fixture.nativeElement as HTMLElement).querySelector('input') as HTMLInputElement;
	const suggest = () => fixture.debugElement.query(By.directive(SearchSuggest)).componentInstance as SearchSuggest;
	const settle = async () => {
		await fixture.whenStable();
		await new Promise((resolve) => setTimeout(resolve, 0));
	};
	return { fixture, field, suggest, service, router, settle };
}

afterEach(() => {
	localStorage.clear();
	document.querySelector('.mobile-menu')?.remove();
});

describe('SearchSuggest: the edges', () => {
	it('does nothing on the server: no listeners, no box, no history', () => {
		localStorage.setItem('st_search', JSON.stringify({ terms: ['silk'], products: [] }));
		const { field, suggest } = render({ platform: 'server' });
		expect(field.getAttribute('role')).toBeNull();
		suggest().show();
		expect(suggest().open()).toBe(false);
		suggest().forget('silk');
		suggest().clearAll();
		expect(localStorage.getItem('st_search')).not.toBeNull();
	});

	it('titles a list of best sellers as popular picks', async () => {
		const { field, suggest, settle } = render({ trendingKind: 'bestsellers' });
		field.dispatchEvent(new Event('focus'));
		await settle();
		expect(suggest().sections()[0]?.title).toBe('popular_picks');
		expect(suggest().announcement()).toBe('search_suggestions_count');
	});

	it('opens at once when the field already had focus before it was wired up', async () => {
		const { fixture, field, suggest } = render({ autoDetect: false });
		field.focus();
		fixture.detectChanges();
		await fixture.whenStable();
		await Promise.resolve();
		expect(suggest().open()).toBe(true);
	});

	it('fits itself again on a resize only while it is open, above the phone’s bottom bar', async () => {
		const bar = document.createElement('div');
		bar.className = 'mobile-menu';
		bar.getBoundingClientRect = () => ({ top: 500, height: 60 }) as DOMRect;
		document.body.append(bar);
		const { field, suggest, fixture } = render();
		const host = fixture.debugElement.query(By.directive(SearchSuggest)).nativeElement as HTMLElement;
		window.dispatchEvent(new Event('resize'));
		expect(host.style.getPropertyValue('--suggest-room')).toBe('');
		field.dispatchEvent(new Event('focus'));
		expect(suggest().open()).toBe(true);
		window.dispatchEvent(new Event('resize'));
		expect(host.style.getPropertyValue('--suggest-room')).toBe('488px');
	});

	it('drops a highlight that no longer points at a row', async () => {
		const { suggest, fixture } = render();
		suggest().active.set(4);
		fixture.detectChanges();
		await fixture.whenStable();
		expect(suggest().active()).toBe(-1);
	});

	it('opens a category without a path at the collections root', () => {
		const { suggest, router } = render();
		suggest().select({ kind: 'category', id: 'c', category: { name: 'All' } as ICategory, parent: null });
		expect(router.navigateByUrl).toHaveBeenCalledWith('/collections/');
	});

	it('keeps focus in the field when a row is pressed', () => {
		const { suggest } = render();
		const event = new Event('mousedown', { cancelable: true });
		suggest().keepFocus(event);
		expect(event.defaultPrevented).toBe(true);
	});

	it('ignores keys while a Bengali letter is being built', () => {
		const { field, suggest } = render();
		field.dispatchEvent(new Event('compositionstart'));
		field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
		expect(suggest().open()).toBe(false);
		field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', isComposing: true }));
		expect(suggest().open()).toBe(false);
	});

	it('closes on a press outside only, and never while it is already closed', () => {
		const { field, suggest, fixture } = render();
		document.dispatchEvent(new Event('pointerdown'));
		field.dispatchEvent(new Event('focus'));
		field.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		const host = fixture.debugElement.query(By.directive(SearchSuggest)).nativeElement as HTMLElement;
		host.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		expect(suggest().open()).toBe(true);
		document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		expect(suggest().open()).toBe(false);
	});

	describe('products opened from search', () => {
		const remember = (products: string[]) =>
			localStorage.setItem('st_search', JSON.stringify({ terms: [], products }));

		it('reads them once, and again only when the list has changed', async () => {
			remember([jamdani.slug]);
			const { field, suggest, service, settle } = render();
			field.dispatchEvent(new Event('focus'));
			await settle();
			suggest().close();
			field.dispatchEvent(new Event('focus'));
			expect(service.cardsFor).toHaveBeenCalledOnce();
		});

		it('leaves out a product the shop no longer has', async () => {
			remember([jamdani.slug, 'gone-saree']);
			const { field, suggest, settle } = render();
			field.dispatchEvent(new Event('focus'));
			await settle();
			expect(
				suggest()
					.options()
					.map((row) => row.kind),
			).toEqual(['product']);
		});

		it('shows none when they cannot be read', async () => {
			remember([jamdani.slug]);
			const { field, suggest, settle } = render({ cardsFor: () => throwError(() => new Error('offline')) });
			field.dispatchEvent(new Event('focus'));
			await settle();
			expect(
				suggest()
					.options()
					.some((row) => row.kind === 'product' && row.product === jamdani),
			).toBe(false);
		});
	});
});

describe('SearchSuggest: keys and opening products without words', () => {
	const key = (field: HTMLInputElement, name: string) =>
		field.dispatchEvent(new KeyboardEvent('keydown', { key: name, cancelable: true }));

	it('opens a trending product without logging a search, and remembers it only with consent', async () => {
		for (const functional of [true, false]) {
			localStorage.clear();
			const { field, suggest, service, router, settle } = render({ functional });
			field.dispatchEvent(new Event('focus'));
			await settle();
			const [row] = suggest().options();
			if (row) suggest().select(row);
			expect(service.searchClick).not.toHaveBeenCalled();
			expect(router.navigate).toHaveBeenCalledWith(['/product', tant.slug]);
			expect(localStorage.getItem('st_search') !== null).toBe(functional);
		}
	});

	it('moves down from an open list, does nothing on Up or Down with no rows, and Delete forgets only a remembered term', async () => {
		const { field, suggest, settle } = render();
		key(field, 'ArrowUp');
		key(field, 'ArrowDown');
		expect(suggest().active()).toBe(-1);
		field.dispatchEvent(new Event('focus'));
		await settle();
		key(field, 'ArrowDown');
		key(field, 'ArrowDown');
		expect(suggest().active()).toBe(0);
		key(field, 'Delete');
		expect(suggest().options()).toHaveLength(1);
	});
});

describe('matchCategories: the edges', () => {
	const row = (over: Partial<ICategory>) => ({ name: 'x', slug: 'x', ...over }) as ICategory;

	it('skips categories without a path and ranks by level, then size, ties kept in order', () => {
		const rows = [
			row({ name: 'Silk', slug: 'silk' }),
			row({ name: 'Silk', slug: 'silk-top', canonical_path: 'silk' }),
			row({ name: 'Silk mix', slug: 'silk-mix', canonical_path: 'silk-mix' }),
			row({ name: 'Silk sarees', slug: 'silk-sarees', canonical_path: 'sarees/silk-sarees', level: 2 }),
			row({ name: 'Raw silk', slug: 'raw-silk', canonical_path: 'raw-silk', products_count: 3 }),
		];
		expect(matchCategories(rows, 'silk').map(({ category }) => category.slug)).toEqual([
			'raw-silk',
			'silk-top',
			'silk-mix',
		]);
	});

	it('names no parent when the parent is not in the list', () => {
		const rows = [row({ name: 'Silk dupattas', slug: 'silk-dupattas', canonical_path: 'dupattas/silk' })];
		expect(matchCategories(rows, 'silk')).toEqual([{ category: rows[0], parent: null }]);
	});
});
