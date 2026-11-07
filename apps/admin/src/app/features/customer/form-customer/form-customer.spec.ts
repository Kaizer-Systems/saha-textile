import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminCustomersGateway } from '@core/admin-customers/admin-customers.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { FormCustomer } from './form-customer';

const client = vi.hoisted(() => ({ invalidateQueries: vi.fn() }));
const customer = signal<unknown>(undefined);
const countries = signal<unknown>([
	{ id: 356, name: 'India', iso_3166_2: 'IN' },
	{ id: 840, name: 'United States', iso_3166_2: 'US' },
	{ id: 999, name: 'Nowhere' },
]);
const states = signal<unknown>([
	{ id: 1, name: 'West Bengal', country_id: 356 },
	{ id: 2, name: 'Texas', country_id: 840 },
]);

vi.mock('@tanstack/angular-query-experimental', async (original) => ({
	...(await original<object>()),
	injectQueryClient: () => client,
	injectMutation: (
		build: () => { mutationFn: (vars: unknown) => Promise<unknown>; onSuccess?: (result: never) => void },
	) => {
		const options = build();
		return {
			mutate: (vars: unknown) =>
				void options.mutationFn(vars).then((result) => options.onSuccess?.(result as never)),
		};
	},
}));
vi.mock('@data-access/queries/country.queries', () => ({ injectCountriesQuery: () => ({ data: countries }) }));
vi.mock('@data-access/queries/state.queries', () => ({ injectStatesQuery: () => ({ data: states }) }));
vi.mock('@data-access/queries/admin-customers.queries', () => ({
	injectAdminCustomerQuery: (id: () => unknown) => {
		id();
		return { data: customer };
	},
}));

const setup = (type = 'create', id: string | null = null, template = '') => {
	const gateway = {
		create: vi.fn(() => of({ id: 'c9' })),
		update: vi.fn(() => of({})),
		resendActivation: vi.fn(() => of({})),
		addAddress: vi.fn(() => of({})),
		updateAddress: vi.fn(() => of({})),
		deleteAddress: vi.fn(() => of({})),
	};
	const router = { navigateByUrl: vi.fn() };
	const modal = { open: vi.fn(), dismissAll: vi.fn() };
	const notification = { showSuccess: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: AdminCustomersGateway, useValue: gateway },
			{ provide: Router, useValue: router },
			{ provide: NgbModal, useValue: modal },
			{ provide: NotificationService, useValue: notification },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
			{ provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => id } } } },
		],
	});
	TestBed.overrideComponent(FormCustomer, { set: { imports: [], template } });
	const fixture = TestBed.createComponent(FormCustomer);
	fixture.componentRef.setInput('type', type);
	fixture.detectChanges();
	TestBed.tick();
	return { fixture, page: fixture.componentInstance, gateway, router, modal, notification };
};
const settle = async () => {
	for (let i = 0; i < 12; i += 1) await Promise.resolve();
};
const profile = { displayName: ' Asha ', email: 'a@b.co', phone: '9000000000', status: 'active' };
const address = (overrides: Record<string, unknown> = {}) => ({
	id: 'a1',
	label: 'Home',
	fullName: 'Asha',
	line1: 'Line 1',
	line2: 'Line 2',
	city: 'Kolkata',
	state: 'West Bengal',
	postalCode: '700016',
	country: 'IN',
	phone: '+919000000000',
	isDefault: true,
	...overrides,
});
const addressValue = {
	fullName: 'Asha',
	line1: 'Line 1',
	city: 'Kolkata',
	country_id: 356,
	state_id: 1,
	postalCode: '700016',
	phone: '9000000000',
};
const saved = (overrides: Record<string, unknown> = {}) => ({
	id: 'c1',
	displayName: 'Asha',
	email: 'a@b.co',
	phone: '+919000000000',
	status: 'active',
	addresses: [address()],
	...overrides,
});

afterEach(() => {
	customer.set(undefined);
	client.invalidateQueries.mockClear();
});

describe('FormCustomer validators', () => {
	it('needs one channel, and the contact that channel uses', () => {
		const { page } = setup();
		page.form.patchValue({ ...profile, channelEmail: false, channelSms: false, channelWhatsapp: false });
		expect(page.form.errors).toMatchObject({ channelsRequired: true });
		page.form.patchValue({ channelEmail: true, email: '' });
		expect(page.form.errors).toMatchObject({ emailRequiredForChannel: true });
		page.form.patchValue({ email: 'a@b.co', channelSms: true, phone: '' });
		expect(page.form.errors).toMatchObject({ phoneRequiredForChannel: true });
		page.form.patchValue({ channelSms: false, channelWhatsapp: true });
		expect(page.form.errors).toMatchObject({ phoneRequiredForChannel: true });
		page.form.patchValue({ phone: null, email: null });
		page.form.patchValue({ phone: '9000000000', email: 'a@b.co' });
		expect(page.form.errors).toBeNull();
	});
});

describe('FormCustomer reading', () => {
	it('fills from a saved customer and stops requiring channels', () => {
		const { page } = setup('edit', 'c1');
		customer.set(saved());
		TestBed.tick();
		expect(page.form.value).toMatchObject({ displayName: 'Asha', country_code: '91', phone: '9000000000' });
		expect(page.addressForms.length).toBe(1);
		expect(page.addressGroupAt(0).value).toMatchObject({ country_id: 356, state_id: 1, isDefault: true });
	});

	it('shows a deleted customer as disabled, and fills blanks', () => {
		const { page } = setup('edit', 'c1');
		customer.set(saved({ displayName: null, email: null, phone: null, status: 'deleted', addresses: undefined }));
		TestBed.tick();
		expect(page.form.value).toMatchObject({ displayName: '', email: '', status: 'disabled' });
		expect(page.addresses()).toEqual([]);
	});

	it('reads a phone with no plus, and an unknown code', () => {
		const { page } = setup('edit', 'c1');
		customer.set(saved({ phone: '900 000' }));
		TestBed.tick();
		expect(page.form.value).toMatchObject({ country_code: '91', phone: '900000' });
		customer.set(saved({ phone: '+0001' }));
		TestBed.tick();
		expect(page.form.value.phone).toBe('0001');
	});

	it('offers a resend for pending, disabled or locked customers only', () => {
		const { page } = setup('edit', 'c1');
		expect(page.canResendActivation()).toBe(false);
		for (const status of ['pending', 'disabled', 'locked']) {
			customer.set(saved({ status }));
			expect(page.canResendActivation()).toBe(true);
		}
		customer.set(saved());
		expect(page.canResendActivation()).toBe(false);
	});

	it('does not rebuild the forms for the same rows', () => {
		const { page } = setup('edit', 'c1');
		customer.set(saved());
		TestBed.tick();
		const first = page.addressGroupAt(0);
		customer.set(saved({ displayName: 'Changed' }));
		TestBed.tick();
		expect(page.addressGroupAt(0)).toBe(first);
	});

	it('waits for the countries before building address rows', () => {
		const held = countries();
		countries.set(undefined);
		const { page } = setup('edit', 'c1');
		customer.set(saved());
		TestBed.tick();
		expect(page.addressForms.length).toBe(0);
		countries.set([]);
		TestBed.tick();
		expect(page.addressForms.length).toBe(0);
		countries.set(held);
		TestBed.tick();
		expect(page.addressForms.length).toBe(1);
	});

	it('builds rows that have no country, state or optional parts', () => {
		const { page } = setup('edit', 'c1');
		customer.set(
			saved({
				addresses: [
					address({
						label: undefined,
						line2: undefined,
						state: undefined,
						country: '',
						phone: undefined,
						isDefault: undefined,
					}),
					address({ id: 'a2', country: 'United States', state: 'Nope' }),
					address({ id: 'a3', country: 'Atlantis', state: 'Nope' }),
				],
			}),
		);
		TestBed.tick();
		expect(page.addressGroupAt(0).value).toMatchObject({ label: '', country_id: 356, state_id: '' });
		expect(page.addressGroupAt(1).value).toMatchObject({ country_id: 840, state_id: '' });
		expect(page.addressGroupAt(2).value).toMatchObject({ country_id: 356 });
	});

	it('leaves the state blank while the states are loading', () => {
		const held = states();
		states.set(undefined);
		const { page } = setup('edit', 'c1');
		customer.set(saved());
		TestBed.tick();
		expect(page.addressGroupAt(0).value.state_id).toBe('');
		states.set(held);
	});

	it('lists the countries and the states of a chosen country', async () => {
		const { page } = setup();
		expect(await firstValueFrom(page.countries$)).toHaveLength(3);
		expect(await firstValueFrom(page.modalStates$)).toHaveLength(2);
		page.modalCountryChange({ value: 840 } as never);
		TestBed.tick();
		expect(await firstValueFrom(page.modalStates$)).toEqual([{ label: 'Texas', value: 2, country_id: 840 }]);
		page.modalCountryChange(undefined as never);
		const group = page.addressForm;
		group.patchValue({ country_id: 356 });
		expect(page.statesForGroup(group)).toHaveLength(1);
		group.patchValue({ country_id: '' });
		expect(page.statesForGroup(group)).toHaveLength(2);
	});

	it('survives lists that have not loaded', async () => {
		const held = [countries(), states()];
		countries.set(undefined);
		states.set(undefined);
		const { page } = setup();
		expect(await firstValueFrom(page.countries$)).toEqual([]);
		expect(page.statesForGroup(page.addressForm)).toEqual([]);
		page.addressForm.patchValue({ ...addressValue });
		page.submitAddress();
		countries.set(held[0]);
		states.set(held[1]);
	});
});

describe('FormCustomer.submit', () => {
	it('stops on an invalid form', () => {
		const { page, gateway } = setup();
		page.submit();
		expect(gateway.create).not.toHaveBeenCalled();
	});

	it('stops when the phone is only spaces', () => {
		const { page, gateway } = setup('edit', 'c1');
		customer.set(saved());
		TestBed.tick();
		page.form.controls['phone']?.clearValidators();
		page.form.patchValue({ phone: '  ' });
		page.submit();
		expect(gateway.update).not.toHaveBeenCalled();
	});

	it('creates with the draft addresses, then opens the new customer', async () => {
		const { page, gateway, router } = setup();
		page.form.patchValue({ ...profile, channelSms: true, channelWhatsapp: true });
		page.addressForm.patchValue(addressValue);
		page.submitAddress();
		page.submit();
		await settle();
		expect(gateway.create).toHaveBeenCalledWith(
			expect.objectContaining({
				displayName: 'Asha',
				email: 'a@b.co',
				phone: '+919000000000',
				status: 'active',
				activationChannels: ['email', 'sms', 'whatsapp'],
			}),
		);
		expect(gateway.addAddress).toHaveBeenCalledOnce();
		expect(router.navigateByUrl).toHaveBeenCalledWith('/customer/edit/c9');
	});

	it('updates an existing customer, and needs an id', async () => {
		const { page, gateway } = setup('edit', 'c1');
		customer.set(saved());
		TestBed.tick();
		page.submit();
		await settle();
		expect(gateway.update).toHaveBeenCalledWith('c1', {
			displayName: 'Asha',
			email: 'a@b.co',
			phone: '+919000000000',
			status: 'active',
		});
		const noId = setup('edit');
		noId.page.form.patchValue(profile);
		noId.page.submit();
		expect(noId.gateway.update).not.toHaveBeenCalled();
	});

	it('uses the dial code as written when the picker has no match', () => {
		const { page, gateway } = setup();
		page.form.patchValue({ ...profile, country_code: '0000' });
		page.submit();
		expect(gateway.create.mock.lastCall).toBeDefined();
		expect((gateway.create.mock.lastCall as unknown[])[0]).toMatchObject({ phone: '+00009000000000' });
	});

	it('sends empty text for controls that hold nothing', () => {
		const { page, gateway } = setup('edit', 'c1');
		customer.set(saved());
		TestBed.tick();
		page.form.controls['displayName']?.clearValidators();
		page.form.controls['email']?.clearValidators();
		page.form.controls['country_code']?.clearValidators();
		page.form.patchValue({ displayName: null, email: null, country_code: null });
		page.submit();
		expect(gateway.update).toHaveBeenCalledWith('c1', expect.objectContaining({ displayName: '', email: '' }));
		page.form.controls['phone']?.clearValidators();
		page.form.patchValue({ phone: null });
		gateway.update.mockClear();
		page.submit();
		expect(gateway.update).not.toHaveBeenCalled();
	});
});

describe('FormCustomer.resendActivation', () => {
	const ready = () => {
		const parts = setup('edit', 'c1');
		customer.set(saved());
		TestBed.tick();
		return parts;
	};

	it('needs a channel and an id', () => {
		const { page, gateway } = ready();
		page.activationForm.patchValue({ channelEmail: false });
		page.resendActivation();
		expect(gateway.resendActivation).not.toHaveBeenCalled();
		const noId = setup('edit');
		noId.page.resendActivation();
		expect(noId.gateway.resendActivation).not.toHaveBeenCalled();
	});

	it('needs the contact the channel uses', () => {
		const { page } = ready();
		page.form.patchValue({ email: '' });
		page.resendActivation();
		expect(page.activationForm.errors).toEqual({ emailRequiredForChannel: true });
		page.form.patchValue({ email: 'a@b.co', phone: '' });
		page.activationForm.patchValue({ channelEmail: false, channelSms: true });
		page.resendActivation();
		expect(page.activationForm.errors).toEqual({ phoneRequiredForChannel: true });
		page.activationForm.patchValue({ channelSms: false, channelWhatsapp: true });
		page.resendActivation();
		expect(page.activationForm.errors).toEqual({ phoneRequiredForChannel: true });
		page.form.patchValue({ email: null, phone: null });
		page.activationForm.patchValue({ channelEmail: true, channelWhatsapp: false });
		page.resendActivation();
		expect(page.activationForm.errors).toEqual({ emailRequiredForChannel: true });
	});

	it('resends', async () => {
		const { page, gateway } = ready();
		page.resendActivation();
		await settle();
		expect(gateway.resendActivation).toHaveBeenCalledWith('c1', { activationChannels: ['email'] });
	});
});

describe('FormCustomer address dialog', () => {
	it('waits for its template', () => {
		const { page, modal } = setup();
		page.openAddressModal();
		expect(modal.open).not.toHaveBeenCalled();
	});

	it('opens on the chosen country', () => {
		const { page, modal } = setup('create', null, '<ng-template #addAddressModal></ng-template>');
		page.openAddressModal();
		expect(modal.open).toHaveBeenCalledOnce();
		page.addressForm.patchValue({ country_id: '' });
		page.openAddressModal();
		expect(modal.open).toHaveBeenCalledTimes(2);
	});

	it('clears the state when the country changes on a row', () => {
		const { page } = setup('edit', 'c1');
		customer.set(saved());
		TestBed.tick();
		page.addressCountryChange(0, { value: 840 } as never);
		expect(page.addressGroupAt(0).value).toMatchObject({ country_id: 840, state_id: '' });
		page.addressCountryChange(0, undefined as never);
		expect(page.addressGroupAt(0).value.country_id).toBe(840);
	});

	it('stops on an incomplete address', () => {
		const { page, modal } = setup();
		page.addressForm.patchValue({ country_id: 356 });
		page.submitAddress();
		expect(modal.dismissAll).not.toHaveBeenCalled();
	});

	it('keeps drafts while creating, the first as default', () => {
		const { page, modal } = setup();
		page.addressForm.patchValue(addressValue);
		page.submitAddress();
		expect(page.addresses()[0]).toMatchObject({ isDefault: true, country: 'IN', state: 'West Bengal' });
		expect(modal.dismissAll).toHaveBeenCalledOnce();
		page.addressForm.patchValue(addressValue);
		page.submitAddress();
		expect(page.addresses()[1]?.isDefault).toBe(false);
		page.addressForm.patchValue({ ...addressValue, isDefault: true, label: ' Work ', line2: ' Flat ' });
		page.submitAddress();
		expect(page.addresses().map((row) => row.isDefault)).toEqual([false, false, true]);
		expect(page.addresses()[2]).toMatchObject({ label: 'Work', line2: 'Flat' });
	});

	it('falls back to India for a country with no code, and no state name', () => {
		const { page } = setup();
		page.addressForm.patchValue({ ...addressValue, country_id: 999, state_id: 77 });
		page.submitAddress();
		expect(page.addresses()[0]).toMatchObject({ country: 'IN', state: '' });
		page.addressForm.controls['state_id']?.clearValidators();
		page.addressForm.patchValue({ ...addressValue, state_id: '' });
		page.addressForm.controls['state_id']?.updateValueAndValidity();
		page.submitAddress();
		expect(page.addresses()[1]).toMatchObject({ state: '' });
	});

	it('adds to a saved customer, and needs an id', async () => {
		const { page, gateway, modal } = setup('edit', 'c1');
		page.addressForm.patchValue(addressValue);
		page.submitAddress();
		await settle();
		expect(gateway.addAddress).toHaveBeenCalledOnce();
		expect(modal.dismissAll).toHaveBeenCalledOnce();
		const noId = setup('edit');
		noId.page.addressForm.patchValue(addressValue);
		noId.page.submitAddress();
		expect(noId.gateway.addAddress).not.toHaveBeenCalled();
	});
});

describe('FormCustomer saved rows', () => {
	const row = () => {
		const parts = setup('edit', 'c1');
		customer.set(saved());
		TestBed.tick();
		return parts;
	};

	it('stops on an invalid row', () => {
		const { page, gateway } = row();
		page.addressGroupAt(0).patchValue({ fullName: '' });
		page.saveAddressAt(0);
		expect(gateway.updateAddress).not.toHaveBeenCalled();
	});

	it('saves a row', async () => {
		const { page, gateway } = row();
		page.saveAddressAt(0);
		await settle();
		expect(gateway.updateAddress).toHaveBeenCalledWith('c1', 'a1', expect.objectContaining({ fullName: 'Asha' }));
	});

	it('needs ids to save', () => {
		const { page, gateway } = row();
		page.addressGroupAt(0).patchValue({ id: '' });
		page.saveAddressAt(0);
		expect(gateway.updateAddress).not.toHaveBeenCalled();
		page.addressGroupAt(0).patchValue({ id: null });
		page.saveAddressAt(0);
		expect(gateway.updateAddress).not.toHaveBeenCalled();
	});

	it('sends empty text for row controls that hold nothing', () => {
		const { page, gateway } = row();
		const group = page.addressGroupAt(0);
		for (const name of ['fullName', 'line1', 'city', 'postalCode', 'country_code', 'phone']) {
			group.controls[name]?.clearValidators();
		}
		group.patchValue({
			label: null,
			line2: null,
			fullName: null,
			line1: null,
			city: null,
			postalCode: null,
			country_code: null,
			phone: null,
		});
		group.updateValueAndValidity();
		page.saveAddressAt(0);
		expect(gateway.updateAddress).toHaveBeenCalledWith(
			'c1',
			'a1',
			expect.objectContaining({ fullName: '', line1: '', phone: '', label: undefined }),
		);
	});

	it('makes one row the default', () => {
		const { page, gateway } = setup('edit', 'c1');
		customer.set(saved({ addresses: [address(), address({ id: 'a2', isDefault: false })] }));
		TestBed.tick();
		page.onDefaultToggle(1, { target: { checked: true } } as never);
		expect(page.addressGroupAt(0).value.isDefault).toBe(false);
		expect(page.addressGroupAt(1).value.isDefault).toBe(true);
		expect(gateway.updateAddress).toHaveBeenCalledOnce();
	});

	it('updates a draft row and keeps one default', () => {
		const { page } = setup();
		page.addressForm.patchValue(addressValue);
		page.submitAddress();
		page.addressForm.patchValue(addressValue);
		page.submitAddress();
		TestBed.tick();
		page.addressGroupAt(1).patchValue({ isDefault: true, city: 'Howrah' });
		page.saveAddressAt(1);
		expect(page.addresses()[0]?.isDefault).toBe(false);
		expect(page.addresses()[1]).toMatchObject({ city: 'Howrah', isDefault: true });
		TestBed.tick();
		page.addressGroupAt(0).patchValue({ city: 'Salt Lake' });
		page.saveAddressAt(0);
		expect(page.addresses()[1]?.isDefault).toBe(true);
	});

	it('asks before deleting a real row', () => {
		const { page } = row();
		const openModal = vi.fn();
		Object.defineProperty(page, 'DeleteModal', { value: () => ({ openModal }) });
		page.confirmDeleteAddress(0);
		expect(openModal).toHaveBeenCalledWith('delete', { id: 'a1', index: 0 });
		page.addressGroupAt(0).patchValue({ id: '' });
		page.confirmDeleteAddress(0);
		page.addressGroupAt(0).patchValue({ id: null });
		page.confirmDeleteAddress(0);
		expect(openModal).toHaveBeenCalledOnce();
	});

	it('copes with the delete dialog being absent', () => {
		const { page } = row();
		expect(() => page.confirmDeleteAddress(0)).not.toThrow();
	});

	it('deletes a saved row after confirmation', async () => {
		const { page, gateway, notification } = row();
		page.onDeleteConfirmed({ actionToPerform: 'other', data: {} } as never);
		page.onDeleteConfirmed({ actionToPerform: 'delete', data: {} } as never);
		page.onDeleteConfirmed({ actionToPerform: 'delete' } as never);
		expect(gateway.deleteAddress).not.toHaveBeenCalled();
		page.onDeleteConfirmed({ actionToPerform: 'delete', data: { id: 'a1' } } as never);
		await settle();
		expect(gateway.deleteAddress).toHaveBeenCalledWith('c1', 'a1');
		expect(notification.showSuccess).toHaveBeenCalledWith('address_deleted_successfully');
	});

	it('removes a draft, and needs an id for a saved row', () => {
		const { page } = setup();
		page.addressForm.patchValue(addressValue);
		page.submitAddress();
		const id = page.addresses()[0]?.id;
		page.onDeleteConfirmed({ actionToPerform: 'delete', data: { id } } as never);
		expect(page.addresses()).toEqual([]);
		const noId = setup('edit');
		noId.page.onDeleteConfirmed({ actionToPerform: 'delete', data: { id: 'a1' } } as never);
		expect(noId.gateway.deleteAddress).not.toHaveBeenCalled();
	});
});
