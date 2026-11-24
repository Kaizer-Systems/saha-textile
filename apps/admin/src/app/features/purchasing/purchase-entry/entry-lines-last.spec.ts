import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { dateNotes, lineFromItem, lineProblem, warningText } from './entry-lines';
import { EntryList, type EntryTableRow } from './entry-list';

import type { PurchaseItemOption } from '@saha-textile/contracts';

const h = vi.hoisted(() => ({
	page: undefined as unknown,
	query: null as null | (() => unknown),
	saved: [] as string[],
}));
vi.mock('@core/purchasing/purchasing.gateway', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing.gateway')>()),
	injectEntriesQuery: (query: () => unknown) => {
		h.query = query;
		return { data: () => h.page };
	},
}));
vi.mock('@core/purchasing/purchasing-format', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing-format')>()),
	saveBlob: (name: string) => void h.saved.push(name),
}));

const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key);

const item = (over: Partial<PurchaseItemOption> = {}) =>
	({
		productId: 'p1',
		variantId: 'v1',
		sku: 'ST-1',
		title: 'Red saree',
		optionsLabel: '',
		imageUrl: null,
		soldBy: 'piece',
		hsnCode: '5007',
		sellingPriceINR: 15900,
		lastCostINR: 8600,
		lastEntryNumber: null,
		supplierItemCode: null,
		disabled: false,
		...over,
	}) as PurchaseItemOption;

afterEach(() => {
	h.page = undefined;
	h.saved = [];
});

describe('bill lines: the last cases', () => {
	it('a new item with no HSN and no last cost starts with both blank', () => {
		expect(lineFromItem(item({ hsnCode: null, lastCostINR: null }), null, null)).toMatchObject({
			hsnOnBill: '',
			price: '',
			quantity: '',
		});
	});

	it('names what is wrong with a line: a bad quantity, none, or a price that is not money', () => {
		const line = { ...lineFromItem(item(), 1, 100) };
		expect(lineProblem({ ...line, quantity: '1.5' })).toBe('qty_whole_pieces');
		expect(lineProblem({ ...line, quantity: '0' })).toBe('qty_required');
		expect(lineProblem({ ...line, price: 'abc' })).toBe('payment_amount_invalid');
		expect(lineProblem({ ...line, price: 'abc', freeOnBill: true })).toBeNull();
	});

	it('refuses dates inside closed books, naming the closing date', () => {
		expect(
			dateNotes({
				billDate: '2026-03-01',
				goodsReceivedOn: '',
				today: '2026-11-24',
				booksClosedUpTo: '2026-03-31',
			}).refusal,
		).toEqual({ key: 'books_closed_up_to', params: { date: '2026-03-31' } });
	});

	it('words each warning, with nothing missing even when values are', () => {
		const money = (value: number) => `₹${value}`;
		expect(warningText({ code: 'price_jump', values: { risePct: 40 } } as never, t, money)).toBe(
			'warn_price_jump:{"pct":40,"price":"₹0","entry":null}',
		);
		expect(
			warningText(
				{ code: 'margin_floor', values: { marginPct: 5, floorPct: 20, sellingPriceINR: 900 } } as never,
				t,
				money,
			),
		).toBe('warn_margin_floor:{"margin":5,"floor":20,"price":"₹900"}');
		expect(warningText({ code: 'margin_floor', values: {} } as never, t, money)).toContain('"price":"₹0"');
		expect(
			warningText({ code: 'hsn_mismatch', values: { hsnOnBill: '5208', productHsn: '5007' } } as never, t, money),
		).toBe('warn_hsn_mismatch:{"bill":"5208","product":"5007"}');
	});
});

describe('Purchases › Purchase entries: the list (p01)', () => {
	function list(options: { permissions?: string[]; receipt?: () => unknown } = {}) {
		const router = { navigate: vi.fn() };
		const notifier = { showError: vi.fn() };
		const gateway = { entryReceiptPdf: vi.fn(options.receipt ?? (() => of(new Blob(['%PDF'])))) };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: Router, useValue: router },
				{ provide: PurchasingGateway, useValue: gateway },
				{ provide: NotificationService, useValue: notifier },
				{ provide: TranslocoService, useValue: { translate: t } },
				{ provide: AuthStore, useValue: { permissions: signal(options.permissions ?? ['purchase.create']) } },
			],
		});
		TestBed.overrideComponent(EntryList, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(EntryList);
		fixture.detectChanges();
		return { page: fixture.componentInstance, fixture, router, notifier, gateway };
	}
	const row = (status: string) => ({ id: 'pe_1', status }) as EntryTableRow;

	it('before the list arrives: no tiles, no counts, an empty table', () => {
		const { page } = list();
		expect([page.tiles(), page.counts(), page.tableConfig().data, page.tableConfig().total]).toEqual([
			null,
			{},
			[],
			0,
		]);
	});

	it('draws each entry, filters back to page one, and keeps the table’s own page and search', () => {
		h.page = {
			items: [
				{
					id: 'pe_1',
					status: 'posted',
					number: 'PE/1',
					supplierName: 'Weavers',
					billNumber: 'B/1',
					billDate: '2026-11-20',
					pieces: 6,
					totalINR: 48400,
					paymentStatus: 'unpaid',
				},
			],
			total: 1,
			tiles: { drafts: 1 },
			counts: { all: 1 },
		};
		const { page } = list();
		expect(page.tableConfig().data[0]?.id).toBe('pe_1');
		expect([page.tiles(), page.counts(), page.tableConfig().total]).toEqual([{ drafts: 1 }, { all: 1 }, 1]);
		page.onTableChange({ page: 3, search: 'weav' });
		expect(h.query?.()).toMatchObject({ filter: 'all', page: 3, q: 'weav' });
		page.onTableChange();
		const table = { tableData: { page: 4 } as Record<string, unknown> };
		Object.defineProperty(page, 'table', { value: () => table });
		page.setFilter('unpaid');
		expect(table.tableData['page']).toBe(1);
		expect(h.query?.()).toMatchObject({ filter: 'unpaid', page: 1 });
		Object.defineProperty(page, 'table', { value: () => undefined });
		page.setFilter('draft');
		expect(page.filter()).toBe('draft');
	});

	it('opens drafts in the form for an editor, and every other entry on its page', () => {
		const editor = list();
		editor.page.open(row('draft'));
		editor.page.open(row('checked'));
		editor.page.open(row('posted'));
		expect(editor.router.navigate.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
			['/purchase-entries', 'pe_1', 'edit'],
			['/purchase-entries', 'pe_1', 'edit'],
			['/purchase-entries', 'pe_1'],
		]);
		const reader = list({ permissions: [] });
		reader.page.open(row('draft'));
		expect(reader.router.navigate).toHaveBeenCalledWith(['/purchase-entries', 'pe_1']);
	});

	it('row actions: view, copy as a new draft, and the goods receipt', async () => {
		const { page, router, notifier, gateway } = list();
		page.onAction({ actionToPerform: 'view', data: undefined } as never);
		page.onAction({ actionToPerform: 'view', data: row('posted') } as never);
		page.onAction({ actionToPerform: 'copy', data: row('posted') } as never);
		page.onAction({ actionToPerform: 'other', data: row('posted') } as never);
		expect(router.navigate.mock.calls).toEqual([
			[['/purchase-entries', 'pe_1']],
			[['/purchase-entries', 'create'], { queryParams: { copy: 'pe_1' } }],
		]);
		page.onAction({ actionToPerform: 'receipt', data: row('posted') } as never);
		await vi.waitFor(() => expect(h.saved).toEqual(['goods-receipt-pe_1.pdf']));
		gateway.entryReceiptPdf.mockReturnValueOnce(throwError(() => new Error('down')));
		await page.receipt(row('posted'));
		expect(notifier.showError).toHaveBeenCalledWith('purchasing_action_failed');
	});
});
