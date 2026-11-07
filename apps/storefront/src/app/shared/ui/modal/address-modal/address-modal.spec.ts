import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccountStore } from '@core/state/account.store';

import { AddressModal } from './address-modal';

const countries = signal<unknown>([
	{ id: 356, name: 'India', calling_code: '91' },
	{ id: 840, name: 'United States', calling_code: '1' },
	{ id: 999, name: 'Nowhere' },
]);
const states = signal<unknown>([
	{ id: 1, name: 'West Bengal', country_id: 356 },
	{ id: 2, name: 'Texas', country_id: 840 },
]);
vi.mock('@data-access/queries/country.queries', () => ({ injectCountriesQuery: () => ({ data: countries }) }));
vi.mock('@data-access/queries/state.queries', () => ({ injectStatesQuery: () => ({ data: states }) }));

const render = (platform = 'browser', result: Promise<unknown> = Promise.resolve('closed')) => {
	const open = vi.fn(() => ({ result }));
	const dismissAll = vi.fn();
	const account = {
		updateAddress: vi.fn(async () => true),
		createAddress: vi.fn(async () => true),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbModal, useValue: { open, dismissAll } },
			{ provide: AccountStore, useValue: account },
			{ provide: PLATFORM_ID, useValue: platform },
		],
	});
	TestBed.overrideComponent(AddressModal, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(AddressModal);
	return { fixture, modal: fixture.componentInstance, open, dismissAll, account };
};
const filled = {
	title: 'Home',
	street: '1 Park Street',
	country_id: 356,
	state_id: 1,
	city: 'Kolkata',
	pincode: '700016',
	country_code: '91',
	phone: '9000000000',
};
const saved = {
	address_id: 'a1',
	user_id: 3,
	title: 'Home',
	street: '1 Park Street',
	city: 'Kolkata',
	pincode: '700016',
	phone: '9000000000',
	country_code: 91,
	is_default: true,
	country: { name: 'India' },
	state: { name: 'West Bengal' },
} as never;

describe('AddressModal pickers', () => {
	it('lists the countries, and an empty list before they load', async () => {
		const { modal } = render();
		expect(await firstValueFrom(modal.countries$)).toHaveLength(3);
		countries.set(undefined);
		const later = render().modal;
		expect(await firstValueFrom(later.countries$)).toEqual([]);
		countries.set([
			{ id: 356, name: 'India', calling_code: '91' },
			{ id: 840, name: 'United States', calling_code: '1' },
			{ id: 999, name: 'Nowhere' },
		]);
	});

	it('filters the states to the chosen country and follows its dial code', async () => {
		const { modal } = render();
		expect(await firstValueFrom(modal.states$)).toEqual([]);
		modal.form.patchValue({ state_id: 1 });
		modal.countryChange({ value: 840 } as never);
		expect(modal.form.value).toMatchObject({ state_id: '', country_code: '1' });
		TestBed.tick();
		expect(await firstValueFrom(modal.states$)).toEqual([{ label: 'Texas', value: 2, country_id: 840 }]);
	});

	it('keeps the dial code for a country without one, and for no country', async () => {
		const { modal } = render();
		modal.countryChange({ value: 999 } as never);
		expect(modal.form.value.country_code).toBe('91');
		modal.countryChange(undefined as never);
		modal.countryChange({ value: '' } as never);
		expect(await firstValueFrom(modal.states$)).toEqual([]);
	});

	it('survives data that has not loaded', async () => {
		const held = [countries(), states()];
		countries.set(undefined);
		states.set(undefined);
		const { modal } = render();
		modal.countryChange({ value: 356 } as never);
		expect(await firstValueFrom(modal.states$)).toEqual([]);
		modal.patchForm(saved);
		expect(modal.form.value.country_id).toBe('');
		modal.form.patchValue(filled);
		await modal.submit();
		countries.set(held[0]);
		states.set(held[1]);
	});
});

describe('AddressModal.openModal', () => {
	it('opens nothing on the server', async () => {
		const { modal, open } = render('server');
		await modal.openModal();
		expect(modal.isBrowser).toBe(false);
		expect(open).not.toHaveBeenCalled();
	});

	it('opens empty for a new address', async () => {
		const { modal, open } = render();
		modal.form.patchValue({ title: 'Old' });
		await modal.openModal();
		expect(open).toHaveBeenCalledOnce();
		expect(modal.address).toBeNull();
		expect(modal.form.value).toMatchObject({ title: null, country_code: '91' });
	});

	it('fills every picker from a saved address', async () => {
		const { modal } = render();
		await modal.openModal(saved);
		expect(modal.form.value).toMatchObject({
			title: 'Home',
			country_id: 356,
			state_id: 1,
			country_code: '91',
		});
		expect(await firstValueFrom(modal.states$)).toHaveLength(1);
	});

	it('falls back for a saved address it cannot place', () => {
		const { modal } = render();
		modal.patchForm({ title: 'X', country_code: 44, country: { name: 'Atlantis' } } as never);
		expect(modal.form.value).toMatchObject({ country_id: '', state_id: '', country_code: '44' });
		modal.patchForm({ title: 'Y' } as never);
		expect(modal.form.value.country_code).toBe('91');
	});

	it.each([
		[ModalDismissReasons.ESC, 'Dismissed by pressing ESC'],
		[ModalDismissReasons.BACKDROP_CLICK, 'Dismissed by clicking on a backdrop'],
		['cross', 'Dismissed with: cross'],
	])('records how it was dismissed (%s)', async (reason, text) => {
		const { modal } = render('browser', Promise.reject(reason));
		await modal.openModal();
		await Promise.resolve();
		await Promise.resolve();
		expect(modal.closeResult).toBe(text);
	});
});

describe('AddressModal.submit', () => {
	it('stops on an invalid form', async () => {
		const { modal, account } = render();
		await modal.submit();
		expect(account.createAddress).not.toHaveBeenCalled();
	});

	it('stops on a country it no longer knows', async () => {
		const { modal, account } = render();
		modal.form.patchValue({ ...filled, country_id: 1 });
		await modal.submit();
		expect(account.createAddress).not.toHaveBeenCalled();
	});

	it('creates an address with names and one E.164 phone', async () => {
		const { modal, account, dismissAll } = render();
		modal.form.patchValue(filled);
		await modal.submit();
		expect(account.createAddress).toHaveBeenCalledWith({
			label: 'Home',
			fullName: 'Home',
			line1: '1 Park Street',
			line2: '',
			city: 'Kolkata',
			state: 'West Bengal',
			postalCode: '700016',
			country: 'India',
			phone: '+919000000000',
			isDefault: false,
		});
		expect(dismissAll).toHaveBeenCalledOnce();
		expect(modal.form.value.country_code).toBe('91');
	});

	it('updates a saved address and keeps it the default', async () => {
		const { modal, account } = render();
		modal.patchForm(saved);
		await modal.submit();
		expect(account.updateAddress).toHaveBeenCalledWith('a1', expect.objectContaining({ isDefault: true }));
	});

	it('stays open when saving fails', async () => {
		const { modal, account, dismissAll } = render();
		account.createAddress.mockResolvedValue(false);
		modal.form.patchValue(filled);
		await modal.submit();
		expect(dismissAll).not.toHaveBeenCalled();
		expect(modal.form.value.title).toBe('Home');
	});

	it('leaves the state empty when the states have not loaded', async () => {
		const held = states();
		const { modal, account } = render();
		states.set(undefined);
		modal.form.patchValue(filled);
		await modal.submit();
		states.set(held);
		expect(account.createAddress).toHaveBeenCalledWith(expect.objectContaining({ state: '' }));
	});

	it('leaves the state empty when it is not in the list', async () => {
		const { modal, account } = render();
		modal.form.patchValue({ ...filled, state_id: 77 });
		await modal.submit();
		expect(account.createAddress).toHaveBeenCalledWith(expect.objectContaining({ state: '' }));
	});
});

describe('AddressModal leaving', () => {
	it('closes an open dialog only', () => {
		const closed = render();
		closed.fixture.destroy();
		expect(closed.dismissAll).not.toHaveBeenCalled();
		const open = render();
		open.modal.modalOpen = true;
		open.fixture.destroy();
		expect(open.dismissAll).toHaveBeenCalledOnce();
	});
});
