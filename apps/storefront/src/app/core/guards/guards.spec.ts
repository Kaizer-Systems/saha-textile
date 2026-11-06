import { ViewportScroller } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router, Scroll } from '@angular/router';

import { Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';
import { AuthService } from '@data-access/services/auth.service';

import { AuthGuard, guestOnlyGuard } from './auth.guard';
import { ScrollPositionGuard } from './scroll.guard';

const setup = (signedIn: boolean) => {
	const router = { createUrlTree: vi.fn((commands: string[]) => commands.join('')) };
	const auth: { redirectUrl?: string } = {};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: Router, useValue: router },
			{ provide: AuthService, useValue: auth },
			{ provide: AuthStore, useValue: { isAuthenticated: signal(signedIn) } },
		],
	});
	return { router, auth };
};

describe('AuthGuard', () => {
	it('lets a signed-in customer through', () => {
		setup(true);
		expect(TestBed.inject(AuthGuard).canActivate({} as never, { url: '/account' } as never)).toBe(true);
	});

	it('sends a guest to log in and remembers the page', () => {
		const { auth } = setup(false);
		expect(TestBed.inject(AuthGuard).canActivate({} as never, { url: '/account' } as never)).toBe('/auth/login');
		expect(auth.redirectUrl).toBe('/account');
	});
});

describe('guestOnlyGuard', () => {
	it('sends a customer to the dashboard and lets a guest in', () => {
		setup(true);
		expect(TestBed.runInInjectionContext(() => guestOnlyGuard({} as never, {} as never))).toBe(
			'/account/dashboard',
		);
		setup(false);
		expect(TestBed.runInInjectionContext(() => guestOnlyGuard({} as never, {} as never))).toBe(true);
	});
});

describe('ScrollPositionGuard', () => {
	const run = (url: string) => {
		const events = new Subject<unknown>();
		const scroller = { scrollToPosition: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: Router, useValue: { events, url } },
				{ provide: ViewportScroller, useValue: scroller },
			],
		});
		expect(TestBed.inject(ScrollPositionGuard).canActivate()).toBe(true);
		events.next(new NavigationEnd(1, url, url));
		events.next(new Scroll(new NavigationEnd(1, url, url), null, null));
		return scroller;
	};

	it('goes to the top on most pages', () => {
		expect(run('/cart').scrollToPosition.mock.calls).toEqual([[[0, 0]]]);
	});

	it('keeps the listing offset on collections', () => {
		expect(run('/collections').scrollToPosition.mock.calls).toEqual([[[150, 150]]]);
	});
});
