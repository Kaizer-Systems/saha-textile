import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { EntryForm, freightRate } from './entry-form';
import { lineFromItem } from './entry-lines';

import type { PurchaseEntry, PurchaseItemOption } from '@saha-textile/contracts';

/** The page's three lists, as each test sets them. */
const h = vi.hoisted(() => ({
	suppliers: undefined as unknown,
	orders: undefined as unknown,
	settings: undefined as unknown,
	supplierQuery: null as null | (() => unknown),
	queries: [] as Array<() => { queryFn: () => unknown; enabled: boolean }>,
}));
vi.mock('@core/purchasing/purchasing.gateway', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing.gateway')>()),
	injectSuppliersQuery: (query: () => unknown) => {
		h.supplierQuery = query;
		return { data: () => h.suppliers };
	},
}));
vi.mock('@core/purchasing/stock.gateway', async (original) => ({
	...(await original<typeof import('@core/purchasing/stock.gateway')>()),
	injectInventorySettingsQuery: (enabled: () => boolean) => {
		enabled();
		return { data: () => h.settings };
	},
}));
vi.mock('@tanstack/angular-query-experimental', async (original) => ({
	...(await original<typeof import('@tanstack/angular-query-experimental')>()),
	injectQuery: (options: () => { queryFn: () => unknown; enabled: boolean }) => {
		h.queries.push(options);
		return { data: () => h.orders };
	},
}));

const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key);

const item = (over: Partial<PurchaseItemOption> = {}): PurchaseItemOption => ({
	productId: 'p1',
	variantId: 'v1',
	sku: 'ST-BAN-0412',
	title: 'Red Banarasi Katan Silk Saree',
	optionsLabel: '',
	imageUrl: null,
	soldBy: 'piece',
	status: 'live',
	blocked: null,
	disabled: false,
	hsnCode: '5007',
	sellingPriceINR: 15900,
	mrpINR: 18500,
	onHand: 3,
	lastCostINR: 8600,
	lastEntryNumber: 'PE/26-27/000009',
	supplierItemCode: 'BSW-K-118',
	variantCount: 1,
	...over,
});

const supplier = (over: Record<string, unknown> = {}) => ({
	id: 'sup_1',
	legalName: 'Banaras Silk Weavers',
	shortName: '',
	active: true,
	kind: 'regular',
	taxType: 'inter_state',
	...over,
});

const savedLine = {
	lineId: 'pel_1',
	variantId: 'v1',
	productId: 'p1',
	sku: 'ST-BAN-0412',
	title: 'Red Banarasi',
	optionsLabel: '',
	soldBy: 'piece',
	imageUrl: null,
	supplierItemCode: null,
	productHsn: '5007',
	sellingPriceINR: 15900,
	lastCostINR: 8600,
	gstRatePct: 5,
	hsnOnBill: null,
	quantity: 6,
	unitPriceINR: 9200,
	freeOnBill: false,
	purchaseOrderLineId: null,
	notOrdered: false,
};

const entry = (over: Record<string, unknown> = {}) =>
	({
		id: 'pe_1',
		status: 'draft',
		supplierId: 'sup_1',
		purchaseOrderId: null,
		billNumber: 'BSW/118',
		billDate: '2026-11-20',
		goodsReceivedOn: '2026-11-21',
		pricesIncludeGst: false,
		freightINR: 0,
		roundOffINR: 0,
		totals: { printedTotalINR: null },
		billAttachment: null,
		lines: [savedLine],
		version: 3,
		warnings: [{ code: 'lookalike_bill', lineId: '' }],
		taxType: 'inter_state',
		supplierKind: 'regular',
		...over,
	}) as unknown as PurchaseEntry;

const order = (over: Record<string, unknown> = {}) => ({
	id: 'po_1',
	supplierId: 'sup_1',
	status: 'sent',
	lines: [{ lineId: 'pol_1', quantity: 10, receivedQuantity: 4 }],
	...over,
});

interface Options {
	id?: string;
	query?: Record<string, string>;
	permissions?: string[];
	results?: unknown[];
	gateway?: Record<string, unknown>;
}

function setup(options: Options = {}) {
	const results = [...(options.results ?? [])];
	const instance = { start: vi.fn(async () => undefined) };
	const modals = {
		open: vi.fn(() => {
			const next = results.shift();
			const result = next instanceof Error || next === undefined ? Promise.reject(next) : Promise.resolve(next);
			result.catch(() => undefined);
			return { componentInstance: instance, result };
		}),
	};
	const gateway = {
		supplier: vi.fn((id: string) =>
			id === 'sup_gone' ? throwError(() => new Error('gone')) : of(supplier({ id })),
		),
		entry: vi.fn(() => of(entry())),
		order: vi.fn(() => of(order())),
		receiveDraft: vi.fn(() =>
			of({
				lines: [
					{ variantId: 'v1', quantity: 6, unitPriceINR: 9000, gstRatePct: 5, purchaseOrderLineId: 'pol_1' },
					{
						variantId: 'v_gone',
						quantity: 1,
						unitPriceINR: 100,
						gstRatePct: 5,
						purchaseOrderLineId: 'pol_x',
					},
				],
			}),
		),
		itemsByVariant: vi.fn(() => of([item()])),
		saveEntry: vi.fn((_id: string | null, _write: unknown) => of(entry({ id: 'pe_9' }))),
		orders: vi.fn(() => of({ items: [] })),
		...options.gateway,
	};
	const router = { navigate: vi.fn() };
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const queries = { invalidateQueries: vi.fn(async () => undefined) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{
				provide: ActivatedRoute,
				useValue: {
					snapshot: {
						paramMap: convertToParamMap(options.id ? { id: options.id } : {}),
						queryParamMap: convertToParamMap(options.query ?? {}),
					},
				},
			},
			{ provide: Router, useValue: router },
			{ provide: PurchasingGateway, useValue: gateway },
			{ provide: NgbModal, useValue: modals },
			{ provide: NotificationService, useValue: notifier },
			{
				provide: TranslocoService,
				useValue: { translate: t, getActiveLang: () => 'en', getTranslation: () => ({}) },
			},
			{ provide: QueryClient, useValue: queries },
			{
				provide: AuthStore,
				useValue: {
					permissions: signal(
						options.permissions ?? [
							'stock.cost',
							'product.create',
							'purchase_order.index',
							'setting.index',
						],
					),
				},
			},
		],
	});
	TestBed.overrideComponent(EntryForm, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(EntryForm);
	fixture.detectChanges();
	return { page: fixture.componentInstance, fixture, gateway, modals, instance, router, notifier, queries };
}

const settle = async () => {
	for (let i = 0; i < 20; i++) await Promise.resolve();
};

afterEach(() => {
	h.suppliers = undefined;
	h.orders = undefined;
	h.settings = undefined;
	h.supplierQuery = null;
	h.queries = [];
	vi.useRealTimers();
});

describe('a purchase entry’s form: the last cases', () => {
	it('a new entry: empty header problems, default settings, nothing to check, and Cancel goes back to the list', () => {
		const { page, router } = setup({ permissions: [] });
		expect(page.canSeeCost()).toBe(false);
		expect(page.canMakeProducts()).toBe(false);
		expect(page.settings()).toEqual({ priceChangeWarnPct: 10, marginFloorPct: 20, booksClosedUpTo: null });
		expect(page.taxType()).toBe('none');
		expect(page.header().itcClaimable).toBe(true);
		page.billNumber.set('');
		expect(page.headerProblems()).toEqual(['pe_supplier_required', 'pe_bill_number_required']);
		expect(page.canSave()).toBe(false);
		expect(page.checkBlock()).toBe('pe_add_lines_first');
		expect(page.blockText()).toBe('pe_add_lines_first');
		expect(page.supplierOptions()).toEqual([]);
		expect(page.openOrders()).toEqual([]);
		page.cancel();
		expect(router.navigate).toHaveBeenCalledWith(['/purchase-entries']);
	});

	it('lists active suppliers and the one chosen, remembers them, and offers the supplier’s open orders', async () => {
		h.suppliers = {
			items: [
				supplier({ id: 'sup_1', shortName: 'BSW' }),
				supplier({ id: 'sup_off', active: false }),
				supplier({ id: 'sup_2', legalName: 'Kanchi Looms' }),
			],
		};
		h.orders = {
			items: [
				order(),
				order({ id: 'po_draft', status: 'draft' }),
				order({ id: 'po_part', status: 'part_received' }),
				order({ id: 'po_mine', status: 'received' }),
			],
		};
		h.settings = { priceChangeWarnPct: 15, marginFloorPct: 25, booksClosedUpTo: '2026-03-31' };
		const { page, fixture } = setup();
		fixture.detectChanges();
		page.searchSuppliers({ search: 'kan' } as never);
		page.searchSuppliers({ search: undefined } as never);
		page.chooseSupplier({ value: 'sup_off' } as never);
		expect(page.supplierOptions().map((row) => (row as { value: string }).value)).toEqual([
			'sup_1',
			'sup_off',
			'sup_2',
		]);
		page.purchaseOrderId.set('po_mine');
		expect(page.openOrders().map((row) => row.id)).toEqual(['po_1', 'po_part', 'po_mine']);
		expect(page.settings()).toEqual({ priceChangeWarnPct: 15, marginFloorPct: 25, booksClosedUpTo: '2026-03-31' });
		h.suppliers = { items: [] };
		page.chooseSupplier({ value: 'sup_1' } as never);
		fixture.detectChanges();
		expect(page.supplierOptions().map((row) => row.label)).toEqual(['BSW']);
		expect(page.supplier()?.id).toBe('sup_1');
		page.chooseSupplier({ value: 'sup_1' } as never);
		page.chooseSupplier({ value: 42 } as never);
		expect(page.supplierId()).toBe('');
	});

	it('opens a saved draft with its supplier, order and attachment, and a posted one on its own page', async () => {
		const withOrder = setup({
			id: 'pe_1',
			gateway: {
				entry: vi.fn(() =>
					of(
						entry({
							purchaseOrderId: 'po_1',
							freightINR: 1800,
							totals: { printedTotalINR: 184150 },
							billAttachment: { assetId: 'med_bill', name: 'bill.pdf' },
						}),
					),
				),
			},
		});
		await settle();
		const page = withOrder.page;
		expect([page.billNumber(), page.freight(), page.printedTotal(), page.attachment()?.name]).toEqual([
			'BSW/118',
			'1800',
			'184150',
			'bill.pdf',
		]);
		expect(page.order()?.id).toBe('po_1');
		expect(page.serverWarnings()).toHaveLength(1);
		expect(page.warningCount()).toBeGreaterThanOrEqual(1);
		expect(page.marginOf(page.lines()[0] as never)).toEqual({ value: expect.any(Number) });
		expect(page.marginOf({ key: 'none' } as never)).toBeNull();
		await page.reload();
		expect(withOrder.gateway.entry).toHaveBeenCalledTimes(2);
		page.cancel();
		expect(withOrder.router.navigate).toHaveBeenLastCalledWith(['/purchase-entries', 'pe_1']);

		const posted = setup({ id: 'pe_2', gateway: { entry: vi.fn(() => of(entry({ status: 'posted' }))) } });
		await settle();
		expect(posted.router.navigate).toHaveBeenCalledWith(['/purchase-entries', 'pe_2'], { replaceUrl: true });

		const failing = setup({ id: 'pe_3', gateway: { entry: vi.fn(() => throwError(() => new Error('down'))) } });
		await settle();
		expect(failing.notifier.showError).toHaveBeenCalledWith('purchasing_action_failed');
		await failing.page.reload();
	});

	it('receives goods from an order: what is still to come, skipping items it cannot find', async () => {
		const { page, notifier } = setup({ query: { order: 'po_1' } });
		await settle();
		expect(page.purchaseOrderId()).toBe('po_1');
		expect(page.lines()).toEqual([
			expect.objectContaining({ variantId: 'v1', purchaseOrderLineId: 'pol_1', ordered: 10, alreadyReceived: 4 }),
		]);
		expect(page.dirty()).toBe(true);

		const odd = setup({
			query: { order: 'po_1' },
			gateway: {
				order: vi.fn(() => of(order({ lines: [] }))),
				receiveDraft: vi.fn(() =>
					of({
						lines: [
							{ variantId: 'v1', quantity: 1, unitPriceINR: 1, gstRatePct: 5, purchaseOrderLineId: 'x' },
						],
					}),
				),
			},
		});
		await settle();
		expect(odd.page.lines()[0]).toMatchObject({ ordered: null, alreadyReceived: null });

		const failing = setup({
			query: { order: 'po_1' },
			gateway: { order: vi.fn(() => throwError(() => new Error('x'))) },
		});
		await settle();
		expect(failing.notifier.showError).toHaveBeenCalled();
		expect(notifier.showError).not.toHaveBeenCalled();
	});

	it('copies an entry as a new draft, or says why it cannot', async () => {
		const { page } = setup({ query: { copy: 'pe_1' } });
		await settle();
		expect(page.lines()).toEqual([
			expect.objectContaining({ key: 'pel_1-copy', lineId: undefined, purchaseOrderLineId: null }),
		]);
		const failing = setup({
			query: { copy: 'pe_1' },
			gateway: { entry: vi.fn(() => throwError(() => new Error('x'))) },
		});
		await settle();
		expect(failing.notifier.showError).toHaveBeenCalled();
	});

	it('starts from a supplier and an item in the address, ignores an unknown supplier, and opens Import when asked', async () => {
		vi.useFakeTimers();
		const { page, modals } = setup({ query: { supplier: 'sup_1', variant: 'v1', import: '1' } });
		await vi.advanceTimersByTimeAsync(0);
		expect(page.supplierId()).toBe('sup_1');
		expect(page.lines()).toHaveLength(1);
		expect(modals.open).toHaveBeenCalledTimes(1);
		vi.useRealTimers();

		const unknown = setup({ query: { supplier: 'sup_gone' } });
		await settle();
		expect(unknown.page.supplierId()).toBe('');

		const none = setup({ query: { variant: 'v9' }, gateway: { itemsByVariant: vi.fn(() => of([])) } });
		await settle();
		expect(none.page.lines()).toEqual([]);
		const failing = setup({
			query: { variant: 'v9' },
			gateway: { itemsByVariant: vi.fn(() => throwError(() => new Error('x'))) },
		});
		await settle();
		expect(failing.notifier.showError).toHaveBeenCalled();
	});

	it('picking an order keeps typed lines as not ordered; clearing it unlinks every line', async () => {
		const { page } = setup();
		page.addOption(item({ variantId: 'v_typed', sku: 'TYPED' }));
		await page.chooseOrder('po_1');
		expect(page.lines().map((line) => [line.variantId, line.notOrdered])).toEqual([
			['v1', false],
			['v_typed', true],
		]);
		await page.chooseOrder('');
		expect(page.order()).toBeNull();
		expect(page.lines().every((line) => line.purchaseOrderLineId === null && !line.notOrdered)).toBe(true);
		page.order.set(order() as never);
		page.chooseSupplier({ value: 'sup_1' } as never);
		expect(page.order()?.id).toBe('po_1');
		page.chooseSupplier({ value: 'sup_2' } as never);
		expect(page.order()).toBeNull();
	});

	it('adding an item twice counts it up, by pieces or by tenths of a metre; a free line is a new line', () => {
		const { page } = setup();
		page.addOption(item());
		page.addOption(item());
		page.addOption(item({ variantId: 'm1', soldBy: 'metre' }));
		page.addOption(item({ variantId: 'm1', soldBy: 'metre' }));
		expect(page.lines().map((line) => line.quantity)).toEqual(['2', '2.0']);
		page.setLine(0, 'quantity', 'x');
		page.addOption(item());
		expect(page.lines()[0]?.quantity).toBe('1');
		page.setFree(0, true);
		expect(page.lines()[0]).toMatchObject({ freeOnBill: true, price: '0' });
		page.addOption(item());
		expect(page.lines()).toHaveLength(3);
		page.setFree(1, false);
		page.setRate(1, 12);
		expect(page.lines()[1]).toMatchObject({ gstRatePct: 12, freeOnBill: false });
		page.purchaseOrderId.set('po_1');
		page.addOption(item({ variantId: 'v_new' }));
		expect(page.lines()[3]?.notOrdered).toBe(true);
		page.removeLine(3);
		expect(page.lines()).toHaveLength(3);
		expect(page.lineUnits()).toEqual([
			{ quantity: 1, soldBy: 'piece' },
			{ quantity: 20, soldBy: 'metre' },
			{ quantity: 1, soldBy: 'piece' },
		]);
		expect(page.lineUnitsText()).toEqual(expect.any(String));
	});

	it('the variant grid, a draft product, Import and the bill picker: closed adds nothing, answered adds', async () => {
		const picks = [
			{ option: item(), units: 3, priceINR: 9000 },
			{ option: item({ variantId: 'v2' }), units: 1, priceINR: 9100 },
		];
		const imported = [{ key: 'imp', variantId: 'v9', soldBy: 'piece', quantity: '1', price: '1' }];
		const { page } = setup({
			results: [
				new Error('closed'),
				picks,
				new Error('closed'),
				item({ variantId: 'v_draft' }),
				[],
				imported,
				new Error('closed'),
				[{ assetId: 'med_bill', name: 'bill.jpg' }],
			],
		});
		page.addOption(item());
		await page.openGrid(item());
		await page.openGrid(item());
		expect(page.lines().map((line) => [line.variantId, line.quantity])).toEqual([
			['v1', '3'],
			['v2', '1'],
		]);
		await page.makeDraft('New design');
		await page.makeDraft('New design');
		await page.importLines();
		page.purchaseOrderId.set('po_1');
		await page.importLines();
		expect(page.lines().map((line) => line.variantId)).toEqual(['v1', 'v2', 'v_draft', 'v9']);
		expect(page.lines()[3]?.notOrdered).toBe(true);
		await page.pickBill();
		await page.pickBill();
		expect(page.attachment()).toEqual({ assetId: 'med_bill', name: 'bill.jpg' });
	});

	it('words a warning with the last bill named, or without a line', () => {
		const { page } = setup();
		const line = { lastEntryNumber: 'PE/9' } as never;
		expect(
			page.warnText(
				{ code: 'price_jump', lineId: 'a', values: { risePct: 50, lastPriceINR: 100 } } as never,
				line,
			),
		).toMatch(/^warn_price_jump_entry:.*"entry":"PE\/9"/);
		expect(page.warnText({ code: 'lookalike_bill', lineId: '', values: { billNumber: 'B/1' } } as never)).toBe(
			'warn_lookalike_bill:{"bill":"B/1"}',
		);
	});

	it('freight takes the rate of most of the bill’s value, skipping unfinished lines', () => {
		const line = (rate: number, quantity: string, price: string, soldBy: 'piece' | 'metre' = 'piece') => ({
			...lineFromItem(item({ soldBy }), null, null),
			gstRatePct: rate,
			quantity,
			price,
		});
		expect(
			freightRate([
				line(5, '2', '9,000'),
				line(12, '1.5', '₹1,000', 'metre'),
				line(18, '', '50'),
				line(28, '1', 'abc'),
			]),
		).toBe(5);
	});

	it('searches suppliers by what is typed, and asks for open orders only with a supplier and the right', async () => {
		const { page, gateway } = setup();
		expect(h.supplierQuery?.()).not.toHaveProperty('q');
		page.searchSuppliers({ search: 'kan' } as never);
		expect(h.supplierQuery?.()).toMatchObject({ q: 'kan' });
		const orders = h.queries[0] as () => { queryFn: () => unknown; enabled: boolean };
		expect(orders().enabled).toBe(false);
		page.supplierId.set('sup_1');
		expect(orders().enabled).toBe(true);
		await orders().queryFn();
		expect(gateway.orders).toHaveBeenCalledWith({ supplierId: 'sup_1', filter: 'all', page: 1, pageSize: 100 });
	});

	it('groups each line’s warnings, keeps a server warning only until a change, and names every header problem', () => {
		h.settings = { booksClosedUpTo: '2026-12-31' };
		const { page } = setup();
		page.addOption(item());
		page.setLine(0, 'price', '15,000');
		expect(page.warningsByLine().get(page.lines()[0]?.key as string)?.length).toBeGreaterThanOrEqual(1);
		page.entry.set(entry({ warnings: undefined }));
		expect(page.serverWarnings()).toEqual([]);
		page.billDate.set('');
		page.goodsReceivedOn.set('');
		expect(page.headerProblems()).toEqual(
			expect.arrayContaining(['pe_bill_date_required', 'pe_received_required']),
		);
		page.billDate.set('2026-11-01');
		expect(page.headerProblems()).toContain('books_closed');
	});

	it('opens a draft not tied to any order', async () => {
		const { page, gateway } = setup({ id: 'pe_1' });
		await settle();
		expect(page.order()).toBeNull();
		expect(gateway.order).not.toHaveBeenCalled();
		page.order.set(order() as never);
		page.supplierId.set('');
		page.chooseSupplier({ value: 'sup_1' } as never);
		expect(page.order()?.id).toBe('po_1');
	});

	describe('saving and Check goods', () => {
		const ready = (page: EntryForm) => {
			page.supplierId.set('sup_1');
			page.billNumber.set('BSW/118');
			page.addOption(item());
		};

		it('a new draft saves, says so and moves to its own address; a saved one saves quietly in place', async () => {
			const { page, router, notifier, gateway, queries } = setup();
			await page.save();
			expect(gateway.saveEntry).not.toHaveBeenCalled();
			expect(page.touched()).toBe(true);
			ready(page);
			page.attachment.set({ assetId: 'med_bill', name: 'bill.pdf' });
			expect(await page.save()).toMatchObject({ id: 'pe_9' });
			expect(gateway.saveEntry).toHaveBeenCalledWith(
				null,
				expect.objectContaining({ billAttachmentAssetId: 'med_bill' }),
			);
			expect(notifier.showSuccess).toHaveBeenCalledWith('pe_draft_saved');
			expect(router.navigate).toHaveBeenCalledWith(['/purchase-entries', 'pe_9', 'edit'], { replaceUrl: true });
			expect(queries.invalidateQueries).toHaveBeenCalled();
			await page.save(true);
			expect(gateway.saveEntry).toHaveBeenLastCalledWith('pe_9', expect.objectContaining({ version: 3 }));
			expect(notifier.showSuccess).toHaveBeenCalledTimes(1);
		});

		it('a conflict, a duplicate bill and other refusals are each shown their own way', async () => {
			const conflict = {
				status: 409,
				error: { issues: [{ code: 'stale', message: 'Changed meanwhile', target: null }] },
			};
			const duplicate = {
				status: 422,
				error: {
					issues: [{ code: 'duplicate_bill', message: 'Bill already entered', path: ['billNumber', 'pe_7'] }],
				},
			};
			const fields = {
				status: 422,
				error: {
					issues: [
						{ code: 'hsn_digits', message: 'HSN has 4, 6 or 8 digits', path: ['lines', 'hsnOnBill'] },
						{ code: 'bill_date', message: 'Too old' },
					],
				},
			};
			const saveEntry = vi
				.fn()
				.mockReturnValueOnce(throwError(() => conflict))
				.mockReturnValueOnce(throwError(() => duplicate))
				.mockReturnValueOnce(throwError(() => fields));
			const { page, notifier } = setup({ gateway: { saveEntry } });
			ready(page);
			expect(await page.save()).toBeNull();
			expect(page.conflict()).toBe('Changed meanwhile');
			await page.save();
			expect(page.duplicate()).toEqual({ message: 'Bill already entered', id: 'pe_7' });
			page.changed();
			expect(page.duplicate()).toBeNull();
			await page.save();
			expect(page.fieldErrors()).toEqual({
				hsnOnBill: 'HSN has 4, 6 or 8 digits',
				bill_date: 'Too old',
			});
			expect(notifier.showError).toHaveBeenCalledWith('HSN has 4, 6 or 8 digits');
			expect(page.saving()).toBe(false);
		});

		it('Check goods waits for lines, a fixed line, a typed total that matches; then saves first if needed', async () => {
			const { page, router, gateway } = setup();
			await page.checkGoods();
			ready(page);
			page.setLine(0, 'quantity', '');
			expect(page.checkBlock()).toBe('pe_fix_lines_first');
			page.setLine(0, 'quantity', '1');
			expect(page.checkBlock()).toBe('pe_type_printed_total');
			page.printedTotal.set('1');
			expect(page.totalMismatch()).toBe(true);
			expect(page.checkBlock()).toBe('pe_total_mismatch_short');
			page.printedTotal.set(String(page.totals().totalINR));
			expect(page.checkBlock()).toBeNull();
			expect(page.blockText()).toBe('');
			gateway.saveEntry.mockReturnValueOnce(throwError(() => new Error('down')));
			await page.checkGoods();
			expect(router.navigate).not.toHaveBeenCalledWith(['/purchase-entries', 'pe_9', 'check']);
			await page.checkGoods();
			expect(router.navigate).toHaveBeenLastCalledWith(['/purchase-entries', 'pe_9', 'check']);
			page.printedTotal.set(String(page.totals().totalINR));
			page.dirty.set(false);
			router.navigate.mockClear();
			await page.checkGoods();
			expect(gateway.saveEntry).toHaveBeenCalledTimes(2);
			expect(router.navigate).toHaveBeenCalledWith(['/purchase-entries', 'pe_9', 'check']);
		});
	});
});
