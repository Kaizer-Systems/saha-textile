import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountStore } from '@core/state/account.store';
import { LoaderStore } from '@core/state/loader.store';

import { Account } from './account';
import { Adresses } from './adresses/adresses';
import { Dashboard } from './dashboard/dashboard';
import { Notification } from './notification/notification';

const notifications = signal<unknown>(undefined);
vi.mock('@data-access/queries/notification.queries', () => ({
	injectNotificationsQuery: () => ({ data: notifications }),
}));

afterEach(() => notifications.set(undefined));

describe('Account shell', () => {
	it('opens and closes the menu', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: LoaderStore, useValue: { status: signal(false) } },
				{ provide: TranslocoService, useValue: { selectTranslate: () => of('Dashboard') } },
			],
		});
		TestBed.overrideComponent(Account, { set: { imports: [], template: '' } });
		const shell = TestBed.createComponent(Account).componentInstance;
		shell.openMenu(true);
		expect(shell.open).toBe(true);
	});
});

describe('Adresses', () => {
	const render = () => {
		const store = { user: signal(null), deleteAddress: vi.fn(async () => true) };
		const close = vi.fn();
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: AccountStore, useValue: store }] });
		TestBed.overrideComponent(Adresses, { set: { imports: [], template: '' } });
		return { page: TestBed.createComponent(Adresses).componentInstance, store, close };
	};

	it('deletes a saved address', () => {
		const { page, store } = render();
		page.delete('delete', { address_id: 'a1' } as never);
		expect(store.deleteAddress).toHaveBeenCalledWith('a1');
	});

	it('ignores another action, or a row with no server id', () => {
		const { page, store } = render();
		page.delete('other', { address_id: 'a1' } as never);
		page.delete('delete', {} as never);
		expect(store.deleteAddress).not.toHaveBeenCalled();
	});
});

describe('Dashboard', () => {
	const render = () => {
		const user = signal<unknown>(null);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: AccountStore, useValue: { user } }] });
		TestBed.overrideComponent(Dashboard, { set: { imports: [], template: '' } });
		const page = TestBed.createComponent(Dashboard).componentInstance;
		TestBed.tick();
		return { page, user };
	};

	it('shows the first address, or none', () => {
		const { page, user } = render();
		user.set({ address: [{ id: 1 }, { id: 2 }] });
		TestBed.tick();
		expect(page.address).toEqual({ id: 1 });
		user.set({ address: [] });
		TestBed.tick();
		expect(page.address).toBeNull();
	});
});

describe('Notification page', () => {
	it('lists the notifications, empty until loaded', async () => {
		TestBed.resetTestingModule();
		TestBed.overrideComponent(Notification, { set: { imports: [], template: '' } });
		const page = TestBed.createComponent(Notification).componentInstance;
		TestBed.tick();
		expect(await firstValueFrom(page.notification$)).toEqual([]);
		notifications.set([{ id: 1 }]);
		TestBed.tick();
		expect(await firstValueFrom(page.notification$)).toEqual([{ id: 1 }]);
	});
});
