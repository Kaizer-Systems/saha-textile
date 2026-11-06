import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingStore } from '@core/state/setting.store';

import { BankDetails } from './bank-details/bank-details';
import { Orders } from './orders/orders';
import { Point } from './point/point';
import { Refund } from './refund/refund';
import { Wallet } from './wallet/wallet';

const data = signal<unknown>(undefined);
const query = (filter?: () => unknown) => {
	filter?.();
	return { data };
};
vi.mock('@data-access/queries/order.queries', () => ({ injectOrdersQuery: (filter?: () => unknown) => query(filter) }));
vi.mock('@data-access/queries/refund.queries', () => ({
	injectRefundsQuery: (filter?: () => unknown) => query(filter),
}));
vi.mock('@data-access/queries/wallet.queries', () => ({
	injectWalletTransactionsQuery: (filter?: () => unknown) => query(filter),
}));
vi.mock('@data-access/queries/point.queries', () => ({
	injectPointTransactionsQuery: (filter?: () => unknown) => query(filter),
}));
vi.mock('@data-access/queries/payment-details.queries', () => ({
	injectPaymentDetailsQuery: (filter?: () => unknown) => query(filter),
}));

const render = <T>(type: new () => T) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: SettingStore, useValue: { setting: signal(null) } }] });
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	const page = TestBed.createComponent(type).componentInstance;
	TestBed.tick();
	return page;
};

afterEach(() => data.set(undefined));

describe.each([
	{ name: 'Orders', type: Orders, stream: 'order$' },
	{ name: 'Refund', type: Refund, stream: 'refund$' },
	{ name: 'Wallet', type: Wallet, stream: 'wallet$' },
	{ name: 'Point', type: Point, stream: 'point$' },
])('$name list', ({ type, stream }) => {
	it('shows the loaded page and moves between pages', async () => {
		const page = render(type as new () => Orders) as unknown as {
			filter: () => Record<string, unknown>;
			setPaginate: (page: number) => void;
		} & Record<string, never>;
		data.set({ total: 1 });
		TestBed.tick();
		expect(await firstValueFrom(page[stream])).toEqual({ total: 1 });
		page.setPaginate(2);
		expect(page.filter()).toEqual({ page: 2, paginate: 10 });
	});
});

describe('BankDetails', () => {
	it('fills the form once the details arrive', () => {
		const page = render(BankDetails);
		expect(page.form.value.bank_name).toBeNull();
		data.set({ bank_name: 'SBI', paypal_email: 'a@b.co' });
		TestBed.tick();
		expect(page.form.value).toMatchObject({ bank_name: 'SBI', paypal_email: 'a@b.co' });
	});

	it('touches every field on submit, valid or not', () => {
		const page = render(BankDetails);
		page.form.patchValue({ paypal_email: 'not-an-address' });
		page.submit();
		expect(page.form.touched).toBe(true);
		page.form.patchValue({ paypal_email: 'a@b.co' });
		page.submit();
		expect(page.form.valid).toBe(true);
	});
});
