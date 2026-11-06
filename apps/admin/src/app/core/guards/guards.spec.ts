import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';
import { MenuStore } from '@core/state/menu.store';
import { NavService } from '@data-access/services/nav.service';

import { AuthGuard } from './auth.guard';
import { PermissionGuard } from './permission.guard';

const setup = (signedIn: boolean, permissions: string[] = []) => {
	const router = { createUrlTree: vi.fn(() => 'login'), navigate: vi.fn() };
	const menu = { loadBadges: vi.fn() };
	const nav = { sidebarLoading: true };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: Router, useValue: router },
			{ provide: MenuStore, useValue: menu },
			{ provide: NavService, useValue: nav },
			{ provide: AuthStore, useValue: { isAuthenticated: signal(signedIn), permissions: signal(permissions) } },
		],
	});
	return { router, menu, nav };
};

describe('AuthGuard', () => {
	it('sends a guest to log in', () => {
		setup(false);
		const guard = TestBed.inject(AuthGuard);
		expect(guard.canActivate()).toBe('login');
		expect(guard.canActivateChild()).toBe('login');
	});

	it('lets an operator in and loads the sidebar once', () => {
		const { menu, nav } = setup(true);
		const guard = TestBed.inject(AuthGuard);
		expect(guard.canActivate()).toBe(true);
		expect(guard.canActivateChild()).toBe(true);
		expect(menu.loadBadges).toHaveBeenCalledOnce();
		expect(nav.sidebarLoading).toBe(false);
	});
});

describe('PermissionGuard', () => {
	const check = (data: unknown, permissions: string[]) => {
		const parts = setup(true, permissions);
		const result = TestBed.inject(PermissionGuard).canActivate({ data } as never, {} as never);
		return { result, ...parts };
	};

	it('allows a route that needs nothing', () => {
		expect(check({}, []).result).toBe(true);
		expect(check(undefined, []).result).toBe(true);
	});

	it('allows a single permission that is held', () => {
		expect(check({ permission: 'a' }, ['a']).result).toBe(true);
	});

	it('allows a list only when every item is held', () => {
		expect(check({ permission: ['a', 'b'] }, ['a', 'b']).result).toBe(true);
		const missing = check({ permission: ['a', 'b'] }, ['a']);
		expect(missing.result).toBe(false);
		expect(missing.router.navigate).toHaveBeenCalledWith(['/error/403']);
	});

	it('refuses a missing single permission and an empty list', () => {
		expect(check({ permission: 'a' }, []).result).toBe(false);
		expect(check({ permission: [] }, ['a']).result).toBe(false);
	});
});
