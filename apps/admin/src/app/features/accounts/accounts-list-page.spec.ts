import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { ACCOUNTS_LIST_CHIPS, DAY_BOOK_CHIPS } from '@saha-textile/contracts';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountsListsGateway } from '@core/accounts/accounts-lists.gateway';
import { LocationsGateway } from '@core/locations/locations.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { LIST_COLUMNS, listCell, statusKind, viewLink } from './accounts-list-columns';
import { AccountsListPage, CSV_HEAD, LIST_CHIPS, csvRows } from './accounts-list-page';

import type { AccountsListRow } from '@saha-textile/contracts';

/** Accounts › Vouchers and the Day book (accounts brief A1–A9, A3): columns, the page, the gateway. */

const row = (over: Partial<AccountsListRow> = {}): AccountsListRow => ({
	id: 'r1',
	tab: 'receipts',
	number: 'RC/26-27/000014',
	date: '2026-11-23',
	party: 'Meera <Sharma>',
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
	extra: { orderId: 'ord_1' },
	...over,
});
const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key);

describe('the list columns', () => {
	it('draws every column of every list from a row', () => {
		for (const [kind, columns] of Object.entries(LIST_COLUMNS))
			for (const column of columns)
				expect(
					typeof listCell(row({ tab: kind === 'dayBook' ? 'receipts' : (kind as never) }), column.field, t),
				).toBe('string');
	});

	it('words each cell: numbers, methods, modes, kinds, reasons, money, stock and who', () => {
		expect(listCell(row(), 'number', t)).toBe('<h6 class="mb-0">RC/26-27/000014</h6>');
		expect(listCell(row({ number: null, status: 'draft' }), 'number', t)).toContain('al_draft');
		expect(listCell(row({ number: null, status: 'pending' }), 'number', t)).toContain('al_no_number');
		expect(listCell(row(), 'party', t)).toBe('Meera &lt;Sharma&gt;');
		expect(listCell(row({ party: null }), 'party', t)).toContain('—');
		expect(listCell(row(), 'method', t)).toBe('ord_method_upi');
		expect(listCell(row({ detail: 'on_account' }), 'method', t)).toBe('ord_method_onAccount');
		expect(listCell(row({ detail: 'receipt' }), 'method', t)).toBe('al_by_hand');
		expect(listCell(row({ detail: 'bank_transfer' }), 'mode', t)).toBe('payment_mode_bank_transfer');
		expect(listCell(row({ detail: 'payment' }), 'mode', t)).toBe('al_by_hand');
		expect(listCell(row(), 'amount', t)).toBe('₹9,560');
		expect(listCell(row({ amountINR: null }), 'amount', t)).toContain('—');
		expect(listCell(row({ extra: { reverseChargeTaxINR: 10_800 } }), 'rcmTax', t)).toBe('₹10,800');
		expect(listCell(row(), 'rcmTax', t)).toContain('—');
		expect(listCell(row(), 'by', t)).toBe('Staff');
		expect(listCell(row({ by: null }), 'by', t)).toBe('sa_system');
		expect(listCell(row({ detail: 'set_off' }), 'journalKind', t)).toBe('al_jv_set_off');
		expect(listCell(row({ party: null, reference: 'Accrual' }), 'accounts', t)).toBe('Accrual');
		expect(listCell(row({ extra: { orderNumber: 'ST-1' } }), 'orderNumber', t)).toBe('ST-1');
		expect(listCell(row({ detail: 'order_cancelled' }), 'why', t)).toBe('rf_reason_order_cancelled');
		expect(listCell(row({ extra: { how: 'bank_transfer' } }), 'how', t)).toBe('al_how_bank_transfer');
		expect(listCell(row(), 'how', t)).toBe('al_how_gateway');
		expect(listCell(row({ against: 'Petticoat', reference: 'PTC' }), 'item', t)).toContain('PTC');
		expect(listCell(row({ against: null, reference: null }), 'item', t)).toBe(
			'<small class="d-block text-muted"></small>',
		);
		expect(listCell(row({ stock: -2 }), 'stock', t)).toBe('−2');
		expect(listCell(row({ stock: 25, soldBy: 'metre' }), 'stock', t)).toBe('+2.5 m');
		expect(listCell(row({ stock: 1, soldBy: null }), 'stock', t)).toBe('+1');
		expect(listCell(row(), 'stock', t)).toBe('');
		expect(listCell(row({ detail: 'damage', extra: { outcome: 'writtenOff' } }), 'adjustReason', t)).toBe(
			'reason_code_damage, sa_outcome_writtenOff',
		);
		expect(listCell(row({ detail: null, extra: {} }), 'adjustReason', t)).toBe('');
		expect(listCell(row({ extra: { itcReversedINR: 31, journalNumber: 'JV/1' } }), 'itc', t)).toContain('JV/1');
		expect(listCell(row({ extra: { itcReversedINR: 31 } }), 'itc', t)).toContain('₹31');
		expect(listCell(row({ extra: {} }), 'itc', t)).toContain('—');
		expect(
			listCell(
				row({
					by: null,
					approvedBy: null,
					extra: { requestedByName: 'Store manager', decidedByName: 'Owner' },
				}),
				'byApproved',
				t,
			),
		).toContain('approved_by:{&quot;name&quot;:&quot;Owner&quot;}');
		expect(listCell(row({ by: null, extra: {} }), 'byApproved', t)).toContain('al_no_approval');
		expect(listCell(row({ status: 'pending' }), 'byApproved', t)).toContain('al_waiting');
		expect(listCell(row({ approvedBy: 'Owner' }), 'byApproved', t)).toContain('Owner');
		expect(listCell(row({ tab: 'creditNotes' }), 'voucher', t)).toBe('al_voucher_creditNotes');
		expect(listCell(row(), 'moneyIn', t)).toBe('₹9,560');
		expect(listCell(row(), 'moneyOut', t)).toBe('');
		expect(listCell(row({ moneyInINR: null, moneyOutINR: 31 }), 'moneyIn', t)).toBe('');
		expect(listCell(row({ moneyOutINR: 31 }), 'moneyOut', t)).toBe('₹31');
		expect(listCell(row(), 'status', t)).toContain('status-completed');
		expect(listCell(row({ extra: { location: 'Gariahat' } }), 'location', t)).toBe('Gariahat');
		expect(listCell(row({ extra: { taxableINR: 4457.14 } }), 'taxable', t)).toBe('₹4,457.14');
		expect(listCell(row({ extra: { taxINR: 222.86 } }), 'tax', t)).toBe('₹222.86');
		expect(listCell(row({ extra: { irn: 'abc', eWayBill: '123456789012' } }), 'edocs', t)).toBe(
			'al_irn_done · al_ewb:{&quot;number&quot;:&quot;123456789012&quot;}',
		);
		expect(listCell(row({ extra: { eWayBill: '1' } }), 'edocs', t)).toContain('al_ewb');
		expect(listCell(row({ extra: {} }), 'edocs', t)).toContain('—');
		expect(listCell(row(), 'nothing', t)).toContain('—');
	});

	it('gives each state its pill', () => {
		expect(statusKind({ tab: 'receipts', status: 'refunded' })).toBe('cancelled');
		expect(statusKind({ tab: 'refundVouchers', status: 'refunded' })).toBe('completed');
		expect(statusKind({ tab: 'creditNotes', status: 'draft' })).toBe('pending');
		expect(statusKind({ tab: 'refundVouchers', status: 'failed' })).toBe('cancelled');
		expect(statusKind({ tab: 'paymentVouchers', status: 'paid' })).toBe('completed');
		expect(statusKind({ tab: 'taxInvoices', status: 'part_credited' })).toBe('pending');
		expect(statusKind({ tab: 'taxInvoices', status: 'credited' })).toBe('cancelled');
	});

	it('opens each row where it lives', () => {
		expect(viewLink(row())).toEqual(['/order', 'details', 'ord_1']);
		expect(viewLink(row({ extra: { businessId: 'biz_1' } }))).toEqual(['/businesses', 'biz_1']);
		expect(viewLink(row({ id: 'jv_r', extra: {} }))).toEqual(['/accounts/vouchers', 'jv_r']);
		expect(viewLink(row({ tab: 'paymentVouchers', id: 'pv_1', extra: { againstKind: 'selfInvoice' } }))).toEqual([
			'/accounts/payment-vouchers',
			'pv_1',
		]);
		expect(viewLink(row({ tab: 'paymentVouchers', id: 'jv_p', extra: {} }))).toEqual([
			'/accounts/vouchers',
			'jv_p',
		]);
		expect(viewLink(row({ tab: 'contra', id: 'jv_c' }))).toEqual(['/accounts/vouchers', 'jv_c']);
		expect(viewLink(row({ tab: 'journal', id: 'le_3', extra: { businessId: 'biz_1' } }))).toEqual([
			'/businesses',
			'biz_1',
		]);
		expect(viewLink(row({ tab: 'journal', id: 'jv_j', extra: {} }))).toEqual(['/accounts/vouchers', 'jv_j']);
		expect(viewLink(row({ tab: 'creditNotes', id: 'cn_1' }))).toEqual(['/accounts/credit-notes', 'cn_1']);
		expect(viewLink(row({ tab: 'refundVouchers', id: 'rf_1' }))).toEqual(['/accounts/refund-vouchers', 'rf_1']);
		expect(viewLink(row({ tab: 'selfInvoices', id: 'si_1' }))).toEqual(['/accounts/self-invoices', 'si_1']);
		expect(viewLink(row({ tab: 'stockAdjustments', id: 'sa_1' }))).toEqual(['/stock/adjustments', 'sa_1']);
		expect(viewLink(row({ tab: 'taxInvoices', id: 'ti_1' }))).toEqual(['/accounts/invoices', 'ti_1']);
		expect(viewLink(row({ tab: 'purchaseBills', id: 'pe_1' }))).toEqual(['/purchase-entries', 'pe_1']);
		expect(viewLink(row({ tab: 'debitNotes' }))).toBeNull();
	});

	it('keeps its chips in step with the contracts', () => {
		expect(LIST_CHIPS).toEqual({ ...ACCOUNTS_LIST_CHIPS, dayBook: DAY_BOOK_CHIPS });
	});

	it('puts every list in one CSV shape', () => {
		expect(CSV_HEAD).toHaveLength(12);
		expect(
			csvRows(
				[
					row(),
					row({
						number: null,
						party: null,
						against: null,
						reference: null,
						amountINR: null,
						moneyInINR: null,
						moneyOutINR: 5,
						stock: -1,
						by: null,
					}),
				],
				t,
			),
		).toEqual([
			[
				'al_voucher_receipts',
				'RC/26-27/000014',
				'2026-11-23',
				'Meera <Sharma>',
				'ST-2611-514203',
				'402112345678',
				'9560',
				'9560',
				'',
				'',
				'Staff',
				'al_status_issued',
			],
			['al_voucher_receipts', '', '2026-11-23', '', '', '', '', '', '5', '-1', '', 'al_status_issued'],
		]);
	});
});

describe('the accounts lists gateway', () => {
	it('reads a tab and the Day book, and knows where each row prints', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [provideHttpClient(), provideHttpClientTesting(), AccountsListsGateway],
		});
		const gateway = TestBed.inject(AccountsListsGateway);
		const http = TestBed.inject(HttpTestingController);
		gateway.list('creditNotes', { chip: 'issued' }).subscribe();
		expect(
			http.expectOne((req) => req.url.endsWith('/admin/accounts/lists/creditNotes')).request.params.get('chip'),
		).toBe('issued');
		gateway.dayBook({ from: '2026-11-01' }).subscribe();
		http.expectOne((req) => req.url.endsWith('/admin/accounts/day-book')).flush({});
		gateway.printPicked('creditNotes', ['cn_1']).subscribe();
		const picked = http.expectOne((req) => req.url.endsWith('/admin/accounts/lists/creditNotes/pdf'));
		expect([picked.request.method, picked.request.body, picked.request.responseType]).toEqual([
			'POST',
			{ ids: ['cn_1'] },
			'blob',
		]);
		gateway.pdf('stock/adjustments/sa_1/pdf').subscribe();
		expect(
			http.expectOne((req) => req.url.endsWith('/admin/stock/adjustments/sa_1/pdf')).request.responseType,
		).toBe('blob');
		const path = (over: Partial<AccountsListRow>) => gateway.pdfPath(row(over));
		expect(path({})).toBe('orders/ord_1/payments/r1/receipt');
		expect(path({ extra: {} })).toBeNull();
		expect(path({ tab: 'paymentVouchers', extra: { againstKind: 'selfInvoice' } })).toBe(
			'accounts/payment-vouchers/r1/pdf',
		);
		expect(path({ tab: 'paymentVouchers', extra: {} })).toBeNull();
		expect(path({ tab: 'creditNotes' })).toBe('accounts/credit-notes/r1/pdf');
		expect(path({ tab: 'creditNotes', number: null })).toBeNull();
		expect(path({ tab: 'debitNotes' })).toBe('accounts/debit-notes/r1/pdf');
		expect(path({ tab: 'refundVouchers' })).toBe('accounts/refund-vouchers/r1/pdf');
		expect(path({ tab: 'selfInvoices' })).toBe('accounts/self-invoices/r1/pdf');
		expect(path({ tab: 'selfInvoices', number: null })).toBeNull();
		expect(path({ tab: 'stockAdjustments' })).toBe('stock/adjustments/r1/pdf');
		expect(path({ tab: 'stockAdjustments', number: null })).toBeNull();
		expect(path({ tab: 'taxInvoices' })).toBe('orders/ord_1/invoices/r1/pdf?copy=original');
		expect(path({ tab: 'taxInvoices', extra: {} })).toBeNull();
		expect(path({ tab: 'purchaseBills' })).toBe('purchases/entries/r1/receipt-pdf');
		expect(path({ tab: 'journal' })).toBeNull();
	});
});

function setup(list: string, options: { fails?: boolean; permissions?: string[] } = {}) {
	const page = (items: AccountsListRow[], total = items.length) => ({
		items,
		total,
		counts: { all: total, issued: 1 },
		totals: { taxableINR: 12_180, taxINR: 608.86, count: 9 },
	});
	const gateway = {
		list: vi.fn((_tab: string, query: { page?: number }) =>
			options.fails
				? throwError(() => new Error('offline'))
				: of(page(query.page === 2 ? [row({ id: 'r2' })] : [row()], 2)),
		),
		dayBook: vi.fn(() => of(page([row({ id: 'd1' })]))),
		pdfPath: vi.fn((r: AccountsListRow) => (r.tab === 'journal' ? null : 'accounts/x/pdf')),
		pdf: vi.fn(() => (options.fails ? throwError(() => new Error('offline')) : of(new Blob(['%PDF'])))),
		printPicked: vi.fn((_tab: string, ids: readonly string[]) =>
			ids.includes('draft')
				? throwError(() => ({
						error: {
							error: {
								message: 'nothing_to_print',
								issues: [{ code: 'nothing_to_print', message: 'nothing_to_print' }],
							},
						},
					}))
				: of(new Blob(['%PDF'])),
		),
	};
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
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
			provideTanStackQuery(new QueryClient()),
			{ provide: ActivatedRoute, useValue: { data: of({ list }) } },
			{ provide: AccountsListsGateway, useValue: gateway },
			{ provide: NotificationService, useValue: notifier },
			{ provide: LocationsGateway, useValue: { list: vi.fn(() => of([{ id: 'loc_gar', name: 'Gariahat' }])) } },
			{
				provide: AuthStore,
				useValue: {
					permissions: signal(options.permissions ?? ['accounts.index', 'accounts.post']),
					user: signal(null),
				},
			},
		],
	});
	const fixture = TestBed.createComponent(AccountsListPage);
	return { fixture, page: fixture.componentInstance, gateway, notifier, router: TestBed.inject(Router) };
}

describe('the accounts list page', () => {
	afterEach(() => vi.restoreAllMocks());

	it('shows a tab: its rows, chips, totals, and the reason filter on stock adjustments', async () => {
		const { fixture, page, gateway } = setup('creditNotes');
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.list.data()).toBeTruthy());
		fixture.detectChanges();
		expect(page.chips()[0]).toBe('all');
		expect(page.tableConfig().data?.[0]?.['number']).toContain('RC/26-27/000014');
		expect(page.tableConfig().pickView?.(page.tableConfig().data?.[0] as never)).toEqual({
			title: 'RC/26-27/000014',
			detail: 'Meera <Sharma> · ₹9,560',
		});
		expect(
			page.tableConfig().pickView?.({ row: row({ number: null, party: null, amountINR: null }) } as never),
		).toEqual({ title: 'al_no_number', detail: '' });
		expect((fixture.nativeElement as HTMLElement).querySelector('#al_totals')?.textContent).toContain(
			'al_totals_credit_notes',
		);
		expect(page.inr(undefined)).toBe('₹0');
		page.setChip('issued');
		page.setReason('damage');
		page.setReason('');
		page.setPeriod({ period: 'custom', from: '2026-10-12', to: '2026-11-23' });
		page.onTableChange({ search: ' CN/26 ', page: 2, paginate: 500 });
		page.onTableChange();
		page.onTableChange({ search: 'CN', page: 2, paginate: 50 });
		expect(page.query()).toMatchObject({
			from: '2026-10-12',
			to: '2026-11-23',
			chip: 'issued',
			search: 'CN',
			page: 2,
			pageSize: 50,
		});
		page.setReason('damage');
		expect(page.query()).toMatchObject({ reason: 'damage' });
		expect(gateway.list).toHaveBeenCalledWith('creditNotes', expect.objectContaining({ chip: 'all', page: 1 }));
		const stock = setup('stockAdjustments', { permissions: [] });
		stock.fixture.detectChanges();
		expect((stock.fixture.nativeElement as HTMLElement).querySelector('#al_reason')).not.toBeNull();
		expect(stock.page.canPost()).toBe(false);
	});

	it('opens rows, prints one, says when one has no print, and exports picked rows', async () => {
		const { fixture, page, gateway, notifier, router } = setup('receipts');
		const go = vi.spyOn(router, 'navigate').mockResolvedValue(true);
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.list.data()).toBeTruthy());
		page.tableConfig();
		await page.onAction({ actionToPerform: 'view', data: { id: 'r1', row: row() } } as never);
		expect(go).toHaveBeenCalledWith(['/order', 'details', 'ord_1']);
		page.open({ id: 'd', row: row({ tab: 'debitNotes' }) });
		expect(go).toHaveBeenCalledTimes(1);
		await page.onAction({ actionToPerform: 'print', data: { id: 'r1', row: row() } } as never);
		expect(open).toHaveBeenCalled();
		await page.onAction({ actionToPerform: 'print', data: { id: 'j', row: row({ tab: 'journal' }) } } as never);
		expect(notifier.showError).toHaveBeenCalledWith('al_no_print');
		await page.onAction({ actionToPerform: 'print' } as never);
		await page.onAction({ actionToPerform: 'other', data: { id: 'r1', row: row() } } as never);
		await page.onAction({ actionToPerform: 'print_picked', data: ['r1', 'r2'] } as never);
		expect(gateway.printPicked).toHaveBeenCalledWith('receipts', ['r1', 'r2']);
		await page.onAction({ actionToPerform: 'print_picked' } as never);
		await page.printPicked(['draft']);
		expect(notifier.showError).toHaveBeenCalledWith('al_problem_nothing_to_print');
		expect(page.tableConfig().bulkActions?.map((action) => action.actionToPerform)).toEqual([
			'print_picked',
			'export',
		]);
		const saved = vi.spyOn(document, 'createElement');
		await page.onAction({ actionToPerform: 'export', data: ['r1', 'gone'] } as never);
		await page.onAction({ actionToPerform: 'export' } as never);
		expect(saved).toHaveBeenCalledWith('a');
		expect(gateway.pdf).toHaveBeenCalledTimes(1);
	});

	it('exports the whole list page by page, and says when that fails', async () => {
		const { page, gateway } = setup('receipts');
		const saved = vi.spyOn(document, 'createElement');
		await page.exportCsv();
		expect(gateway.list).toHaveBeenCalledWith('receipts', expect.objectContaining({ page: 2, pageSize: 100 }));
		expect(saved).toHaveBeenCalledWith('a');
		const failing = setup('receipts', { fails: true });
		await failing.page.exportCsv();
		expect(failing.notifier.showError).toHaveBeenCalledWith('purchasing_action_failed');
		expect(failing.page.busy()).toBe(false);
	});

	it('shows Sales and purchases: both tabs with their counts, and the location filter on tax invoices', async () => {
		const { fixture, page, gateway } = setup('taxInvoices');
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.list.data()).toBeTruthy());
		await vi.waitFor(() => expect(page.sibling.data()).toBeTruthy());
		await vi.waitFor(() => expect(page.locations.data()).toBeTruthy());
		fixture.detectChanges();
		expect(page.group()).toBe('sales');
		expect([page.tabCount('taxInvoices'), page.tabCount('purchaseBills')]).toEqual([2, 2]);
		expect(gateway.list).toHaveBeenCalledWith('purchaseBills', expect.objectContaining({ pageSize: 1 }));
		expect((fixture.nativeElement as HTMLElement).querySelector('#al_location')?.textContent).toContain('Gariahat');
		page.setLocation('loc_gar');
		expect(page.query()).toMatchObject({ location: 'loc_gar', page: 1 });
		page.setLocation('');
		expect(page.query()).not.toHaveProperty('location');
		const bills = setup('purchaseBills');
		expect([bills.page.group(), bills.page.tabCount('taxInvoices'), bills.page.tabCount('purchaseBills')]).toEqual([
			'sales',
			null,
			null,
		]);
		expect(setup('receipts').page.group()).toBe('vouchers');
	});

	it('writes the Day book from its own read, with no ticks and its own chips', async () => {
		const { fixture, page, gateway } = setup('dayBook');
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.list.data()).toBeTruthy());
		expect(page.chips()).toContain('journals');
		expect(page.group()).toBe('day');
		expect(page.tableConfig().bulkActions?.map((action) => action.actionToPerform)).toEqual(['export']);
		expect(gateway.dayBook).toHaveBeenCalled();
		const empty = setup('contra');
		empty.gateway.list.mockReturnValue(of({ items: [], total: 0, counts: {}, totals: {} }) as never);
		await empty.page.exportCsv();
		expect(empty.page.tableConfig().total).toBe(0);
	});
});
