import { TestBed } from '@angular/core/testing';

import { Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccountAddressService } from '@data-access/services/account-address.service';
import { AccountService } from '@data-access/services/account.service';

import { AccountStore } from './account.store';

const user = { name: 'Asha' };
const refused = () => throwError(() => new Error('refused'));

const setup = () => {
	const account = { GetUserDetails: vi.fn((): Observable<unknown> => of(user)) };
	const addresses = {
		create: vi.fn(() => of(user)),
		update: vi.fn(() => of(user)),
		remove: vi.fn(() => of(user)),
		updateProfile: vi.fn(() => of(user)),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: AccountService, useValue: account },
			{ provide: AccountAddressService, useValue: addresses },
		],
	});
	return { store: TestBed.inject(AccountStore), account, addresses };
};

describe('AccountStore', () => {
	it('loads the customer', () => {
		const { store } = setup();
		store.loadUser();
		TestBed.tick();
		expect(store.user()).toEqual(user);
	});

	it('survives a failed load and keeps what it had', () => {
		const { store, account } = setup();
		store.adoptUser(user as never);
		account.GetUserDetails.mockReturnValue(refused());
		store.loadUser();
		TestBed.tick();
		expect(store.user()).toEqual(user);
	});

	it('clears', () => {
		const { store } = setup();
		store.adoptUser(user as never);
		store.clear();
		expect(store.user()).toBeNull();
	});

	it('adopts the server answer for each write', async () => {
		const { store, addresses } = setup();
		await expect(store.createAddress({} as never)).resolves.toBe(true);
		await expect(store.updateAddress('a1', {})).resolves.toBe(true);
		await expect(store.deleteAddress('a1')).resolves.toBe(true);
		await expect(store.updateProfile('Asha')).resolves.toBe(true);
		expect(addresses.update).toHaveBeenCalledWith('a1', {});
		expect(addresses.remove).toHaveBeenCalledWith('a1');
		expect(addresses.updateProfile).toHaveBeenCalledWith('Asha');
		expect(store.user()).toEqual(user);
	});

	it('reports a failed write without touching the customer', async () => {
		const { store, addresses } = setup();
		addresses.create.mockReturnValue(refused() as never);
		await expect(store.createAddress({} as never)).resolves.toBe(false);
		expect(store.user()).toBeNull();
	});
});
