import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';

import { Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MinimalHeader } from './minimal-header/minimal-header';
import { MobileMenu } from './widgets/mobile-menu/mobile-menu';

describe('MinimalHeader', () => {
	const render = (platform = 'browser') => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: platform }] });
		TestBed.overrideComponent(MinimalHeader, { set: { imports: [], template: '' } });
		return TestBed.createComponent(MinimalHeader).componentInstance;
	};
	const scrolled = (y: number) => {
		vi.stubGlobal('pageYOffset', y);
	};

	afterEach(() => {
		vi.unstubAllGlobals();
		document.documentElement.scrollTop = 0;
		document.body.scrollTop = 0;
	});

	it('sticks past 150 pixels on a wide enough screen', () => {
		const header = render();
		scrolled(200);
		header.onWindowScroll();
		expect(header.stick).toBe(true);
		scrolled(100);
		header.onWindowScroll();
		expect(header.stick).toBe(false);
	});

	it('does not stick on a narrow screen', () => {
		const header = render();
		scrolled(200);
		vi.stubGlobal('innerWidth', 300);
		header.onWindowScroll();
		expect(header.stick).toBe(false);
	});

	it('reads the older scroll positions, and defaults to zero', () => {
		const header = render();
		scrolled(0);
		document.documentElement.scrollTop = 200;
		header.onWindowScroll();
		expect(header.stick).toBe(true);
		document.documentElement.scrollTop = 0;
		document.body.scrollTop = 200;
		header.onWindowScroll();
		expect(header.stick).toBe(true);
		document.body.scrollTop = 0;
		header.onWindowScroll();
		expect(header.stick).toBe(false);
	});

	it('does nothing on the server', () => {
		const header = render('server');
		scrolled(200);
		header.onWindowScroll();
		expect(header.stick).toBe(false);
	});

	it('toggles', () => {
		const header = render();
		header.toggle(true);
		expect(header.active).toBe(true);
	});
});

describe('MobileMenu', () => {
	const render = () => {
		const events = new Subject<unknown>();
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: Router, useValue: { events } }] });
		TestBed.overrideComponent(MobileMenu, { set: { imports: [], template: '' } });
		return { menu: TestBed.createComponent(MobileMenu).componentInstance, events };
	};
	const active = (menu: MobileMenu) => menu.menuItem.filter((item) => item.active).map((item) => item.path);

	it('follows navigation, ignoring the query and other events', () => {
		const { menu, events } = render();
		events.next(new NavigationStart(1, '/cart'));
		expect(active(menu)).toEqual(['/']);
		events.next(new NavigationEnd(2, '/cart?x=1', '/cart?x=1'));
		expect(active(menu)).toEqual(['/cart']);
		events.next(new NavigationEnd(3, '/account', '/account'));
		expect(active(menu)).toEqual([]);
	});

	it('marks the pressed item only', () => {
		const { menu } = render();
		menu.activeMenu(menu.menuItem[2]!);
		expect(active(menu)).toEqual(['/search']);
	});
});
