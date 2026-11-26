import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ExpenseBillsGateway } from '@core/purchasing/expense-bills.gateway';
import { AuthStore } from '@core/state/auth.store';
import { periodRange } from '@features/accounts/edoc-list';
import { rupees } from '@features/accounts/ledger-helpers';
import { ExportMenu } from '@shared/ui/export-menu/export-menu';
import { PeriodPicker } from '@shared/ui/period-picker/period-picker';

import { ExpenseBillListPage } from './bill-list';

import type { ExpenseBill } from '@saha-textile/contracts';

/** Purchases › Expense bills (brief 25 EB1): by status and bill date, searched, paged, and exported. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const bill = (id: string, over: Partial<ExpenseBill> = {}): ExpenseBill =>
	({
		id,
		number: `EB/26-27/00000${id}`,
		supplierId: 'sup_1',
		supplierName: 'Bose Properties',
		billNumber: `BP-${id}`,
		billDate: '2026-11-20',
		locationId: 'loc_b',
		lines: [],
		note: '',
		status: 'posted',
		interState: false,
		taxableINR: 50_000,
		cgstINR: 4_500,
		sgstINR: 4_500,
		igstINR: 0,
		blockedTaxINR: 0,
		totalINR: 59_000,
		voucherId: 'jv_1',
		postedAt: null,
		postedBy: null,
		createdAt: '2026-11-20T06:00:00.000Z',
		updatedAt: '2026-11-20T06:00:00.000Z',
		version: 1,
		...over,
	}) as ExpenseBill;

function mount(bills: ExpenseBill[], permissions = ['accounts.index', 'accounts.edit']) {
	TestBed.resetTestingModule();
	const list = vi.fn(() => of(bills));
	TestBed.configureTestingModule({
		imports: [
			ExpenseBillListPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			provideRouter([]),
			{ provide: ExpenseBillsGateway, useValue: { list } },
			{ provide: AuthStore, useValue: { permissions: signal(permissions) } },
		],
	});
	// The period picker and the Export menu are their own components; the page hands them its choices and its rows.
	TestBed.overrideComponent(ExpenseBillListPage, {
		remove: { imports: [PeriodPicker, ExportMenu] },
		add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
	});
	const fixture = TestBed.createComponent(ExpenseBillListPage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, list };
}
async function opened(bills: ExpenseBill[], permissions?: string[]) {
	const harness = mount(bills, permissions);
	await settle(harness.fixture);
	return harness;
}

const el = <T extends HTMLElement = HTMLElement>(fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as T | null;
const rows = (fixture: { nativeElement: HTMLElement }) =>
	[...fixture.nativeElement.querySelectorAll('tbody tr')] as HTMLElement[];
const cells = (row: HTMLElement | undefined) =>
	[...(row?.querySelectorAll('td') ?? [])].map((td) => td.textContent?.replace(/\s+/g, ' ').trim() ?? '');

describe('the expense bills list (EB1)', () => {
	it('reads every status over the last twelve months and shows each bill with its tax claimed and status', async () => {
		const { fixture, page, list } = await opened([
			bill('1'),
			bill('2', {
				number: null,
				status: 'draft',
				supplierName: 'Ruby Electricals',
				igstINR: 900,
				cgstINR: 0,
				sgstINR: 0,
			}),
			bill('3', { status: 'cancelled' }),
		]);
		expect(list).toHaveBeenCalledWith({ status: 'all', ...periodRange({ period: 'last_12_months' }) });
		expect(cells(rows(fixture)[0])).toEqual([
			'EB/26-27/000001',
			'Bose Properties',
			'BP-1',
			page.day('2026-11-20'),
			rupees(50_000_00),
			rupees(9_000_00),
			rupees(59_000_00),
			'eb_status_posted',
			'',
		]);
		expect(cells(rows(fixture)[1])[0]).toBe('eb_gets_number');
		expect(cells(rows(fixture)[1])[5]).toBe(rupees(900_00));
		expect(rows(fixture).map((row) => row.querySelector('td:nth-child(8) div')?.className)).toEqual([
			'status-success',
			'status-pending',
			'status-danger',
		]);
		expect(el(fixture, 'a[href="/expense-bills/2"]')).not.toBeNull();
		expect(el(fixture, '#eb_new')?.getAttribute('href')).toBe('/expense-bills/create');
		expect(page.day('2026-11-20')).toBe('20 Nov 2026');
	});

	it('reads one status from its chip and a new period, each from the first page', async () => {
		const { fixture, page, list } = await opened([bill('1')]);
		page.page.set(2);
		(el(fixture, '#eb_chip_draft') as HTMLButtonElement).click();
		await settle(fixture);
		expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'draft' }));
		expect([page.page(), el(fixture, '#eb_chip_draft')?.classList.contains('btn-theme')]).toEqual([1, true]);
		page.page.set(2);
		page.setPeriod({ period: 'custom', from: '2026-04-01', to: '2026-06-30' });
		await settle(fixture);
		expect(list).toHaveBeenLastCalledWith({ status: 'draft', from: '2026-04-01', to: '2026-06-30' });
		expect(page.page()).toBe(1);
	});

	it('searches the supplier, their bill number and ours as typed, and pages twenty-five bills at a time', async () => {
		const many = Array.from({ length: 30 }, (_, i) =>
			bill(String(i + 10), { supplierName: i < 3 ? 'Ruby Electricals' : 'Bose Properties' }),
		);
		const { fixture, page } = await opened([
			...many,
			bill('9', { number: null, billNumber: 'RUBY-9', supplierName: 'Elsewhere' }),
		]);
		expect(page.pages()).toBe(2);
		expect(rows(fixture)).toHaveLength(25);
		(fixture.nativeElement.querySelectorAll('.page-link')[1] as HTMLElement).click();
		await settle(fixture);
		expect(rows(fixture)).toHaveLength(6);
		const search = el<HTMLInputElement>(fixture, '#eb_search') as HTMLInputElement;
		search.value = '  ruby ';
		search.dispatchEvent(new Event('input'));
		await settle(fixture);
		expect(page.page()).toBe(1);
		expect(page.rows().map((b) => b.id)).toEqual(['10', '11', '12', '9']);
		search.value = 'EB/26-27/0000011';
		search.dispatchEvent(new Event('input'));
		await settle(fixture);
		expect(page.rows().map((b) => b.id)).toEqual(['11']);
		search.value = 'nobody';
		search.dispatchEvent(new Event('input'));
		await settle(fixture);
		expect(cells(rows(fixture)[0])).toEqual(['eb_list_empty']);
		expect(fixture.nativeElement.querySelector('.pagination')).toBeNull();
	});

	it('exports every matching bill with the status, the dates and the search when one is typed', async () => {
		const { page } = await opened([bill('1'), bill('2', { number: null, status: 'draft' })]);
		const all = page.exportSource();
		const { from, to } = periodRange({ period: 'last_12_months' });
		expect(all).toMatchObject({
			fileName: `expense-bills_${from}_${to}`,
			title: 'eb_list_title',
			area: 'accounts',
			filters: [
				{ label: 'eb_filter_status', value: 'eb_chip_all' },
				{ label: 'eb_filter_dates', value: `${from} – ${to}` },
			],
			kinds: { 4: 'money', 5: 'money', 6: 'money', 7: 'money' },
		});
		expect(all.header).toHaveLength(9);
		expect(all.rows).toEqual([
			['EB/26-27/000001', 'Bose Properties', 'BP-1', '2026-11-20', 50_000, 9_000, 0, 59_000, 'eb_status_posted'],
			['', 'Bose Properties', 'BP-2', '2026-11-20', 50_000, 9_000, 0, 59_000, 'eb_status_draft'],
		]);
		page.search.set(' BP-2 ');
		page.setPeriod({ period: 'custom' } as never);
		const searched = page.exportSource();
		expect(searched.fileName).toBe('expense-bills_all_today');
		expect(searched.filters).toEqual([
			{ label: 'eb_filter_status', value: 'eb_chip_all' },
			{ label: 'eb_filter_dates', value: '— – —' },
			{ label: 'search', value: 'BP-2' },
		]);
	});

	it('offers no new bill to someone who may not edit', async () => {
		const { fixture } = await opened([], ['accounts.index']);
		expect(el(fixture, '#eb_new')).toBeNull();
		expect(cells(rows(fixture)[0])).toEqual(['eb_list_empty']);
	});
});
