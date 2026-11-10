import { ViewportScroller } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';

import { Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScrollMemory } from './scroll-memory';

const setup = (platform = 'browser', navigated = false) => {
	const events = new Subject<unknown>();
	let position: [number, number] = [0, 0];
	const scroller = {
		setHistoryScrollRestoration: vi.fn(),
		getScrollPosition: () => position,
		scrollToAnchor: vi.fn(),
	};
	const scrollTo = vi.fn();
	vi.stubGlobal('scrollTo', scrollTo);
	vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => {
		run(0);
		return 0;
	});
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: PLATFORM_ID, useValue: platform },
			{ provide: ViewportScroller, useValue: scroller },
			{
				provide: Router,
				useValue: { events, navigated, parseUrl: (url: string) => ({ fragment: url.split('#')[1] ?? null }) },
			},
		],
	});
	TestBed.inject(ScrollMemory);
	const go = (id: number, url: string, back?: number) => {
		events.next(
			new NavigationStart(id, url, back ? 'popstate' : 'imperative', back ? { navigationId: back } : null),
		);
		events.next(new NavigationEnd(id, url, url));
	};
	return { go, scroller, scrollTo, at: (y: number) => (position = [0, y]) };
};

describe('ScrollMemory', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('leaves the first page where the browser put it', () => {
		const { go, scroller, scrollTo } = setup();
		go(1, '/');
		expect(scroller.setHistoryScrollRestoration).toHaveBeenCalledWith('manual');
		expect(scrollTo).not.toHaveBeenCalled();
	});

	it('opens a new page at the top, and Back returns to the saved spot', () => {
		const { go, scrollTo, at } = setup();
		Object.defineProperty(document.documentElement, 'scrollHeight', { value: 6000, configurable: true });
		go(1, '/');
		at(2500);
		go(2, '/product/a');
		expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, left: 0, behavior: 'instant' });
		at(300);
		go(3, '/', 1);
		expect(scrollTo).toHaveBeenLastCalledWith({ top: 2500, left: 0, behavior: 'instant' });
	});

	it('moves the very next page when it starts after the first page has loaded', () => {
		const { go, scrollTo } = setup('browser', true);
		go(2, '/product/a');
		expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, left: 0, behavior: 'instant' });
	});

	it('scrolls to a fragment on a new page', () => {
		const { go, scroller } = setup();
		go(1, '/');
		go(2, '/faq#shipping');
		expect(scroller.scrollToAnchor).toHaveBeenCalledWith('shipping');
	});

	it('does nothing on the server', () => {
		const { go, scroller, scrollTo } = setup('server');
		go(1, '/');
		go(2, '/cart');
		expect(scroller.setHistoryScrollRestoration).not.toHaveBeenCalled();
		expect(scrollTo).not.toHaveBeenCalled();
	});
});
