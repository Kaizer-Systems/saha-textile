import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminCustomersGateway } from '@core/admin-customers/admin-customers.gateway';
import { CustomerAddressBookGateway } from '@core/admin-customers/customer-address-book.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { FormCustomer } from './form-customer';

const client = vi.hoisted(() => ({ invalidateQueries: vi.fn() }));
const customer = signal<unknown>(undefined);
const customerOrders = signal<unknown>(undefined);
/** The orders query keeps its two readers, so a test can read them after the page changes. */
const orders: { id: () => unknown; params: () => unknown } = { id: () => null, params: () => null };
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
	injectAdminCustomerOrdersQuery: (id: () => unknown, params: () => unknown) => {
		orders.id = id;
		orders.params = params;
		return { data: customerOrders };
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
	const notification = { showSuccess: vi.fn(), showError: vi.fn() };
	const addressBook = { save: vi.fn(() => of({})) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: AdminCustomersGateway, useValue: gateway },
			{ provide: Router, useValue: router },
			{ provide: NgbModal, useValue: modal },
			{ provide: CustomerAddressBookGateway, useValue: addressBook },
			{ provide: NotificationService, useValue: notification },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key, getActiveLang: () => 'en' } },
			{ provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => id } } } },
		],
	});
	TestBed.overrideComponent(FormCustomer, { set: { imports: [], template } });
	const fixture = TestBed.createComponent(FormCustomer);
	fixture.componentRef.setInput('type', type);
	fixture.detectChanges();
	TestBed.tick();
	return { fixture, page: fixture.componentInstance, gateway, router, modal, notification, addressBook };
};
const settle = async () => {
	for (let i = 0; i < 12; i += 1) await Promise.resolve();
};
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
const saved = (overrides: Record<string, unknown> = {}) => ({
	id: 'c1',
	displayName: 'Asha',
	email: 'a@b.co',
	phone: '+919000000000',
	status: 'active',
	addresses: [address()],
	...overrides,
});

const popupAddress = {
	label: 'Home',
	fullName: 'Kavita Iyer',
	line1: '12 Rash Behari Avenue',
	city: 'Kolkata',
	postalCode: '700026',
	countryCode: 'IN',
	mobile: { countryCallingCode: '91', number: '9831122334' },
	isDefault: false,
};
const opened = (modal: { open: ReturnType<typeof vi.fn> }, result: Promise<unknown>) => {
	const start = vi.fn();
	modal.open.mockReturnValue({ componentInstance: { start }, result });
	return start;
};

afterEach(() => {
	customer.set(undefined);
	customerOrders.set(undefined);
	client.invalidateQueries.mockClear();
});

describe('FormCustomer: the last cases', () => {
	it('offers Login and security to a customer still waiting to activate', () => {
		const { page } = setup('edit', 'c1');
		customer.set(saved({ status: 'pending' }));
		TestBed.tick();
		expect(page.tabs().map((tab) => tab.key)).toContain('security');
	});

	it('asks for the orders of this customer on the Orders tab, with the search, and draws an empty table first', () => {
		const { page } = setup('edit', 'c1');
		customer.set(saved());
		TestBed.tick();
		expect(page.ordersTable()).toMatchObject({ data: [], total: 0 });
		expect(orders.id()).toBeNull();
		page.tab.set('orders');
		expect(orders.id()).toBe('c1');
		page.onOrdersTableChange({ page: 1, paginate: 15, search: 'ST-26' });
		expect(orders.params()).toMatchObject({ q: 'ST-26' });
		customerOrders.set({
			items: [
				{
					id: 'o2',
					orderNumber: 'ST-1',
					status: 'archived_by_hand',
					totalAmount: 10,
					createdAt: '2026-11-20T10:00:00Z',
				},
			],
			meta: { total: 1, page: 1, pageSize: 15, totalPages: 1, hasNext: false, hasPrev: false },
		});
		expect(page.ordersTable().data[0]?.status).toBe('archived_by_hand');
	});

	it('keeps several new addresses in order, edits one in place, and moves the default between them', async () => {
		const { page, modal } = setup();
		page.form.get('displayName')?.setValue(null);
		const start = opened(modal, Promise.resolve({ ...popupAddress, line2: 'Flat 2' }));
		page.openAddressModal();
		expect(start).toHaveBeenCalledWith(expect.objectContaining({ customerName: '' }));
		await settle();
		opened(modal, Promise.resolve({ ...popupAddress, label: 'Shop' }));
		page.openAddressModal();
		await settle();
		const [first, second] = page.addresses();
		expect(first).toMatchObject({ label: 'Home', line2: 'Flat 2', state: '', isDefault: true });
		expect(second).toMatchObject({ label: 'Shop', isDefault: false });
		opened(modal, Promise.resolve({ ...popupAddress, label: 'Shop now default', isDefault: true }));
		page.openAddressModal(second as never);
		await settle();
		expect(page.addresses().map((row) => [row.label, row.isDefault])).toEqual([
			['Home', false],
			['Shop now default', true],
		]);
		page.makeDefaultAddress(page.addresses()[0] as never);
		expect(page.addresses().map((row) => row.isDefault)).toEqual([true, false]);
	});

	it('the radio does nothing without a saved customer, and says so when the change fails', async () => {
		const unsaved = setup('edit', null);
		unsaved.page.makeDefaultAddress(address({ id: 'a2', isDefault: false }) as never);
		expect(unsaved.gateway.updateAddress).not.toHaveBeenCalled();
		const { page, gateway, notification } = setup('edit', 'c1');
		customer.set(saved());
		TestBed.tick();
		gateway.updateAddress.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		page.makeDefaultAddress(address({ id: 'a2', isDefault: false }) as never);
		await settle();
		expect(notification.showError).toHaveBeenCalledWith('cust_address_not_saved');
	});
});
