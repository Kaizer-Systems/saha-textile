import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { SelfInvoicesGateway } from '@core/accounts/self-invoices.gateway';
import { AuthStore } from '@core/state/auth.store';

import { SelfInvoicesListPage } from './self-invoices-list';

/** Accounts › Self-invoices (A7). */

function setup(permissions = ['accounts.post'], total = 30) {
	const list = vi.fn(() => of({ items: [{ id: 'si_1' }], total, counts: { all: 4 } }));
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [SelfInvoicesListPage, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [
			provideRouter([]),
			provideTanStackQuery(new QueryClient()),
			{ provide: SelfInvoicesGateway, useValue: { list } },
			{ provide: AuthStore, useValue: { permissions: signal(permissions) } },
		],
	});
	TestBed.overrideComponent(SelfInvoicesListPage, { set: { template: '' } });
	const fixture = TestBed.createComponent(SelfInvoicesListPage);
	return { fixture, page: fixture.componentInstance, list };
}

describe('the self-invoices list (A7)', () => {
	it('asks for the chip, period, search and page, and counts the pages', async () => {
		const { fixture, page, list } = setup();
		expect(page.pages()).toBe(1);
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.list.data()).toBeTruthy());
		expect(page.pages()).toBe(2);
		expect(list).toHaveBeenCalledWith(expect.objectContaining({ filter: 'all', page: 1, pageSize: 25 }));
		page.page.set(2);
		page.setFilter('due_soon');
		expect([page.filter(), page.page()]).toEqual(['due_soon', 1]);
		page.search.set('  mitra ');
		page.page.set(3);
		page.setPeriod({ period: 'custom' });
		fixture.detectChanges();
		await vi.waitFor(() =>
			expect(list).toHaveBeenLastCalledWith(
				expect.objectContaining({
					from: '2017-07-01',
					to: page.today,
					search: 'mitra',
					filter: 'due_soon',
					page: 1,
				}),
			),
		);
		expect([page.canRecord(), setup([]).page.canRecord()]).toEqual([true, false]);
	});

	it('shows the 30-day clock, the last voucher and the day', () => {
		const { page } = setup();
		const draft = (receivedOn: string) => ({ receivedOn, date: null, paymentVouchers: [] }) as never;
		const inDays = (n: number) =>
			new Date(Date.parse(`${page.today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
		expect(page.clock(draft(inDays(-5)))).toEqual({ key: 'si_clock_due', count: 25, tone: 'pending' });
		expect(page.clock(draft(inDays(-33)))).toEqual({ key: 'si_clock_late', count: 3, tone: 'danger' });
		expect(page.clock({ receivedOn: '2026-11-01', date: '2026-11-21' } as never)).toEqual({
			key: 'si_clock_made',
			count: 20,
			tone: 'success',
		});
		expect(page.lastVoucher(draft('2026-11-01'))).toBe('—');
		expect(page.lastVoucher({ paymentVouchers: [{ number: 'PV/5' }, { number: 'PV/7' }] } as never)).toBe('PV/7');
		expect([page.day('2026-11-01'), page.inr(10_800)]).toEqual(['1 Nov 2026', '₹10,800.00']);
	});
});
