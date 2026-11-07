import { ViewportScroller } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { BehaviorSubject, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CartFacade } from '@core/state/cart/cart.facade';

import { BackToTop } from './back-to-top/back-to-top';
import { BlogCarousel } from './blog-carousel/blog-carousel';
import { StickyCart } from './sticky-cart/sticky-cart';

describe('BackToTop', () => {
	const render = (platform = 'browser') => {
		const scroller = { scrollToPosition: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: PLATFORM_ID, useValue: platform },
				{ provide: ViewportScroller, useValue: scroller },
			],
		});
		TestBed.overrideComponent(BackToTop, { set: { imports: [], template: '' } });
		return { widget: TestBed.createComponent(BackToTop).componentInstance, scroller };
	};

	afterEach(() => {
		vi.unstubAllGlobals();
		document.documentElement.scrollTop = 0;
		document.body.scrollTop = 0;
	});

	it('appears past 600 pixels', () => {
		const { widget } = render();
		vi.stubGlobal('pageYOffset', 700);
		widget.onWindowScroll();
		expect(widget.show).toBe(true);
		vi.stubGlobal('pageYOffset', 100);
		widget.onWindowScroll();
		expect(widget.show).toBe(false);
	});

	it('reads the older scroll positions, and defaults to zero', () => {
		const { widget } = render();
		vi.stubGlobal('pageYOffset', 0);
		document.documentElement.scrollTop = 700;
		widget.onWindowScroll();
		expect(widget.show).toBe(true);
		document.documentElement.scrollTop = 0;
		document.body.scrollTop = 700;
		widget.onWindowScroll();
		expect(widget.show).toBe(true);
		document.body.scrollTop = 0;
		widget.onWindowScroll();
		expect(widget.show).toBe(false);
	});

	it('does nothing on the server', () => {
		const { widget } = render('server');
		widget.onWindowScroll();
		expect(widget.show).toBeUndefined();
	});

	it('goes to the top', () => {
		const { widget, scroller } = render();
		widget.tapToTop();
		expect(scroller.scrollToPosition).toHaveBeenCalledWith([0, 0]);
	});
});

describe('BlogCarousel', () => {
	const render = (blogs: unknown[]) => {
		TestBed.resetTestingModule();
		TestBed.overrideComponent(BlogCarousel, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(BlogCarousel);
		fixture.componentRef.setInput('blogs', blogs);
		return fixture.componentInstance;
	};

	it('marks a single post', () => {
		expect(render([{}]).isSingle()).toBe(true);
		expect(render([{}, {}]).isSingle()).toBe(false);
	});

	it('shows up to three, and at least one', () => {
		expect(render([{}, {}, {}, {}]).options().responsive?.[992]?.items).toBe(3);
		expect(render([]).options().responsive?.[0]?.items).toBe(1);
	});
});

describe('StickyCart', () => {
	it('follows the store, and can be opened by hand', () => {
		const sticky = new BehaviorSubject(false);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: CartFacade, useValue: { cartItems$: of([]), cartTotal$: of(0), stickyCart$: sticky } },
			],
		});
		TestBed.overrideComponent(StickyCart, { set: { imports: [], template: '' } });
		const widget = TestBed.createComponent(StickyCart).componentInstance;
		expect(widget.isOpen).toBe(false);
		sticky.next(true);
		expect(widget.isOpen).toBe(true);
		widget.openCart(false);
		expect(widget.isOpen).toBe(false);
	});
});
