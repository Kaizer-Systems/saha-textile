import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Store } from '@ngrx/store';
import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminCustomersGateway } from '@core/admin-customers/admin-customers.gateway';
import { LoaderStore } from '@core/state/loader.store';
import { SettingStore } from '@core/state/setting.store';

import { AddressBlock } from './address-block/address-block';
import { Checkout } from './checkout';
import { DeliveryBlock } from './delivery-block/delivery-block';
import { AddAddressModal } from './modal/add-address-modal/add-address-modal';
import { AddCustomerModal } from './modal/add-customer-modal/add-customer-modal';
import { CouponModal } from './modal/coupon-modal/coupon-modal';
import { PaymentBlock } from './payment-block/payment-block';

const client = vi.hoisted(() => ({ invalidateQueries: vi.fn() }));
const customers = signal<unknown>(undefined);
const countries = signal<unknown>(undefined);
const states = signal<unknown>(undefined);
const customerParams: Array<() => Record<string, unknown>> = [];

vi.mock('@tanstack/angular-query-experimental', async (original) => ({
	...(await original<object>()),
	injectQueryClient: () => client,
	injectMutation: (build: () => { mutationFn: (vars: unknown) => Promise<unknown>; onSuccess?: () => void }) => {
		const options = build();
		return { mutate: (vars: unknown) => void options.mutationFn(vars).then(() => options.onSuccess?.()) };
	},
}));
vi.mock('@data-access/queries/admin-customers.queries', () => ({
	injectAdminCustomersQuery: (p: () => Record<string, unknown>) => {
		customerParams.push(p);
		return { data: customers };
	},
}));
vi.mock('@data-access/queries/country.queries', () => ({ injectCountriesQuery: () => ({ data: countries }) }));
vi.mock('@data-access/queries/state.queries', () => ({ injectStatesQuery: () => ({ data: states }) }));

const settle = async () => {
	for (let i = 0; i < 12; i += 1) await Promise.resolve();
};

const renderCheckout = (
	items: unknown[] = [
		{ product_id: 1, variation_id: 2, quantity: 1 },
		{ product_id: 3, quantity: 2 },
	],
) => {
	const cart = new BehaviorSubject(items);
	const store = { select: vi.fn(() => cart), dispatch: vi.fn() };
	const router = { navigateByUrl: vi.fn() };
	const gateway = { get: vi.fn(() => of({ id: 'c1', addresses: [] })) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: Store, useValue: store },
			{ provide: Router, useValue: router },
			{ provide: AdminCustomersGateway, useValue: gateway },
			{ provide: SettingStore, useValue: { setting: signal(null) } },
			{ provide: LoaderStore, useValue: {} },
		],
	});
	TestBed.overrideComponent(Checkout, { set: { imports: [], template: '<input #cpn />' } });
	const fixture = TestBed.createComponent(Checkout);
	fixture.detectChanges();
	TestBed.tick();
	return { fixture, page: fixture.componentInstance, store, router, gateway, cart };
};
const fill = (page: Checkout) =>
	page.form.patchValue({
		consumer_id: 'c1',
		shipping_address_id: 1,
		billing_address_id: 2,
		delivery_description: 'Standard',
		payment_method: 'online',
	});

afterEach(() => {
	for (const value of [customers, countries, states]) value.set(undefined);
	customerParams.length = 0;
	client.invalidateQueries.mockClear();
	vi.useRealTimers();
	document.body.classList.remove('loader-none');
});

describe('Checkout', () => {
	it('loads the cart lines', () => {
		const { page, store } = renderCheckout();
		expect(store.dispatch).toHaveBeenCalledOnce();
		expect(page.productControl.value).toEqual([
			{ product_id: 1, variation_id: 2, quantity: 1 },
			{ product_id: 3, variation_id: '', quantity: 2 },
		]);
	});

	it('goes back to the order screen with an empty cart', () => {
		const { router } = renderCheckout([]);
		expect(router.navigateByUrl).toHaveBeenCalledWith('/order/create');
	});

	it('lists active and pending customers by their best name', async () => {
		const { page } = renderCheckout();
		expect(await firstValueFrom(page.users$)).toEqual([]);
		customers.set({
			items: [
				{ id: 'a', status: 'active', displayName: 'Asha' },
				{ id: 'b', status: 'pending', email: 'b@c.d' },
				{ id: 'c', status: 'active' },
				{ id: 'd', status: 'disabled', displayName: 'Hidden' },
			],
		});
		TestBed.tick();
		expect(await firstValueFrom(page.users$)).toEqual([
			{ label: 'Asha', value: 'a' },
			{ label: 'b@c.d', value: 'b' },
			{ label: 'c', value: 'c' },
		]);
	});

	it('loads a chosen customer, shaping the addresses', async () => {
		const { page, gateway } = renderCheckout();
		gateway.get.mockReturnValue(
			of({
				id: 'c1',
				addresses: [
					{
						id: 'a1',
						label: 'Home',
						line1: 'L1',
						line2: 'L2',
						city: 'K',
						state: 'WB',
						country: 'IN',
						postalCode: '7',
						phone: '1',
					},
					{ id: 'a2', fullName: 'Asha', line1: 'L1', city: 'K', country: 'IN', postalCode: '7' },
				],
			}) as never,
		);
		page.form.patchValue({ shipping_address_id: 1 });
		page.selectUser({ value: 'c1' } as never);
		await settle();
		TestBed.tick();
		expect(page.form.value.shipping_address_id).toBeNull();
		expect(await firstValueFrom(page.selectedUser$)).toMatchObject({
			address: [
				{ title: 'Home', street: 'L1, L2', state: { name: 'WB' } },
				{ title: 'Asha', street: 'L1', state: null },
			],
		});
	});

	it('copes with a customer with no address list, and with no pick', async () => {
		const { page, gateway } = renderCheckout();
		gateway.get.mockReturnValue(of({ id: 'c1' }) as never);
		page.selectUser({ value: 'c1' } as never);
		await settle();
		TestBed.tick();
		expect(await firstValueFrom(page.selectedUser$)).toEqual({ id: 'c1', address: [] });
		gateway.get.mockClear();
		page.selectUser({ value: '' } as never);
		page.selectUser(null as never);
		expect(gateway.get).not.toHaveBeenCalled();
	});

	it('searches customers after a pause', () => {
		vi.useFakeTimers();
		const { page } = renderCheckout();
		const params = customerParams.at(-1) as () => Record<string, unknown>;
		page.searchUser({ search: ' asha ' } as never);
		vi.advanceTimersByTime(300);
		expect(params()).toEqual({ pageSize: 15, q: 'asha' });
		expect(document.body.classList.contains('loader-none')).toBe(true);
		page.userDropdown({ innerSearchText: 'x' } as never);
		vi.advanceTimersByTime(300);
		expect(params()).toEqual({ pageSize: 15 });
		page.searchUser({ search: 'kept' } as never);
		vi.advanceTimersByTime(300);
		page.userDropdown({ innerSearchText: '' } as never);
		vi.advanceTimersByTime(300);
		expect(params()).toEqual({ pageSize: 15, q: 'kept' });
		page.onCustomerCreated();
		expect(params()).toEqual({ pageSize: 15, q: 'kept' });
	});

	it('stores the address picks, ignoring blanks', () => {
		const { page } = renderCheckout();
		page.selectShippingAddress(1);
		page.selectBillingAddress(2);
		page.selectShippingAddress('');
		page.selectBillingAddress('');
		expect(page.form.value).toMatchObject({ shipping_address_id: 1, billing_address_id: 2 });
	});

	it('stores delivery and payment', () => {
		const { page } = renderCheckout();
		page.selectDelivery({ delivery_description: 'Fast', delivery_interval: 'Noon' });
		page.selectPaymentMethod('online');
		expect(page.form.value).toMatchObject({
			delivery_description: 'Fast',
			delivery_interval: 'Noon',
			payment_method: 'online',
		});
	});

	it('applies and removes a coupon', () => {
		const { page } = renderCheckout();
		page.coupon = false;
		page.showCoupon();
		expect(page.coupon).toBe(true);
		page.setCoupon('SAVE');
		expect(page.form.value.coupon).toBe('SAVE');
		expect(page.appliedCoupon).toBe(true);
		page.couponRemove();
		expect(page.form.value.coupon).toBeNull();
		expect(page.appliedCoupon).toBe(false);
	});

	it('works out totals only for a complete form', () => {
		const { page } = renderCheckout();
		page.checkout();
		expect(page.checkoutTotal).toBeNull();
		fill(page);
		expect(page.checkoutTotal).not.toBeNull();
		expect(page.loading).toBe(false);
	});

	it('places an order from a complete form only', () => {
		const { page, router, fixture } = renderCheckout();
		page.placeorder();
		expect(router.navigateByUrl).not.toHaveBeenCalled();
		fill(page);
		page.form.patchValue({ coupon: 'SAVE' });
		page.placeorder();
		expect(page.form.value.coupon).toBeNull();
		expect(router.navigateByUrl).toHaveBeenCalledWith('/order/details/1000');
		page.form.patchValue({ coupon: 'SAVE' });
		(fixture.nativeElement.querySelector('input') as HTMLInputElement).value = 'SAVE';
		page.placeorder();
		expect(page.form.value.coupon).toBe('SAVE');
	});

	it('clears up when leaving', () => {
		const { page, fixture } = renderCheckout();
		fill(page);
		fixture.destroy();
		expect(page.checkoutTotal).toBeNull();
		expect(page.form.value.consumer_id).toBeNull();
	});
});

const modalSetup = (result: Promise<unknown> = Promise.resolve('done')) => {
	const modal = { open: vi.fn(() => ({ result })), dismissAll: vi.fn() };
	const gateway = { create: vi.fn(() => of({})) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbModal, useValue: modal },
			{ provide: AdminCustomersGateway, useValue: gateway },
		],
	});
	return { modal, gateway };
};
const dismissals: Array<[unknown, string]> = [
	[ModalDismissReasons.ESC, 'Dismissed by pressing ESC'],
	[ModalDismissReasons.BACKDROP_CLICK, 'Dismissed by clicking on a backdrop'],
	['cross', 'Dismissed with: cross'],
];

describe('AddCustomerModal', () => {
	const create = (result?: Promise<unknown>) => {
		const parts = modalSetup(result);
		TestBed.overrideComponent(AddCustomerModal, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(AddCustomerModal);
		return { ...parts, fixture, page: fixture.componentInstance };
	};
	const valid = { name: ' Asha ', email: 'a@b.co', phone: '9000000000' };

	it('needs a channel and the contact it uses', () => {
		const { page } = create();
		page.form.patchValue({ ...valid, channelEmail: false });
		expect(page.form.errors).toMatchObject({ channelsRequired: true });
		page.form.patchValue({ channelEmail: true, email: null });
		expect(page.form.errors).toMatchObject({ emailRequiredForChannel: true });
		page.form.patchValue({ email: 'a@b.co', channelSms: true, phone: null });
		expect(page.form.errors).toMatchObject({ phoneRequiredForChannel: true });
		page.form.patchValue({ channelSms: false, channelWhatsapp: true });
		expect(page.form.errors).toMatchObject({ phoneRequiredForChannel: true });
		page.form.patchValue({ phone: '9' });
		expect(page.form.errors).toBeNull();
	});

	it('opens, recording how it was closed', async () => {
		const open = create();
		await open.page.openModal();
		await settle();
		expect(open.page.closeResult).toBeUndefined();
		for (const [reason, text] of dismissals) {
			const { page } = create(Promise.reject(reason));
			await page.openModal();
			await settle();
			expect(page.closeResult).toBe(text);
		}
	});

	it('stops on an invalid form or an empty phone', () => {
		const { page, gateway } = create();
		page.submit();
		page.form.patchValue(valid);
		page.form.controls['phone']?.clearValidators();
		page.form.patchValue({ phone: null });
		page.submit();
		expect(gateway.create).not.toHaveBeenCalled();
	});

	it('creates with all the channels, then resets', async () => {
		const { page, gateway, modal } = create();
		const created = vi.fn();
		page.created.subscribe(created);
		page.form.patchValue({ ...valid, channelSms: true, channelWhatsapp: true, status: 'active' });
		page.submit();
		await settle();
		expect(gateway.create).toHaveBeenCalledWith({
			displayName: 'Asha',
			email: 'a@b.co',
			phone: '+919000000000',
			status: 'active',
			activationChannels: ['email', 'sms', 'whatsapp'],
		});
		expect(created).toHaveBeenCalledOnce();
		expect(modal.dismissAll).toHaveBeenCalledOnce();
		expect(page.form.value.name).toBe('');
	});

	it('falls back for an unknown dial code, a blank status and blank text', () => {
		const { page, gateway } = create();
		page.form.patchValue({ ...valid, country_code: '0000', channelEmail: false, channelSms: true });
		page.form.controls['status']?.clearValidators();
		page.form.controls['name']?.clearValidators();
		page.form.controls['email']?.clearValidators();
		page.form.patchValue({ status: '', name: null, email: null });
		page.submit();
		expect(gateway.create).toHaveBeenCalledWith({
			displayName: '',
			email: '',
			phone: '+00009000000000',
			status: 'pending',
			activationChannels: ['sms'],
		});
	});

	it('uses the default code when the control is empty', () => {
		const { page, gateway } = create();
		page.form.patchValue(valid);
		page.form.controls['country_code']?.clearValidators();
		page.form.patchValue({ country_code: null });
		page.submit();
		expect(gateway.create).toHaveBeenCalledWith(expect.objectContaining({ phone: '+919000000000' }));
	});

	it('closes itself when leaving, only if it opened', async () => {
		const closed = create();
		closed.fixture.destroy();
		expect(closed.modal.dismissAll).not.toHaveBeenCalled();
		const { page, fixture, modal } = create();
		await page.openModal();
		fixture.destroy();
		expect(modal.dismissAll).toHaveBeenCalledOnce();
	});
});

describe('AddAddressModal', () => {
	const create = (result?: Promise<unknown>) => {
		const parts = modalSetup(result);
		TestBed.overrideComponent(AddAddressModal, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(AddAddressModal);
		fixture.detectChanges();
		return { ...parts, fixture, page: fixture.componentInstance };
	};

	it('lists countries and the states of the chosen one', async () => {
		const { page } = create();
		expect(await firstValueFrom(page.countries$)).toEqual([]);
		expect(await firstValueFrom(page.states$)).toEqual([]);
		countries.set([{ id: 1, name: 'India' }]);
		states.set([
			{ id: 1, name: 'WB', country_id: 1 },
			{ id: 2, name: 'TX', country_id: 2 },
		]);
		TestBed.tick();
		expect(await firstValueFrom(page.countries$)).toEqual([{ label: 'India', value: 1 }]);
		expect(await firstValueFrom(page.states$)).toHaveLength(2);
		page.form.patchValue({ state_id: 2 });
		page.countryChange({ value: 1 } as never);
		TestBed.tick();
		expect(page.form.value.state_id).toBe('');
		expect(await firstValueFrom(page.states$)).toEqual([{ label: 'WB', value: 1, country_id: 1 }]);
		page.form.patchValue({ state_id: 2 });
		page.countryChange({ value: '' } as never);
		page.countryChange(null as never);
		expect(page.form.value.state_id).toBe(2);
	});

	it('opens for a type, recording how it was closed', async () => {
		const open = create();
		await open.page.openModal('billing');
		await settle();
		expect(open.page.form.value.type).toBe('billing');
		for (const [reason, text] of dismissals) {
			const { page } = create(Promise.reject(reason));
			await page.openModal();
			await settle();
			expect(page.closeResult).toBe(text);
		}
	});

	it('closes on a valid address only', () => {
		const { page, modal } = create();
		page.submit(5);
		expect(page.form.value.user_id).toBe(5);
		expect(modal.dismissAll).not.toHaveBeenCalled();
		page.form.patchValue({
			title: 'T',
			street: 'S',
			state_id: 1,
			country_id: 1,
			city: 'C',
			pincode: '7',
			phone: '9',
		});
		page.submit(5);
		expect(modal.dismissAll).toHaveBeenCalledOnce();
	});

	it('closes itself when leaving, only if it opened', async () => {
		const closed = create();
		closed.fixture.destroy();
		expect(closed.modal.dismissAll).not.toHaveBeenCalled();
		const { page, fixture, modal } = create();
		await page.openModal('shipping');
		fixture.destroy();
		expect(modal.dismissAll).toHaveBeenCalledOnce();
	});
});

describe('CouponModal', () => {
	const create = (result?: Promise<unknown>) => {
		const parts = modalSetup(result);
		TestBed.overrideComponent(CouponModal, { set: { template: '' } });
		return { ...parts, page: TestBed.createComponent(CouponModal).componentInstance };
	};

	it('opens, recording how it was closed', async () => {
		const open = create();
		await open.page.openModal();
		await settle();
		expect(open.page.modalOpen).toBe(true);
		expect(open.modal.open).toHaveBeenCalledOnce();
		for (const [reason, text] of dismissals) {
			const { page } = create(Promise.reject(reason));
			await page.openModal();
			await settle();
			expect(page.closeResult).toBe(text);
		}
	});
});

describe('checkout blocks', () => {
	const create = <T>(component: new () => T): T => {
		TestBed.resetTestingModule();
		TestBed.overrideComponent(component, { set: { imports: [], template: '' } });
		return TestBed.createComponent(component).componentInstance;
	};

	it('DeliveryBlock reports both parts', () => {
		const page = create(DeliveryBlock);
		const picks: unknown[] = [];
		page.selectDelivery.subscribe((value) => picks.push(value));
		page.setDeliveryDescription('Fast', 'same_day');
		page.setDeliveryInterval('Noon', 1);
		expect(page.deliveryType).toBe('same_day');
		expect(page.selectedIndex).toBe(1);
		expect(picks).toEqual([
			{ delivery_description: 'Fast', delivery_interval: null },
			{ delivery_description: 'Fast', delivery_interval: 'Noon' },
		]);
	});

	it('AddressBlock keeps numeric ids numeric', () => {
		const page = create(AddressBlock);
		const picks: unknown[] = [];
		page.selectAddress.subscribe((value) => picks.push(value));
		for (const value of ['12', 'a1', '012']) page.set({ target: { value } } as never);
		expect(picks).toEqual([12, 'a1', '012']);
	});

	it('AddressBlock removes without following the link', () => {
		const page = create(AddressBlock);
		const removed = vi.fn();
		page.deleteAddress.subscribe(removed);
		const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
		page.remove(event as never, 'a1');
		expect(event.preventDefault).toHaveBeenCalledOnce();
		expect(event.stopPropagation).toHaveBeenCalledOnce();
		expect(removed).toHaveBeenCalledWith('a1');
	});

	it('PaymentBlock reports the method', () => {
		const page = create(PaymentBlock);
		const picked = vi.fn();
		page.selectPaymentMethod.subscribe(picked);
		page.set('online');
		expect(picked).toHaveBeenCalledWith('online');
	});
});
