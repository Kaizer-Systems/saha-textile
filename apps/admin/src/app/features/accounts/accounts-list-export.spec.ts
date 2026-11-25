import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccountsListsGateway } from '@core/accounts/accounts-lists.gateway';
import { LocationsGateway } from '@core/locations/locations.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { AccountsListPage, CSV_HEAD } from './accounts-list-page';

import type { AccountsListRow } from '@saha-textile/contracts';

/** Accounts lists through the Export menu (brief 25 EX1): every row of the chip, period and search. */

const row = (id: string): AccountsListRow => ({
	id,
	tab: 'receipts',
	number: `RC/26-27/0000${id}`,
	date: '2026-11-23',
	party: 'Meera Sharma',
	against: 'ST-2611-514203',
	detail: 'upi',
	reference: '402112345678',
	amountINR: 9560,
	moneyInINR: 9560,
	moneyOutINR: null,
	stock: null,
	soldBy: null,
	by: 'Staff',
	approvedBy: null,
	status: 'issued',
	extra: {},
});

function setup(list: string, pages: AccountsListRow[][], total: number) {
	const read = [...pages];
	const answer = () => of({ items: read.shift() ?? [], total, counts: {}, totals: {} });
	const gateway = { list: vi.fn(answer), dayBook: vi.fn(answer) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			AccountsListPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideRouter([]),
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: ActivatedRoute, useValue: { data: of({ list }) } },
			{ provide: AccountsListsGateway, useValue: gateway },
			{ provide: NotificationService, useValue: { showError: vi.fn(), showSuccess: vi.fn() } },
			{ provide: LocationsGateway, useValue: { list: vi.fn(() => of([])) } },
			{ provide: AuthStore, useValue: { permissions: signal(['accounts.index']), user: signal(null) } },
		],
	});
	TestBed.overrideComponent(AccountsListPage, { set: { template: '' } });
	return { page: TestBed.createComponent(AccountsListPage).componentInstance, gateway };
}

describe('an accounts list for the Export menu (EX1)', () => {
	it('reads every page until the total is reached and hands over the CSV’s columns, the period and the title', async () => {
		const { page, gateway } = setup('receipts', [[row('1'), row('2')], [row('3')]], 3);
		const source = await page.exportSource();
		expect(gateway.list).toHaveBeenCalledTimes(2);
		expect(gateway.list).toHaveBeenLastCalledWith('receipts', expect.objectContaining({ page: 2, pageSize: 100 }));
		const { from, to } = page.query();
		expect(source).toMatchObject({
			fileName: `receipts-all-${from}-${to}`,
			title: 'al_title_receipts',
			header: [...CSV_HEAD],
			filters: [{ label: 'al_period', value: `${from} – ${to}` }],
			area: 'accounts',
		});
		expect(source.rows).toHaveLength(3);
	});

	it('stops at a page that comes back empty, even short of the total', async () => {
		const { page, gateway } = setup('dayBook', [[row('1')], []], 5);
		const source = await page.exportSource();
		expect(gateway.dayBook).toHaveBeenCalledTimes(2);
		expect(source.rows).toHaveLength(1);
		expect(source.title).toBe('al_title_dayBook');
	});
});
