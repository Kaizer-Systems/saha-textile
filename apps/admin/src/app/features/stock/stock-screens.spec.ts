import { type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocationsGateway } from '@core/locations/locations.gateway';
import { StockGateway } from '@core/purchasing/stock.gateway';
import { AuthStore } from '@core/state/auth.store';
import { CategoryService } from '@data-access/services/category.service';
import { NotificationService } from '@data-access/services/notification.service';

import { AdjustPopup } from './adjust-popup';
import { Approvals } from './approvals';
import { CountList } from './count-list';
import { CountPage, countedUnits } from './count-page';
import { CountStart, scopeReady } from './count-start';
import { Held } from './held';
import { OpeningStock } from './opening-stock';
import { Reorder } from './reorder';
import { Reports, monthRange, reportTabFrom } from './reports';
import { StockItem } from './stock-item';
import { StockList } from './stock-list';

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
const put = (key: string, value: unknown) => {
	h.data.set(key, value);
	h.bump();
};

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
}

function make<T>(type: Type<T>, options: Options = {}) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: StockGateway, useValue: gateway },
			{
				provide: LocationsGateway,
				useValue: { list: () => of([{ id: 'loc_1', name: 'Barasat', active: true, warehouse: true }]) },
			},
			{ provide: NotificationService, useValue: notifier },
			{ provide: Router, useValue: router },
			{ provide: QueryClient, useValue: queryClient },
			{ provide: NgbModal, useValue: modals },
			{ provide: NgbActiveModal, useValue: activeModal },
			{
				provide: TranslocoService,
				useValue: { translate: t, getActiveLang: () => 'en', getTranslation: () => ({}) },
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
					user: () => ({ id: 'adm_1' }),
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

const settle = async () => {
	for (let i = 0; i < 10; i++) await Promise.resolve();
};

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

describe('All stock (i01)', () => {
	it('draws the table, with cost only for those allowed, and filters it', async () => {
		const empty = make(StockList, { permissions: [] });
		expect(empty.c.tiles()).toBeNull();
		expect(empty.c.counts()).toEqual({ low: 0, out: 0, held: 0, older180: 0 });
		expect(empty.c.tableConfig().columns.some((column) => column.dataField === 'value')).toBe(false);
		put('stock/list', {
			items: [stockRow()],
			total: 1,
			tiles: { onHand: 5 },
			counts: { low: 1, out: 0, held: 1, older180: 0 },
		});
		const { c, fixture } = make(StockList);
		fixture.detectChanges();
		expect(c.tableConfig().total).toBe(1);
		expect(c.tableConfig().columns.some((column) => column.dataField === 'value')).toBe(true);
		expect(c.categoryOptions().length).toBeGreaterThan(0);
		for (const options of h.options) await options().queryFn();
		c.setFilter('low');
		c.setCategory('c1');
		const tableData: Record<string, unknown> = { page: 3 };
		Object.defineProperty(c, 'table', { value: () => ({ tableData }) });
		c.setFilter('out');
		c.setCategory('');
		expect(tableData['page']).toBe(1);
		c.onTableChange({ page: 2 });
		c.onTableChange();
		for (const options of h.options) await options().queryFn();
		expect(gateway.list).toHaveBeenCalledWith(expect.objectContaining({ filter: 'out' }));
		expect(make(StockList, { rows: new Error('down') }).c.categoryOptions()).toEqual([]);
	});

	it('opens history, adjusts, receives, exports and starts a count', async () => {
		const { c } = make(StockList);
		const row = { id: 'v1', row: stockRow() } as never;
		c.onAction({ actionToPerform: 'history' } as never);
		c.onAction({ actionToPerform: 'history', data: row } as never);
		expect(router.navigate).toHaveBeenCalledWith(['/stock', 'items', 'v1']);
		c.onAction({ actionToPerform: 'receive', data: row } as never);
		expect(router.navigate).toHaveBeenCalledWith(['/purchase-entries', 'create'], {
			queryParams: { variant: 'v1' },
		});
		c.onAction({ actionToPerform: 'adjust', data: row } as never);
		await settle();
		expect(queryClient.invalidateQueries).toHaveBeenCalled();
		answer = new Error('closed');
		queryClient.invalidateQueries.mockClear();
		await c.adjust(row);
		expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
		c.onAction({ actionToPerform: 'other', data: row } as never);
		await c.exportList();
		expect(h.csv.mock.calls[0]?.[1]).toContain('value_at_cost');
		c.categoryId.set('c1');
		const plain = make(StockList, { permissions: [] });
		await plain.c.exportList();
		await c.exportList();
		expect(h.csv.mock.calls[1]?.[1]).not.toContain('value_at_cost');
		c.startCount();
		expect(router.navigate).toHaveBeenCalledWith(['/stock-counts'], { queryParams: { start: 1 } });
	});
});

describe('One item, held stock and approvals (i02, i06, i07)', () => {
	it('shows one item’s history, adjusts it and receives more', async () => {
		const none = make(StockItem);
		await none.c.adjust();
		expect(modals.open).not.toHaveBeenCalled();
		put('stock/item', { row: stockRow() });
		const { c } = make(StockItem, { params: { id: 'v1' } });
		expect(c.detail()).toEqual({ row: stockRow() });
		await c.adjust();
		expect(instance.start).toHaveBeenCalled();
		expect(queryClient.invalidateQueries).toHaveBeenCalled();
		answer = null;
		queryClient.invalidateQueries.mockClear();
		await c.adjust();
		expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
		c.receive();
		expect(router.navigate).toHaveBeenCalledWith(['/purchase-entries', 'create'], {
			queryParams: { variant: 'v1' },
		});
		expect(c.change({ quantityDelta: 3 } as never)).toBe('+3');
		expect(c.change({ quantityDelta: -2 } as never)).toBe('-2');
		for (const options of h.options) options().queryFn();
		expect(c.canSeeCost()).toBe(true);
	});

	it('filters held stock by reason, releases or removes it, and returns it to the supplier', async () => {
		const { c } = make(Held);
		c.setReason('damaged' as never);
		for (const options of h.options) options().queryFn();
		c.setReason(null);
		for (const options of h.options) options().queryFn();
		expect(gateway.held).toHaveBeenCalledWith(expect.objectContaining({ reason: 'damaged' }));
		const hold = {
			id: 'hold_1',
			sku: 'ST-1',
			quantity: 2,
			reason: 'damaged',
			variantId: 'v1',
			title: 'Silk',
			soldBy: 'piece',
		} as never;
		await c.act(hold, 'release');
		expect(queryClient.invalidateQueries).toHaveBeenCalled();
		answer = null;
		await c.act(hold, 'remove');
		c.returnToSupplier(hold);
		expect(router.navigate).toHaveBeenCalledWith(['/purchase-returns', 'create'], {
			queryParams: { hold: 'hold_1', sku: 'ST-1', reason: 'quality_after_accepting' },
		});
	});

	it('approves, reviews and rejects adjustment requests', async () => {
		const { c } = make(Approvals);
		expect(c.me()).toBe('adm_1');
		c.setTab('rejected');
		for (const options of h.options) options().queryFn();
		const request = { id: 'req_1', countId: null, requestedByName: null, sku: null, title: 'Silk' } as never;
		await c.approve(request);
		expect(notifier.showSuccess).toHaveBeenCalledWith('request_approved');
		gateway.approve.mockReturnValueOnce(throwError(() => new Error('down')));
		await c.approve(request);
		expect(notifier.showError).toHaveBeenCalledWith('purchasing_action_failed');
		expect(c.busy()).toBeNull();
		c.review(request);
		c.review({ ...(request as object), countId: 'cnt_1' } as never);
		expect(router.navigate).toHaveBeenCalledWith(['/stock-counts', 'cnt_1']);
		await c.reject(request);
		expect(gateway.reject).toHaveBeenCalledWith('req_1', 'Wrong size');
		expect(notifier.showSuccess).toHaveBeenCalledWith('request_rejected');
		h.reason = null;
		await c.reject({ ...(request as object), requestedByName: 'Bina', sku: 'ST-1' } as never);
		expect(gateway.reject).toHaveBeenCalledTimes(1);
	});
});

describe('Stock counts (c01–c04)', () => {
	it('lists counts, opens the start popup from All stock, and opens a new count', async () => {
		const { c } = make(CountList, { query: { start: '1' } });
		expect(c.counts()).toEqual({});
		await vi.advanceTimersByTimeAsync(1);
		await settle();
		expect(modals.open).toHaveBeenCalled();
		c.setFilter('review');
		for (const options of h.options) options().queryFn();
		answer = { id: 'cnt_9' };
		await c.start();
		expect(router.navigate).toHaveBeenCalledWith(['/stock-counts', 'cnt_9']);
		answer = null;
		router.navigate.mockClear();
		await c.start();
		expect(router.navigate).not.toHaveBeenCalled();
		const quiet = make(CountList);
		expect(quiet.c.filter()).toBe('all');
	});

	it('starts a count for all stock, chosen categories or chosen SKUs, with counters', async () => {
		h.users = {
			items: [
				{ id: 'u1', name: 'Asha Roy', email: 'a@x.test' },
				{ id: 'u2', name: '', email: 'b@x.test' },
			],
		};
		const { c } = make(CountStart);
		expect(c.categoryOptions()).toEqual([{ value: 'c1', label: 'Sarees' }]);
		expect(c.staffOptions()).toEqual([
			{ value: 'u1', label: 'Asha Roy' },
			{ value: 'u2', label: 'b@x.test' },
		]);
		c.kind.set('categories');
		expect(c.canStart()).toBe(false);
		c.chooseCategories({ value: ['c1', 2] } as never);
		expect(c.scope().categoryIds).toEqual(['c1', '2']);
		c.chooseCategories({ value: null } as never);
		c.kind.set('skus');
		c.add({ variantId: 'v1' } as never);
		c.add({ variantId: 'v1' } as never);
		c.add({ variantId: 'v2' } as never);
		c.remove('v2');
		expect(c.scope().variantIds).toEqual(['v1']);
		c.chooseCounters({ value: ['u1'] } as never);
		c.chooseCounters({ value: 'u1' } as never);
		c.label.set('  Year end  ');
		await c.start();
		expect(gateway.startCount).toHaveBeenCalledWith({
			scope: c.scope(),
			locationId: null,
			blind: true,
			counterIds: [],
			label: 'Year end',
		});
		expect(activeModal.close).toHaveBeenCalledWith({ id: 'cnt_1' });
		gateway.startCount.mockReturnValueOnce(throwError(() => new Error('down')));
		await c.start();
		expect(c.error()).toBe('purchasing_action_failed');
		c.items.set([]);
		await c.start();
		expect(gateway.startCount).toHaveBeenCalledTimes(2);
		const noStaff = make(CountStart, { permissions: [], rows: new Error('down') });
		expect(noStaff.c.staffOptions()).toEqual([]);
		expect(noStaff.c.categoryOptions()).toEqual([]);
		h.users = undefined;
		expect(make(CountStart).c.staffOptions()).toEqual([]);
		expect(scopeReady({ kind: 'all', categoryIds: [], variantIds: [] })).toBe(true);
	});

	it('loads a count, types and steps the figures, and saves only what changed', async () => {
		const failed = make(CountPage, { params: { id: 'cnt_x' } });
		gateway.count.mockReturnValueOnce(throwError(() => new Error('down')));
		const broken = make(CountPage, { params: { id: 'cnt_x' } });
		await settle();
		expect(notifier.showError).toHaveBeenCalled();
		expect(failed.c.count()).not.toBeNull();
		expect(broken.c.count()).toBeNull();
		expect(broken.c.progress()).toBe(0);
		const none = make(CountPage);
		await none.c.saveCounts();
		await none.c.finish();
		await none.c.sendBack();
		await none.c.post();
		const { c } = make(CountPage, { params: { id: 'cnt_1' } });
		await settle();
		expect(c.typedOf(c.count()?.lines[1] as never)).toEqual({ text: '12.5', note: 'end' });
		expect(c.typedOf({ variantId: 'nope' } as never)).toEqual({ text: '', note: '' });
		expect(c.progress()).toBe(25);
		expect(c.notCounted().map((line) => line.variantId)).toEqual(['v3', 'v4']);
		expect(c.differing().map((line) => line.variantId)).toEqual(['v1']);
		c.search.set(' cotton ');
		expect(c.shown().map((line) => line.variantId)).toEqual(['v2']);
		c.search.set('st-3');
		expect(c.shown()).toHaveLength(1);
		const [silk, cotton, linen] = c.count()?.lines as [never, never, never];
		c.step(silk, 1);
		c.step(cotton, -1);
		c.step(linen, -1);
		expect(c.typedOf(silk).text).toBe('4');
		expect(c.typedOf(cotton).text).toBe('11.5');
		expect(c.typedOf(linen).text).toBe('0');
		c.type(linen, 'note', 'behind the door');
		await c.saveCounts();
		expect(gateway.enterCounts).toHaveBeenCalled();
		expect(notifier.showSuccess).toHaveBeenCalledWith('counts_saved');
		await c.saveCounts();
		expect(gateway.enterCounts).toHaveBeenCalledTimes(1);
		expect(countedUnits('', 'piece')).toBeNull();
	});

	it('scans a code to its line, prints the sheet, sends lines back and posts', async () => {
		const { c } = make(CountPage, { params: { id: 'cnt_1' } });
		await settle();
		answer = ' st-2 ';
		await c.scan();
		expect(c.highlighted()).toBe('v2');
		await vi.advanceTimersByTimeAsync(1);
		answer = 'ST-9';
		await c.scan();
		expect(notifier.showError).toHaveBeenCalledWith('scan_not_in_count(ST-9)');
		answer = null;
		await c.scan();
		await c.printSheet('cnt_1');
		expect(h.pdf).toHaveBeenCalled();
		gateway.countSheetPdf.mockReturnValueOnce(throwError(() => new Error('down')));
		await c.printSheet('cnt_1');
		expect(notifier.showError).toHaveBeenCalledWith('print_failed');
		await c.sendBack();
		expect(gateway.recount).toHaveBeenCalledWith('cnt_1', ['v1']);
		c.toggleRecount('v3');
		c.toggleRecount('v4');
		c.toggleRecount('v4');
		await c.sendBack();
		expect(gateway.recount).toHaveBeenLastCalledWith('cnt_1', ['v3']);
		await c.post();
		expect(notifier.showSuccess).toHaveBeenCalledWith('count_posted');
		gateway.postCount.mockReturnValueOnce(throwError(() => new Error('down')));
		await c.post();
		expect(notifier.showError).toHaveBeenCalledWith('purchasing_action_failed');
		c.busy.set(true);
		await c.post();
		c.busy.set(false);
		c.step(c.count()?.lines[0] as never, 1);
		await c.finish();
		expect(gateway.finishCount).toHaveBeenCalled();
		await c.finish();
		const asker = make(CountPage, { params: { id: 'cnt_1' }, permissions: [] });
		await settle();
		await asker.c.post();
		expect(notifier.showSuccess).toHaveBeenCalledWith('count_waiting_approval');
		gateway.count.mockReturnValueOnce(
			of(
				count({
					lines: [{ variantId: 'v1', sku: 'A', title: 'A', soldBy: 'piece', counted: 1, difference: 0 }],
				} as never),
			),
		);
		const same = make(CountPage, { params: { id: 'cnt_1' } });
		await settle();
		await same.c.sendBack();
		expect(gateway.recount).toHaveBeenCalledTimes(2);
		gateway.count.mockReturnValueOnce(of(count({ totals: { skus: 0, counted: 0 } } as never)));
		const zero = make(CountPage, { params: { id: 'cnt_1' } });
		await settle();
		expect(zero.c.progress()).toBe(0);
	});
});

describe('Adjust stock (i04, i04b)', () => {
	async function popup(
		permissions?: string[],
		row = stockRow(),
		preset?: { action?: 'release' | 'remove' | 'hold' | 'add'; holdId?: string },
	) {
		const made = make(AdjustPopup, { permissions });
		await made.c.start(row, preset);
		return made;
	}

	it('offers the actions the person may take, and starts on the first', async () => {
		expect((await popup(['stock.hold'])).c.actions()).toEqual(['hold', 'release']);
		expect((await popup(['stock.hold'])).c.action()).toBe('hold');
		expect((await popup([])).c.action()).toBe('remove');
		const { c } = await popup(['stock.adjust']);
		expect(c.actions()).toEqual(['remove', 'add']);
		expect(c.reasons().length).toBeGreaterThan(0);
		c.setAction('hold');
		expect(c.reasons()).toEqual([]);
		expect(c.reason()).toBeNull();
		c.setAction('add');
		expect(c.reason()).not.toBeNull();
		expect(c.buttonKey()).toBe('ask_for_approval');
		c.setAction('release');
		expect(c.buttonKey()).toBe('adjust_do_release');
	});

	it('fills a hold’s quantity when releasing it, and previews the change as it is typed', async () => {
		const metre = await popup(undefined, stockRow({ soldBy: 'metre' }), { action: 'release', holdId: 'hold_1' });
		expect(metre.c.quantity()).toBe('2.5');
		expect(metre.c.holdId()).toBe('hold_1');
		const piece = await popup(undefined, stockRow(), { action: 'release', holdId: 'hold_1' });
		expect(piece.c.quantity()).toBe('25');
		const gone = await popup(undefined, stockRow(), { action: 'release', holdId: 'hold_9' });
		expect(gone.c.quantity()).toBe('');
		gateway.holdsOf.mockReturnValueOnce(throwError(() => new Error('down')));
		const noHolds = await popup();
		expect(noHolds.c.holds()).toEqual([]);
		const { c } = await popup();
		expect(c.units()).toBeNull();
		expect(c.body()).toBeNull();
		c.quantity.set('2');
		c.note.set('  torn  ');
		c.changed();
		await vi.advanceTimersByTimeAsync(350);
		expect(gateway.preview).toHaveBeenCalledWith(
			expect.objectContaining({ quantity: 2, note: 'torn', reasonCode: 'damage' }),
		);
		expect(c.preview()).toEqual({ refusal: null });
		gateway.preview.mockReturnValueOnce(throwError(() => new Error('down')));
		c.quantity.set('3');
		c.changed();
		await vi.advanceTimersByTimeAsync(350);
		expect(c.preview()).toBeNull();
		c.quantity.set('x');
		c.changed();
		await vi.advanceTimersByTimeAsync(350);
		c.setAction('hold');
		c.quantity.set('1');
		expect(c.body()).toMatchObject({ reasonCode: null, holdReason: 'waiting_for_supplier', holdId: null });
		const blank = make(AdjustPopup);
		expect(blank.c.units()).toBeNull();
	});

	it('adds up to six photos, and saves or shows why not', async () => {
		const { c } = await popup();
		answer = Array.from({ length: 8 }, (_, i) => ({ assetId: `m${i}` }));
		await c.addPhotos();
		expect(c.photos()).toHaveLength(6);
		answer = null;
		await c.addPhotos();
		answer = [];
		await c.addPhotos();
		expect(c.photos()).toHaveLength(6);
		await c.save();
		expect(gateway.adjust).not.toHaveBeenCalled();
		c.quantity.set('1');
		c.note.set('Torn at the edge');
		await c.save();
		expect(gateway.adjust).toHaveBeenCalledWith(
			expect.objectContaining({ photoAssetIds: ['m0', 'm1', 'm2', 'm3', 'm4', 'm5'] }),
		);
		expect(activeModal.close).toHaveBeenCalledWith({ status: 'done' });
		gateway.adjust.mockReturnValueOnce(throwError(() => new Error('down')));
		await c.save();
		expect(c.error()).toBe('purchasing_action_failed');
		c.preview.set({ refusal: 'too_many' } as never);
		await c.save();
		c.preview.set(null);
		c.busy.set(true);
		await c.save();
		expect(gateway.adjust).toHaveBeenCalledTimes(2);
	});
});

describe('Opening stock (o01)', () => {
	const file = (name: string, text: string) => ({ name, text: async () => text }) as unknown as File;
	const input = (files: File[]) => ({ files, value: 'x' }) as unknown as HTMLInputElement;

	it('reads a sheet, checks it, and posts it once every row is ready', async () => {
		const { c } = make(OpeningStock);
		c.template();
		expect(h.csv).toHaveBeenCalledWith('opening-stock-template.csv', expect.any(Array), expect.any(Array));
		await c.read(input([]));
		expect(c.fileName()).toBe('');
		await c.read(input([file('stock.xlsx', '')]));
		expect(c.error()).toBe('import_csv_only');
		await c.read(input([file('stock.csv', 'Item,Cost\nx,1')]));
		expect(c.error()).toBe('opening_columns_missing');
		await c.read(input([file('stock.csv', 'SKU,Quantity,Cost each\nST-1,2,')]));
		expect(gateway.checkOpening).toHaveBeenCalled();
		expect(c.allReady()).toBe(true);
		expect(c.readyUnits()).toContain('qty_pieces');
		await c.setCost(2, 'abc');
		await c.setCost(2, '₹1,200');
		expect(c.rows()[0]?.unitCostINR).toBe(1200);
		await c.post();
		expect(notifier.showSuccess).toHaveBeenCalled();
		expect(c.rows()).toEqual([]);
		await c.post();
		await c.runCheck();
		expect(gateway.postOpening).toHaveBeenCalledTimes(1);
	});

	it('counts metres too, shows a failed check, and re-checks after a refused post', async () => {
		const { c } = make(OpeningStock);
		expect(c.readyUnits()).toBe('');
		gateway.checkOpening.mockReturnValueOnce(
			of({ rows: [{ result: 'ready' }], counts: { readyPieces: 0, readyTenths: 425 } }) as never,
		);
		await c.read(input([file('stock.csv', 'SKU,Metres\nST-1,42.5')]));
		expect(c.readyUnits()).not.toContain('qty_pieces');
		gateway.checkOpening.mockReturnValueOnce(
			of({ rows: [{ result: 'ready' }], counts: { readyPieces: 3, readyTenths: 425 } }) as never,
		);
		await c.runCheck();
		expect(c.readyUnits()).toContain(' and ');
		gateway.checkOpening.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		await c.runCheck();
		expect(c.error()).toBe('purchasing_action_failed');
		gateway.checkOpening.mockReturnValueOnce(
			of({ rows: [{ result: 'cost_missing' }], counts: { readyPieces: 0, readyTenths: 0 } }) as never,
		);
		await c.runCheck();
		expect(c.allReady()).toBe(false);
		gateway.checkOpening.mockReturnValueOnce(of({ rows: [], counts: { readyPieces: 0, readyTenths: 0 } }) as never);
		await c.runCheck();
		expect(c.allReady()).toBe(false);
		await c.runCheck();
		gateway.postOpening.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		await c.post();
		expect(c.error()).toBe('purchasing_action_failed');
		await c.printLoad('ol_1');
		expect(h.pdf).toHaveBeenCalled();
		gateway.openingPdf.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		await c.printLoad('ol_1');
		expect(notifier.showError).toHaveBeenCalledWith('print_failed');
		for (const options of h.options) options().queryFn();
	});
});

describe('Stock reports (i08–i10)', () => {
	const ageingRow = (over: Record<string, unknown> = {}) => ({
		productId: 'p1',
		variantId: 'v1',
		sku: 'ST-1',
		title: 'Silk',
		optionsLabel: null,
		imageUrl: null,
		soldBy: 'piece',
		onHand: 4,
		oldestPieceDays: 200,
		lastSoldOn: null,
		valueAtCostINR: 900,
		...over,
	});

	it('reads the tab and month helpers', () => {
		expect(reportTabFrom('value', null)).toBe('value');
		expect(reportTabFrom(undefined, 'unpaid')).toBe('unpaid');
		expect(reportTabFrom(undefined, 'nope')).toBe('ageing');
		expect(reportTabFrom(undefined, null)).toBe('ageing');
		expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
		expect(monthRange('bad').to).toMatch(/^bad-/);
	});

	it('ticks ageing rows into a sale, writes off and returns, and exports each report', async () => {
		const { c } = make(Reports, { data: { tab: 'ageing' } });
		c.setBand(180);
		c.setBand(null);
		for (const options of h.options) await options().queryFn();
		c.band.set(90);
		c.movementSearch.set('  silk ');
		c.movementFrom.set('2026-11-01');
		c.movementTo.set('2026-11-30');
		for (const options of h.options) await options().queryFn();
		expect(gateway.ageing).toHaveBeenCalledWith(expect.objectContaining({ band: 90 }));
		expect(gateway.movements).toHaveBeenCalledWith(expect.objectContaining({ q: 'silk', from: '2026-11-01' }));
		expect(c.tickedProducts()).toEqual([]);
		c.exportAgeing();
		c.exportValuation();
		c.exportUnpaid();
		c.exportRegister();
		expect(h.csv).toHaveBeenCalledTimes(2);
		put('stock-reports/ageing', {
			rows: [ageingRow(), ageingRow({ variantId: 'v2', productId: 'p2', soldBy: 'metre', optionsLabel: 'Red' })],
		});
		put('stock-reports/valuation', {
			asOn: '2026-11-24',
			groupBy: 'category',
			rows: [{ label: 'Sarees', units: 4, valueAtCostINR: 900, sellingValueINR: 2000, sharePct: 100 }],
			totalUnits: 4,
			totalValueINR: 900,
		});
		put('stock-reports/unpaid', {
			rows: [
				{
					number: 'PE-1',
					supplierName: 'Roy',
					billNumber: 'B1',
					billDate: '2026-11-01',
					dueOn: '2026-11-30',
					leftINR: 500,
					days: 23,
				},
			],
		});
		put('stock-reports/register', {
			rows: [
				{
					billDate: '2026-11-01',
					supplierName: 'Roy',
					gstin: null,
					billNumber: 'B1',
					placeOfSupply: '19',
					taxableINR: 100,
					cgstINR: 2.5,
					sgstINR: 2.5,
					igstINR: 0,
					totalINR: 105,
					reverseCharge: true,
					entryNumber: 'PE-1',
				},
				{
					billDate: '2026-11-02',
					supplierName: 'Das',
					gstin: null,
					billNumber: 'B2',
					placeOfSupply: '29',
					taxableINR: 100,
					cgstINR: 0,
					sgstINR: 0,
					igstINR: 5,
					totalINR: 105,
					reverseCharge: false,
					entryNumber: 'PE-2',
				},
			],
		});
		c.toggle('v1');
		c.toggle('v2');
		c.toggle('v2');
		expect(c.tickedProducts()).toEqual(['p1']);
		c.toSale([]);
		c.toSale(['p1', 'p1']);
		expect(router.navigate).toHaveBeenCalledWith(['/event', 'create', 'sale'], { queryParams: { products: 'p1' } });
		c.returnToSupplier(ageingRow() as never);
		await c.writeOff(ageingRow() as never);
		expect(queryClient.invalidateQueries).toHaveBeenCalled();
		answer = null;
		await c.writeOff(ageingRow() as never);
		c.exportAgeing();
		c.exportValuation();
		c.exportUnpaid();
		c.exportRegister();
		expect(h.csv).toHaveBeenCalledTimes(6);
		const plain = make(Reports, { permissions: [], query: { tab: 'register' } });
		expect(plain.c.tab()).toBe('register');
		plain.c.exportAgeing();
		expect(h.csv.mock.calls.at(-1)?.[1]).not.toContain('value_at_cost');
		plain.c.month.set('nope');
		for (const options of h.options) void options().enabled;
		expect(c.t('x')).toBe('x');
	});
});

describe('Reorder (po01)', () => {
	const reorderRow = (over: Record<string, unknown> = {}) => ({
		variantId: 'v1',
		sku: 'ST-1',
		title: 'Silk',
		optionsLabel: null,
		soldBy: 'piece',
		freeToSell: 0,
		soldLast60Days: 4,
		daysLeft: 0,
		suggested: 6,
		lastSupplierId: 'sup_b',
		lastSupplierName: 'Bose',
		...over,
	});

	it('suggests orders, keeps what was typed, and filters by supplier or out-selling', async () => {
		const empty = make(Reorder);
		expect(empty.c.lines()).toEqual([]);
		put('stock-reports/reorder', {
			items: [
				reorderRow(),
				reorderRow({
					variantId: 'v2',
					soldBy: 'metre',
					suggested: 125,
					freeToSell: 10,
					lastSupplierId: 'sup_a',
					lastSupplierName: 'Adya',
					optionsLabel: 'Red',
				}),
				reorderRow({ variantId: 'v3', lastSupplierId: null, lastSupplierName: null, suggested: 0 }),
				reorderRow({ variantId: 'v4', lastSupplierId: 'sup_c', lastSupplierName: null }),
			],
		});
		const { c, fixture } = make(Reorder);
		expect(c.lines().map((line) => [line.ticked, line.quantity])).toEqual([
			[true, '6'],
			[true, '12.5'],
			[false, '0'],
			[true, '6'],
		]);
		expect(c.suppliers().map((supplier) => supplier.id)).toEqual(['sup_c', 'sup_a', 'sup_b']);
		c.set('v1', { quantity: '9' });
		put('stock-reports/reorder', { items: [reorderRow(), reorderRow({ variantId: 'v5' })] });
		fixture.detectChanges();
		expect(c.lines()[0]?.quantity).toBe('9');
		expect(c.outSelling()).toBe(2);
		c.onlyOutSelling.set(true);
		c.supplierId.set('sup_b');
		expect(c.shown()).toHaveLength(2);
		c.supplierId.set('sup_x');
		expect(c.shown()).toHaveLength(0);
		c.onlyOutSelling.set(false);
		c.supplierId.set('');
		expect(c.orders()).toBeGreaterThan(0);
		c.exportList();
		expect(h.csv).toHaveBeenCalledWith('reorder-list.csv', expect.any(Array), expect.any(Array));
		for (const options of h.options) options().queryFn();
	});

	it('makes draft orders per supplier, and shows a refusal', async () => {
		put('stock-reports/reorder', { items: [reorderRow()] });
		const { c } = make(Reorder);
		await c.makeOrders();
		expect(notifier.showSuccess).toHaveBeenCalledWith('reorder_orders_made(2)');
		expect(router.navigate).toHaveBeenCalledWith(['/purchase-orders']);
		gateway.reorderToOrders.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		await c.makeOrders();
		expect(notifier.showError).toHaveBeenCalledWith('purchasing_action_failed');
		c.busy.set(true);
		await c.makeOrders();
		c.busy.set(false);
		c.set('v1', { ticked: false });
		await c.makeOrders();
		expect(gateway.reorderToOrders).toHaveBeenCalledTimes(2);
	});
});
