import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { Subject, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';
import { NavService } from '@data-access/services/nav.service';

import { Search } from './search';

const ALL = ['product.create', 'product.index', 'order.index', 'setting.index', 'theme_option.index', 'tax.index'];
const RECENT = 'st_admin_recent_pages';

/** The search with its box and form drawn, each reporting a size, as the header draws them. */
const setup = (platform = 'browser') => {
	const events = new Subject<{ type: string }>();
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideRouter([{ path: '**', children: [] }]),
			{ provide: PLATFORM_ID, useValue: platform },
			{ provide: AuthStore, useValue: { permissions: signal(ALL) } },
			{ provide: NavService, useValue: { search: false } },
			{
				provide: TranslocoService,
				useValue: {
					translate: (key: string) => key.replace(/_/g, ' '),
					langChanges$: of('en'),
					events$: events,
					getActiveLang: () => 'en',
				},
			},
		],
	});
	TestBed.overrideComponent(Search, {
		set: { imports: [], template: '<form #searchForm><input #searchInput /></form>' },
	});
	const fixture = TestBed.createComponent(Search);
	fixture.detectChanges();
	const element = fixture.nativeElement as HTMLElement;
	const rect = (left: number, top: number, width: number, height: number) =>
		({ left, top, width, height, bottom: top + height, right: left + width }) as DOMRect;
	(element.querySelector('form') as HTMLFormElement).getBoundingClientRect = () => rect(100, 10, 400, 40);
	(element.querySelector('input') as HTMLInputElement).getBoundingClientRect = () => rect(120, 12, 300, 36);
	return { search: fixture.componentInstance, events };
};

const key = (name: string) => new KeyboardEvent('keydown', { key: name });

afterEach(() => {
	localStorage.clear();
	vi.restoreAllMocks();
});

describe('admin search: places, recent pages and the keys', () => {
	it('places the list under the box, inside the window, and within any window width', async () => {
		const { search } = setup();
		search.show();
		// Measured again once the opening has settled.
		await new Promise((done) => requestAnimationFrame(done));
		expect(search.place()).toEqual({ left: 8, top: 46, width: 600 });
		const width = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(undefined as unknown as number);
		search.show();
		expect(search.place().width).toBe(600);
		width.mockRestore();
	});

	it('on the server: no measuring, no remembering, no reading', () => {
		localStorage.setItem(RECENT, JSON.stringify(['order']));
		const { search } = setup('server');
		search.show();
		expect(search.place()).toEqual({ left: 0, top: 0, width: 600 });
		expect(search.groups().map((group) => group.titleKey)).toEqual(['search_group_go_to']);
		search.type('tax');
		search.onKey(key('Enter'));
		expect(localStorage.getItem(RECENT)).toBe(JSON.stringify(['order']));
	});

	it('reads only a list of page ids, and nothing from a broken copy', () => {
		localStorage.setItem(RECENT, JSON.stringify({ order: true }));
		expect(
			setup()
				.search.groups()
				.map((group) => group.titleKey),
		).toEqual(['search_group_go_to']);
		localStorage.setItem(RECENT, '[not json');
		expect(
			setup()
				.search.groups()
				.map((group) => group.titleKey),
		).toEqual(['search_group_go_to']);
		localStorage.setItem(RECENT, JSON.stringify(['order', 7]));
		expect(setup().search.rows()[0]?.id).toBe('order');
	});

	it('adds one recent page under the matches, and names a nested page by its menu path', () => {
		localStorage.setItem(RECENT, JSON.stringify(['order']));
		const { search, events } = setup();
		events.next({ type: 'langChanged' });
		events.next({ type: 'translationLoadSuccess' });
		search.type('share');
		expect(search.groups().map((group) => group.titleKey)).toEqual(['search_group_pages', 'search_group_recent']);
		const nested = search.rows()[0];
		if (!nested) throw new Error('A match was expected.');
		expect(search.trail(nested)).toEqual(nested.trailKeys);
		expect(nested.trailKeys.length).toBeGreaterThan(0);
	});

	it('opens the list on the arrow keys, and does nothing with no rows or other keys', () => {
		const { search } = setup();
		search.type('zzzz');
		search.close();
		search.onKey(key('ArrowDown'));
		expect([search.open(), search.active()]).toEqual([true, 0]);
		search.onKey(key('ArrowDown'));
		search.onKey(key('Enter'));
		search.onKey(key('a'));
		expect(search.open()).toBe(true);
	});
});
