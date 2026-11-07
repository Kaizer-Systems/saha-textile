import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountStore } from '@core/state/account.store';
import { AuthStore } from '@core/state/auth.store';

import { Sidebar } from './sidebar';

const data = signal<unknown>(undefined);
vi.mock('@data-access/queries/notification.queries', () => ({
	injectNotificationsQuery: () => ({ data }),
}));

const render = () => {
	const auth = { logout: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: AuthStore, useValue: auth },
			{ provide: AccountStore, useValue: { user: signal(null) } },
		],
	});
	TestBed.overrideComponent(Sidebar, { set: { imports: [], template: '' } });
	const sidebar = TestBed.createComponent(Sidebar).componentInstance;
	TestBed.tick();
	return { sidebar, auth };
};

afterEach(() => data.set(undefined));

describe('Account sidebar', () => {
	it('counts unread notifications', () => {
		const { sidebar } = render();
		expect(sidebar.unreadNotificationCount).toBe(0);
		data.set([{ read_at: null }, { read_at: 'now' }]);
		TestBed.tick();
		expect(sidebar.unreadNotificationCount).toBe(1);
	});

	it('logs out', () => {
		const { sidebar, auth } = render();
		sidebar.logout();
		expect(auth.logout).toHaveBeenCalledOnce();
	});

	it('toggles the menu', () => {
		const { sidebar } = render();
		const seen: boolean[] = [];
		sidebar.menu.subscribe((value) => seen.push(value));
		sidebar.openMenu(true);
		expect(seen).toEqual([true]);
	});
});
