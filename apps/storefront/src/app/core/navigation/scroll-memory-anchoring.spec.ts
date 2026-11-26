import { ViewportScroller } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';

import { Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScrollMemory } from './scroll-memory';

/** Timers with a delay wait to be run by hand; zero-delay ones and the restore retries run at once. */
const later: Array<{ run: () => void; ms: number }> = [];

const setup = () => {
	const events = new Subject<unknown>();
	let position: [number, number] = [0, 0];
	const scrollTo = vi.fn();
	const scrollBy = vi.fn();
	vi.stubGlobal('scrollTo', scrollTo);
	vi.stubGlobal('scrollBy', scrollBy);
	vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => {
		run(0);
		return 0;
	});
	vi.stubGlobal('setTimeout', (run: () => void, ms?: number) => {
		if (!ms || ms === 16) run();
		else later.push({ run, ms });
		return later.length;
	});
	vi.stubGlobal('clearTimeout', vi.fn());
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: PLATFORM_ID, useValue: 'browser' },
			{
				provide: ViewportScroller,
				useValue: {
					setHistoryScrollRestoration: vi.fn(),
					getScrollPosition: () => position,
					scrollToAnchor: vi.fn(),
				},
			},
			{ provide: Router, useValue: { events, navigated: false, parseUrl: () => ({ fragment: null }) } },
		],
	});
	TestBed.inject(ScrollMemory);
	const go = (id: number, url: string, restored?: { navigationId: number } | null) => {
		events.next(new NavigationStart(id, url, restored !== undefined ? 'popstate' : 'imperative', restored ?? null));
		events.next(new NavigationEnd(id, url, url));
	};
	return { go, events, scrollTo, scrollBy, at: (y: number) => (position = [0, y]) };
};

let tops: number[] = [];
const sections = (count: number) =>
	Array.from({ length: count }, (_, index) => {
		const row = document.createElement('section');
		row.getBoundingClientRect = () =>
			({ top: tops[index], bottom: (tops[index] ?? 0) + 400, height: 400 }) as DOMRect;
		document.body.append(row);
		return row;
	});

/** Stands in for the browser's ResizeObserver, which jsdom does not have. */
class Watcher {
	static last: Watcher | null = null;
	disconnect = vi.fn();
	constructor(readonly fire: () => void) {
		Watcher.last = this;
	}
	observe(): void {}
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	later.length = 0;
	tops = [];
	Watcher.last = null;
	document.body.innerHTML = '';
});

const tall = (height: number) =>
	Object.defineProperty(document.documentElement, 'scrollHeight', { value: height, configurable: true });

describe('ScrollMemory: restoring after Back', () => {
	it('ignores the router’s other events', () => {
		const { events, scrollTo } = setup();
		events.next({ type: 'other' });
		expect(scrollTo).not.toHaveBeenCalled();
	});

	it('treats a Back without a saved entry as a new page', () => {
		const { go, scrollTo } = setup();
		go(1, '/');
		go(2, '/sarees', null);
		expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, left: 0, behavior: 'instant' });
	});

	it('waits for a short page to grow, then goes back anyway once the wait is over', () => {
		const { go, scrollTo, at } = setup();
		tall(800);
		const now = vi.spyOn(performance, 'now');
		now.mockReturnValueOnce(0).mockReturnValueOnce(100).mockReturnValue(5000);
		go(1, '/');
		at(2500);
		go(2, '/product/a');
		go(3, '/', { navigationId: 1 });
		expect(scrollTo).toHaveBeenLastCalledWith({ top: 2500, left: 0, behavior: 'instant' });
		expect(now).toHaveBeenCalledTimes(3);
	});

	it('moves nothing when the section on screen has gone, or has barely moved', () => {
		const { go, scrollBy, at } = setup();
		tall(6000);
		tops = [-400, 240];
		const rows = sections(2);
		go(1, '/');
		at(2500);
		go(2, '/product/a');
		rows.forEach((row) => row.remove());
		go(3, '/', { navigationId: 1 });
		expect(scrollBy).not.toHaveBeenCalled();

		tops = [-400, 240];
		sections(2);
		at(2500);
		go(4, '/product/b');
		tops = [-399, 241];
		go(5, '/', { navigationId: 3 });
		expect(scrollBy).not.toHaveBeenCalled();
	});

	it('keeps the section in place while content fills in, until the shopper scrolls or time runs out', () => {
		vi.stubGlobal('ResizeObserver', Watcher);
		const { go, scrollBy, at } = setup();
		tall(6000);
		tops = [-400, 240];
		sections(2);
		go(1, '/');
		at(2500);
		go(2, '/product/a');
		go(3, '/', { navigationId: 1 });
		const watcher = Watcher.last as Watcher;

		watcher.fire();
		expect(scrollBy).not.toHaveBeenCalled();
		tops = [-100, 540];
		watcher.fire();
		expect(scrollBy).toHaveBeenCalledWith({ top: 300, left: 0, behavior: 'instant' });

		window.dispatchEvent(new Event('wheel'));
		expect(watcher.disconnect).toHaveBeenCalled();

		at(2500);
		go(4, '/product/b');
		go(5, '/', { navigationId: 3 });
		const second = Watcher.last as Watcher;
		expect(later.at(-1)?.ms).toBe(1500);
		later.at(-1)?.run();
		expect(second.disconnect).toHaveBeenCalled();
	});
});
