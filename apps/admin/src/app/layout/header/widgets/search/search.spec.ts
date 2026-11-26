import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { Subject, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';
import { NavService } from '@data-access/services/nav.service';

import { Search } from './search';

const ALL = [
	'product.create',
	'product.index',
	'order.index',
	'setting.index',
	'theme_option.index',
	'tax.index',
	'attachment.index',
];

const setup = (permissions = ALL) => {
	const held = signal(permissions);
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideRouter([{ path: '**', children: [] }]),
			{ provide: AuthStore, useValue: { permissions: held } },
			{ provide: NavService, useValue: { search: false } },
			{
				provide: TranslocoService,
				useValue: {
					translate: (key: string) => key.replace(/^search_hint_/, 'hint ').replace(/_/g, ' '),
					langChanges$: of('en'),
					events$: new Subject(),
					getActiveLang: () => 'en',
				},
			},
		],
	});
	TestBed.overrideComponent(Search, { set: { imports: [], template: '<input #searchInput />' } });
	const fixture = TestBed.createComponent(Search);
	fixture.detectChanges();
	return { search: fixture.componentInstance, router: TestBed.inject(Router), held, nav: TestBed.inject(NavService) };
};

const key = (name: string, extra: Partial<KeyboardEventInit> = {}) =>
	new KeyboardEvent('keydown', { key: name, ...extra });

afterEach(() => localStorage.clear());

describe('admin search', () => {
	it('shows Go to quick links when nothing is typed and nothing was opened before', () => {
		const { search } = setup();
		expect(search.groups().map((group) => group.titleKey)).toEqual(['search_group_go_to']);
		expect(search.rows().map((entry) => entry.id)).toEqual(['product_create', 'order']);
	});

	it('lists matching pages, and moves and wraps with the arrow keys', () => {
		const { search } = setup();
		search.type('share');
		expect(search.open()).toBe(true);
		expect(search.rows()[0]?.id).toBe('storefront_setting_share');
		const count = search.rows().length;
		search.onKey(key('ArrowUp'));
		expect(search.active()).toBe(count - 1);
		search.onKey(key('ArrowDown'));
		expect(search.active()).toBe(0);
		search.onKey(key('Escape'));
		expect(search.open()).toBe(false);
	});

	it('opens a tab with Enter, remembers it, and offers it first next time', async () => {
		const { search, router } = setup();
		const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
		search.type('share');
		search.onKey(key('Enter'));
		expect(navigate).toHaveBeenCalledWith(['/storefront-setting'], { queryParams: { tab: 'share' } });
		expect(search.query()).toBe('');
		expect(JSON.parse(localStorage.getItem('st_admin_recent_pages') ?? '[]')).toEqual(['storefront_setting_share']);
		expect(search.groups()[0]).toMatchObject({ titleKey: 'search_group_recent' });
		expect(search.rows()[0]?.id).toBe('storefront_setting_share');
	});

	it('opens a Brand Kit section by its anchor', () => {
		const { search, router } = setup();
		const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
		search.type('favicn');
		expect(search.outcome().corrected).toEqual({ typed: 'favicn', used: 'favicon' });
		search.go(search.rows()[0]!);
		expect(navigate).toHaveBeenCalledWith(['/setting/brand'], { fragment: 'shop_seal_section' });
	});

	it('remembers pages opened from the menu as well', async () => {
		const { search, router } = setup();
		await router.navigateByUrl('/tax');
		expect(search.rows()[0]?.id).toBe('tax');
	});

	it('never lists a place the operator cannot open', () => {
		const { search } = setup(['order.index']);
		search.type('tax');
		expect(search.rows()).toEqual([]);
		expect(search.groups()).toEqual([]);
	});

	it('opens from any page with Ctrl K or ⌘K, and ignores plain K', () => {
		const { search, nav } = setup();
		search.onDocumentKey(key('k'));
		expect(search.open()).toBe(false);
		search.onDocumentKey(key('k', { ctrlKey: true }));
		expect(search.open()).toBe(true);
		expect(nav.search).toBe(true);
		search.closeSearch();
		search.onDocumentKey(key('K', { metaKey: true }));
		expect(search.open()).toBe(true);
	});

	it('names top-level pages under Home', () => {
		const { search } = setup();
		search.type('dashboard');
		expect(search.trail(search.rows()[0]!)).toEqual(['search_home']);
		expect(search.isActive(search.rows()[0]!)).toBe(true);
		search.focusRow(search.rows()[0]!);
		expect(search.active()).toBe(0);
	});

	it('survives a browser that refuses storage', () => {
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('denied');
		});
		const { search } = setup();
		search.type('tax');
		expect(() => search.go(search.rows()[0]!)).not.toThrow();
		vi.restoreAllMocks();
	});
});
