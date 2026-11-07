import { PLATFORM_ID, SimpleChange, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountStore } from '@core/state/account.store';
import { AuthStore } from '@core/state/auth.store';

import { BasicFooter } from '../footer/basic-footer/basic-footer';
import { MyAccount } from './widgets/my-account/my-account';
import { NavbarMenuButton } from './widgets/navbar-menu-button/navbar-menu-button';
import { Notice } from './widgets/notice/notice';
import { Search } from './widgets/search/search';

const swiper = vi.hoisted(() => ({ created: [] as unknown[][] }));
vi.mock('swiper', () => ({
	default: class {
		static use() {
			return undefined;
		}
		constructor(...args: unknown[]) {
			swiper.created.push(args);
		}
	},
}));
vi.mock('swiper/modules', () => ({ Autoplay: 'a', Navigation: 'n', Pagination: 'p' }));

afterEach(() => {
	swiper.created.length = 0;
	vi.useRealTimers();
});

describe('MyAccount', () => {
	it('logs out', () => {
		const auth = { isAuthenticated: signal(true), logout: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: AuthStore, useValue: auth },
				{ provide: AccountStore, useValue: { user: signal(null) } },
			],
		});
		TestBed.overrideComponent(MyAccount, { set: { imports: [], template: '' } });
		TestBed.createComponent(MyAccount).componentInstance.logout();
		expect(auth.logout).toHaveBeenCalledOnce();
	});
});

describe('NavbarMenuButton', () => {
	const render = () => {
		TestBed.resetTestingModule();
		TestBed.overrideComponent(NavbarMenuButton, { set: { imports: [], template: '' } });
		return TestBed.createComponent(NavbarMenuButton).componentInstance;
	};

	it('follows the parent', () => {
		const button = render();
		button.ngOnChanges({ show: new SimpleChange(false, true, false) });
		expect(button.active).toBe(true);
		button.ngOnChanges({});
		expect(button.active).toBeUndefined();
	});

	it('toggles and tells the parent', () => {
		const button = render();
		const seen: boolean[] = [];
		button.activeMenu.subscribe((value) => seen.push(value));
		button.toggleMenu();
		expect(seen).toEqual([true]);
	});
});

describe('Notice', () => {
	const render = (platform: string, template = '<div #swiperContainer></div>') => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: platform }] });
		TestBed.overrideComponent(Notice, { set: { imports: [], template } });
		const fixture = TestBed.createComponent(Notice);
		fixture.detectChanges();
		return fixture;
	};

	it('starts the slider after two seconds in the browser', () => {
		vi.useFakeTimers();
		render('browser');
		expect(swiper.created).toEqual([]);
		vi.advanceTimersByTime(2000);
		expect(swiper.created).toHaveLength(1);
	});

	it('does nothing on the server', () => {
		vi.useFakeTimers();
		render('server');
		vi.advanceTimersByTime(2000);
		expect(swiper.created).toEqual([]);
	});

	it('skips the slider when the element is gone', () => {
		vi.useFakeTimers();
		const { componentInstance } = render('browser');
		Object.defineProperty(componentInstance, 'swiperContainer', { value: () => undefined });
		vi.advanceTimersByTime(2000);
		expect(swiper.created).toEqual([]);
	});
});

describe('Header search', () => {
	const render = () => {
		const router = { navigate: vi.fn() };
		const route = {};
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: ActivatedRoute, useValue: route },
				{ provide: Router, useValue: router },
			],
		});
		TestBed.overrideComponent(Search, { set: { imports: [], template: '' } });
		return { widget: TestBed.createComponent(Search).componentInstance, router, route };
	};

	it('goes to the results with the term, or without one', () => {
		const { widget, router, route } = render();
		widget.term.setValue('silk');
		widget.redirectToSearch();
		expect(router.navigate).toHaveBeenLastCalledWith(['/search'], {
			relativeTo: route,
			queryParams: { category: null, search: 'silk' },
			queryParamsHandling: 'merge',
			skipLocationChange: false,
		});
		widget.term.setValue('');
		widget.redirectToSearch();
		expect(router.navigate.mock.lastCall?.[1].queryParams).toEqual({ category: null, search: null });
	});

	it('toggles the box', () => {
		const { widget } = render();
		widget.toggleSearchBox();
		expect(widget.show).toBe(true);
	});
});

describe('BasicFooter', () => {
	it('opens and closes a section', () => {
		TestBed.resetTestingModule();
		TestBed.overrideComponent(BasicFooter, { set: { imports: [], template: '' } });
		const footer = TestBed.createComponent(BasicFooter).componentInstance;
		footer.toggle('categories');
		expect(footer.active['categories']).toBe(true);
		footer.toggle('categories');
		expect(footer.active['categories']).toBe(false);
	});
});
