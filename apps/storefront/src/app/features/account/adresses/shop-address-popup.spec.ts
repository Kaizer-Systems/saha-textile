import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CheckoutGateway } from '@core/checkout/checkout.gateway';
import { AccountStore } from '@core/state/account.store';

import { Adresses } from './adresses';
import { ShopAddressPopup } from './shop-address-popup';

import type { PostalAddressInput } from '@saha-textile/contracts';

const ADDRESS = { fullName: 'Asha', line1: '12 Park Street', city: 'Kolkata' } as PostalAddressInput;

const renderPopup = (saveAddress = vi.fn(() => of({}))) => {
	const close = vi.fn();
	const loadUser = vi.fn();
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbActiveModal, useValue: { close } },
			{ provide: CheckoutGateway, useValue: { saveAddress } },
			{ provide: AccountStore, useValue: { loadUser } },
		],
	});
	TestBed.overrideComponent(ShopAddressPopup, { set: { imports: [], template: '' } });
	return { popup: TestBed.createComponent(ShopAddressPopup).componentInstance, close, loadUser, saveAddress };
};

describe('ShopAddressPopup', () => {
	it('starts a new address, default only when it is the first one', () => {
		const { popup } = renderPopup();
		popup.start(null, true);
		expect([popup.addressId(), popup.label(), popup.isDefault()]).toEqual([null, '', true]);
		popup.start(null, false);
		expect(popup.isDefault()).toBe(false);
	});

	it('starts from a saved address with its own name and default switch', () => {
		const { popup } = renderPopup();
		popup.start({ address_id: 'adr_1', title: 'Home', is_default: true }, false);
		expect([popup.addressId(), popup.label(), popup.isDefault()]).toEqual(['adr_1', 'Home', true]);
		popup.start({}, true);
		expect([popup.addressId(), popup.label(), popup.isDefault()]).toEqual([null, '', false]);
	});

	it('saves only a complete address with a name, then reads the account again and closes', async () => {
		const { popup, saveAddress, loadUser, close } = renderPopup();
		popup.start({ address_id: 'adr_1' }, false);
		await popup.save();
		popup.address.set(ADDRESS);
		popup.label.set('  ');
		expect(popup.ready()).toBe(false);
		await popup.save();
		expect(saveAddress).not.toHaveBeenCalled();

		popup.label.set(' Office ');
		popup.isDefault.set(true);
		await popup.save();
		expect(saveAddress).toHaveBeenCalledWith('adr_1', { ...ADDRESS, label: 'Office', isDefault: true });
		expect(loadUser).toHaveBeenCalled();
		expect(close).toHaveBeenCalledWith(true);
		expect(popup.busy()).toBe(false);
	});

	it('says so and stays open when the address cannot be saved', async () => {
		const { popup, close } = renderPopup(vi.fn(() => throwError(() => new Error('refused'))));
		popup.address.set(ADDRESS);
		popup.label.set('Home');
		await popup.save();
		expect(popup.error()).toBe(true);
		expect(popup.busy()).toBe(false);
		expect(close).not.toHaveBeenCalled();
	});
});

describe('Adresses', () => {
	const render = (user: unknown) => {
		const start = vi.fn();
		const open = vi.fn(() => ({ componentInstance: { start } }));
		const deleteAddress = vi.fn(async () => undefined);
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: NgbModal, useValue: { open } },
				{ provide: AccountStore, useValue: { user: signal(user), deleteAddress } },
			],
		});
		TestBed.overrideComponent(Adresses, { set: { imports: [], template: '' } });
		return { page: TestBed.createComponent(Adresses).componentInstance, open, start, deleteAddress };
	};

	it('opens the address pop-up, making the first address the default', () => {
		const first = render(null);
		first.page.openAddress(null);
		expect(first.open).toHaveBeenCalledWith(ShopAddressPopup, {
			centered: true,
			size: 'lg',
			windowClass: 'theme-modal',
		});
		expect(first.start).toHaveBeenCalledWith(null, true);

		const row = { address_id: 'adr_1' } as never;
		const more = render({ address: [row] });
		more.page.openAddress(row);
		expect(more.start).toHaveBeenCalledWith(row, false);
	});

	it('deletes by the server’s id, and only on a delete', () => {
		const { page, deleteAddress } = render(null);
		page.delete('cancel', { address_id: 'adr_1' } as never);
		page.delete('delete', { id: 7 } as never);
		page.delete('delete', { address_id: 'adr_1' } as never);
		expect(deleteAddress).toHaveBeenCalledExactlyOnceWith('adr_1');
	});
});
