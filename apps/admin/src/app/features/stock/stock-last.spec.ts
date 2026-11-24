import { type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StockGateway } from '@core/purchasing/stock.gateway';
import { AuthStore } from '@core/state/auth.store';
import { CategoryService } from '@data-access/services/category.service';
import { NotificationService } from '@data-access/services/notification.service';

import { Approvals } from './approvals';
import { CountList } from './count-list';
import { CountPage, changedEntries } from './count-page';
import { Held } from './held';
import { OpeningStock, openingRows } from './opening-stock';
import { orderLines } from './reorder';
import { Reports, monthRange } from './reports';
import { toStockRow } from './stock-list';

import type { StockCount, StockListRow } from '@saha-textile/contracts';

/** Queries read `h.data` by their key; `h.bump()` makes the screens read again. */
const h = vi.hoisted(() => ({
	data: new Map<string, unknown>(),
	options: [] as Array<() => { queryKey: unknown[]; queryFn: () => unknown; enabled?: boolean }>,
	bump: (): void => undefined,
	users: undefined as unknown,
	reason: 'Wrong size' as unknown,
	csv: vi.fn(),
	pdf: vi.fn(),
}));
const keyOf = (queryKey: readonly unknown[]) => {
	const [first, second] = queryKey;
	return first === 'stock' || first === 'stock-reports' ? `${String(first)}/${String(second)}` : String(first);
};
vi.mock('@tanstack/angular-query-experimental', async (original) => {
	const actual = await original<typeof import('@tanstack/angular-query-experimental')>();
	const { computed, signal } = await import('@angular/core');
	const version = signal(0);
	h.bump = () => version.update((value) => value + 1);
	return {
		...actual,
		injectQuery: (options: (typeof h.options)[number]) => {
			h.options.push(options);
			return {
				data: computed(() => {
					version();
					return h.data.get(keyOf(options().queryKey));
				}),
			};
		},
	};
});
vi.mock('@data-access/queries/admin-users.queries', () => ({
	injectAdminUsersQuery: (params: () => unknown) => {
		params();
		return { data: () => h.users };
	},
}));
vi.mock('@features/purchasing/shared/popups', () => ({
	askReason: async (_modals: unknown, options: { act: (reason: string) => Promise<unknown> }) =>
		typeof h.reason === 'string' ? options.act(h.reason) : h.reason,
}));
vi.mock('@core/purchasing/purchasing-format', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing-format')>()),
	downloadCsv: h.csv,
	openPdf: h.pdf,
}));

const t = (key: string, params?: Record<string, unknown>) =>
	params && Object.keys(params).length ? `${key}(${Object.values(params).join('|')})` : key;

function stockRow(over: Partial<StockListRow> = {}): StockListRow {
	return {
		productId: 'p1',
		variantId: 'v1',
		sku: 'ST-1',
		title: 'Silk',
		optionsLabel: 'Red',
		imageUrl: null,
		categoryName: 'Sarees',
		soldBy: 'piece',
		onHand: 5,
		held: 1,
		inOrders: 1,
		freeToSell: 3,
		lowStockLevel: 2,
		status: 'in_stock',
		valueAtCostINR: 4000,
		lastReceivedOn: '2026-11-01',
		oldestPieceDays: 12,
		...over,
	} as StockListRow;
}

const gateway = {
	list: vi.fn((_query: unknown) =>
		of({ items: [stockRow(), stockRow({ variantId: 'v2', optionsLabel: null, soldBy: 'metre' })], total: 2 }),
	),
	detail: vi.fn(() => of({})),
	held: vi.fn(() => of({})),
	approvals: vi.fn(() => of({})),
	approve: vi.fn(() => of({})),
	reject: vi.fn(() => of({})),
	counts: vi.fn(() => of({})),
	startCount: vi.fn((_body: unknown) => of({ id: 'cnt_1' })),
	count: vi.fn(() => of(count())),
	enterCounts: vi.fn((_id: string, _body: unknown) => of(count())),
	finishCount: vi.fn(() => of(count())),
	countSheetPdf: vi.fn(() => of(new Blob(['%PDF']))),
	recount: vi.fn((_id: string, _ids: unknown) => of(count())),
	postCount: vi.fn(() => of(count())),
	preview: vi.fn((_body: unknown) => of({ refusal: null })),
	holdsOf: vi.fn(() => of([{ id: 'hold_1', quantity: 25, reason: 'damaged', note: '', since: '2026-11-01' }])),
	adjust: vi.fn((_body: unknown) => of({ status: 'done' })),
	openingLoads: vi.fn(() => of([])),
	openingPdf: vi.fn(() => of(new Blob(['%PDF']))),
	checkOpening: vi.fn((_rows: unknown) =>
		of({ rows: [{ result: 'ready' }], counts: { readyPieces: 2, readyTenths: 0 } }),
	),
	postOpening: vi.fn(() => of({ rows: [{}], number: 'OS-1' })),
	ageing: vi.fn(() => of({})),
	valuation: vi.fn(() => of({})),
	movements: vi.fn((_query: unknown) => of({})),
	register: vi.fn(() => of({})),
	unpaidBills: vi.fn(() => of({})),
	reorder: vi.fn(() => of({})),
	reorderToOrders: vi.fn((_lines: unknown) => of([{ id: 'po_1' }, { id: 'po_2' }])),
};
const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
const router = { navigate: vi.fn() };
const queryClient = { invalidateQueries: vi.fn(async () => undefined) };
const activeModal = { close: vi.fn() };
let answer: unknown = true;
const instance = { start: vi.fn(async () => undefined) };
const modals = {
	open: vi.fn(() => {
		const result = answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
		result.catch(() => undefined);
		return { componentInstance: instance, result };
	}),
};

function count(over: Partial<StockCount> = {}): StockCount {
	return {
		id: 'cnt_1',
		totals: { skus: 4, counted: 1 },
		lines: [
			{
				variantId: 'v1',
				sku: 'ST-1',
				title: 'Silk',
				soldBy: 'piece',
				counted: 3,
				note: null,
				difference: -1,
				recount: false,
			},
			{
				variantId: 'v2',
				sku: 'ST-2',
				title: 'Cotton roll',
				soldBy: 'metre',
				counted: 125,
				note: 'end',
				difference: 0,
				recount: false,
			},
			{
				variantId: 'v3',
				sku: 'ST-3',
				title: 'Linen',
				soldBy: 'piece',
				counted: null,
				note: null,
				difference: null,
				recount: false,
			},
			{
				variantId: 'v4',
				sku: 'ST-4',
				title: 'Wool',
				soldBy: 'piece',
				counted: 2,
				note: null,
				difference: 0,
				recount: true,
			},
		],
		...over,
	} as unknown as StockCount;
}

interface Options {
	permissions?: string[];
	params?: Record<string, string>;
	query?: Record<string, string>;
	data?: Record<string, unknown>;
	rows?: unknown;
	lang?: string;
	noUser?: boolean;
}

function make<T>(type: Type<T>, options: Options = {}) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: StockGateway, useValue: gateway },
			{ provide: NotificationService, useValue: notifier },
			{ provide: Router, useValue: router },
			{ provide: QueryClient, useValue: queryClient },
			{ provide: NgbModal, useValue: modals },
			{ provide: NgbActiveModal, useValue: activeModal },
			{
				provide: TranslocoService,
				useValue: { translate: t, getActiveLang: () => options.lang ?? 'en', getTranslation: () => ({}) },
			},
			{
				provide: AuthStore,
				useValue: {
					permissions: () =>
						options.permissions ?? [
							'stock.cost',
							'stock.adjust',
							'stock.approve',
							'stock.hold',
							'admin_user.index',
							'stock_count.post',
						],
					user: () => (options.noUser ? null : { id: 'adm_1' }),
				},
			},
			{
				provide: CategoryService,
				useValue: {
					getCategoryRows: () =>
						options.rows instanceof Error
							? throwError(() => options.rows)
							: of(
									options.rows ?? [
										{ id: 'c1', name: { en: 'Sarees' }, path: 'Sarees', parentId: null },
									],
								),
				},
			},
			{
				provide: ActivatedRoute,
				useValue: {
					snapshot: {
						paramMap: convertToParamMap(options.params ?? {}),
						queryParamMap: convertToParamMap(options.query ?? {}),
						data: options.data ?? {},
					},
				},
			},
		],
	});
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(type);
	fixture.detectChanges();
	return { c: fixture.componentInstance, fixture };
}

beforeEach(() => {
	vi.useFakeTimers();
	answer = true;
});
afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
	h.data.clear();
	h.users = undefined;
	h.reason = 'Wrong size';
});

describe('stock screens: the last cases', () => {
	it('approvals: no one signed in, and whether costs show', () => {
		const { c } = make(Approvals, { noUser: true, permissions: [] });
		expect(c.me()).toBeNull();
		expect(c.canSeeCost()).toBe(false);
	});

	it('a count started from a closed popup opens nothing', async () => {
		answer = new Error('closed');
		const { c } = make(CountList);
		await c.start();
		expect(router.navigate).not.toHaveBeenCalled();
	});

	it('a count page before its count loads, a full list with no search, and a scan closed or of an unknown count', async () => {
		const { c } = make(CountPage);
		expect(c.canPost()).toBe(true);
		expect(c.notCounted()).toEqual([]);
		expect(c.shown()).toEqual([]);
		answer = new Error('closed');
		await c.scan();
		expect(notifier.showError).not.toHaveBeenCalled();
		answer = 'st-9';
		await c.scan();
		expect(notifier.showError).toHaveBeenCalledWith('scan_not_in_count(ST-9)');
		c.count.set(count());
		expect(c.shown()).toHaveLength(4);
		expect(changedEntries(count().lines, new Map([['v9', { text: '1', note: '' }]]))).toEqual([]);
	});

	it('held stock: an adjustment closed without acting refreshes nothing', async () => {
		answer = new Error('closed');
		const { c } = make(Held);
		await c.act({ id: 'hold_1', variantId: 'v1', quantity: 1 } as never, 'release');
		expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
	});

	it('reads short rows, a blank quantity, many unreadable dates and too many rows', () => {
		const short = openingRows([['SKU', 'Quantity', 'Cost', 'Received', 'Note'], [], ['ST-1']]);
		expect(short.rows[0]).toMatchObject({
			sku: 'ST-1',
			quantity: 0,
			unitCostINR: null,
			receivedOn: null,
			note: '',
		});
		const dates = openingRows([
			['SKU', 'Quantity', 'Date'],
			...Array.from({ length: 9 }, (_, i) => [`ST-${i}`, '1', 'not a date']),
		]);
		expect(dates.problem?.params?.['rows']).toMatch(/…$/);
		const many = openingRows([['SKU', 'Quantity'], ...Array.from({ length: 20001 }, (_, i) => [`ST-${i}`, '1'])]);
		expect(many.problem).toEqual({ key: 'opening_too_many_rows' });
	});

	it('opening stock: units joined in Bengali, and a cost typed for one row of several', async () => {
		const { c } = make(OpeningStock, { lang: 'bn' });
		gateway.checkOpening.mockReturnValueOnce(
			of({ rows: [{ result: 'ready' }], counts: { readyPieces: 3, readyTenths: 425 } }) as never,
		);
		c.rows.set([
			{ row: 2, sku: 'ST-1', quantity: 1, unitCostINR: null, receivedOn: null, note: '' },
			{ row: 3, sku: 'ST-2', quantity: 1, unitCostINR: null, receivedOn: null, note: '' },
		]);
		await c.runCheck();
		expect(c.readyUnits()).toContain('qty_pieces');
		await c.setCost(3, '500');
		expect(c.rows().map((row) => row.unitCostINR)).toEqual([null, 500]);
	});

	it('reorder: a quantity that cannot be read orders nothing', () => {
		expect(
			orderLines([
				{
					ticked: true,
					quantity: 'abc',
					row: { variantId: 'v1', lastSupplierId: 's1', soldBy: 'piece' },
				} as never,
			]),
		).toEqual([]);
	});

	it('reports: a month with no month part, no value date, and a write-off closed without acting', async () => {
		expect(monthRange('2026')).toEqual({ from: '2026-01', to: '2026-31' });
		answer = new Error('closed');
		const { c } = make(Reports, { query: { tab: 'value' } });
		c.asOn.set('');
		const valuation = h.options.find((options) => String(options().queryKey).includes('valuation'));
		expect(valuation?.().enabled).toBe(false);
		await c.writeOff({ productId: 'p1', variantId: 'v1', sku: 'ST-1', title: 'Silk', soldBy: 'piece' } as never);
		expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
	});

	it('a stock row with no category, nothing in orders, never received and no oldest piece', () => {
		const row = toStockRow(
			{
				productId: 'p1',
				variantId: 'v1',
				sku: 'ST-1',
				title: 'Silk',
				optionsLabel: null,
				imageUrl: null,
				categoryName: null,
				soldBy: 'piece',
				onHand: 1,
				held: 0,
				inOrders: 0,
				freeToSell: 1,
				lowStockLevel: null,
				status: 'in_stock',
				valueAtCostINR: null,
				lastReceivedOn: null,
				oldestPieceDays: null,
			} as never,
			t,
		);
		expect([row.category, row.lastReceived, row.oldest]).toEqual(['—', '—', '—']);
		expect(row.inOrders).toContain('0');
	});
});
