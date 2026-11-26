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

import { OrderForm, lineFromOption, lineFromOrder, orderEstimate } from './order-form';

import type { PurchaseItemOption, PurchaseOrderLine } from '@saha-textile/contracts';

const suppliers = signal<unknown>(undefined);
const h = vi.hoisted(() => ({
	settings: undefined as unknown,
	stores: undefined as unknown,
	supplierQuery: null as null | (() => unknown),
	enabled: [] as Array<() => boolean>,
}));
vi.mock('@core/purchasing/purchasing.gateway', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing.gateway')>()),
	injectSuppliersQuery: (query: () => unknown) => {
		h.supplierQuery = query;
		return { data: () => suppliers() };
	},
}));
vi.mock('@core/purchasing/stock.gateway', async (original) => ({
	...(await original<typeof import('@core/purchasing/stock.gateway')>()),
	injectInventorySettingsQuery: (enabled: () => boolean) => {
		h.enabled.push(enabled);
		return { data: () => h.settings };
	},
}));
vi.mock('@core/stores/store-location.gateway', async (original) => ({
	...(await original<typeof import('@core/stores/store-location.gateway')>()),
	injectStoreLocationsQuery: (enabled: () => boolean) => {
		h.enabled.push(enabled);
		return { data: () => h.stores };
	},
}));

const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key);

const option = (variantId: string, over: Partial<PurchaseItemOption> = {}) =>
	({
		productId: 'p1',
		variantId,
		sku: `SKU-${variantId}`,
		title: 'Red saree',
		optionsLabel: '',
		imageUrl: null,
		soldBy: 'piece',
		lastCostINR: 8600,
		supplierItemCode: null,
		...over,
	}) as PurchaseItemOption;

const orderLine = (over: Record<string, unknown> = {}) =>
	({
		lineId: 'pol_1',
		variantId: 'v1',
		productId: 'p1',
		sku: 'SKU-v1',
		title: 'Red saree',
		optionsLabel: '',
		soldBy: 'piece',
		lastCostINR: 8600,
		supplierItemCode: null,
		gstRatePct: 5,
		quantity: 6,
		agreedPriceINR: 9000,
		backorderLineIds: ['bol_1'],
		...over,
	}) as unknown as PurchaseOrderLine;

const order = (over: Record<string, unknown> = {}) => ({
	id: 'po_3',
	number: 'PO/26-27/000003',
	status: 'draft',
	supplierId: 'sup_1',
	expectedBy: '2026-12-01',
	deliverTo: 'Shop · Kolkata',
	noteToSupplier: null,
	internalNote: 'Pay on arrival',
	version: 2,
	lines: [orderLine()],
	...over,
});

interface Options {
	id?: string;
	query?: Record<string, string>;
	permissions?: string[];
	results?: unknown[];
	gateway?: Record<string, unknown>;
}

function form(options: Options = {}) {
	const results = [...(options.results ?? [])];
	const instance = { start: vi.fn(async () => undefined) };
	const modals = {
		open: vi.fn(() => {
			const next = results.shift();
			const result = next ? Promise.resolve(next) : Promise.reject(new Error('closed'));
			result.catch(() => undefined);
			return { componentInstance: instance, result };
		}),
	};
	const gateway = {
		order: vi.fn(() => of(order())),
		supplier: vi.fn((id: string) =>
			id === 'sup_gone'
				? throwError(() => new Error('gone'))
				: of({ id, legalName: 'Tant Ghar', email: 'o@t.test' }),
		),
		saveOrder: vi.fn((_id: string | null, _body: unknown) => of(order({ id: 'po_9', number: 'PO/9' }))),
		...options.gateway,
	};
	const router = { navigate: vi.fn() };
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
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
			{ provide: TranslocoService, useValue: { translate: t } },
			{ provide: QueryClient, useValue: queries },
			{ provide: AuthStore, useValue: { permissions: signal(options.permissions ?? ['setting.index']) } },
		],
	});
	TestBed.overrideComponent(OrderForm, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(OrderForm);
	fixture.detectChanges();
	return { page: fixture.componentInstance, fixture, gateway, modals, instance, router, notifier, queries };
}
const settle = async () => {
	for (let i = 0; i < 20; i++) await Promise.resolve();
};

afterEach(() => {
	suppliers.set(undefined);
	h.settings = undefined;
	h.stores = undefined;
	h.supplierQuery = null;
	h.enabled = [];
});

describe('a purchase order’s form (po02): the last cases', () => {
	it('lines from an item or a saved order line, and an estimate that skips unfinished lines', () => {
		expect(lineFromOption(option('m', { soldBy: 'metre', lastCostINR: null }), null, null)).toMatchObject({
			quantity: '',
			price: '',
		});
		expect(lineFromOption(option('m', { soldBy: 'metre' }), 15, null)).toMatchObject({
			quantity: '1.5',
			price: '8600',
		});
		expect(lineFromOrder(orderLine({ soldBy: 'metre', quantity: 25, backorderLineIds: undefined }))).toMatchObject({
			quantity: '2.5',
			backorderLineIds: [],
		});
		expect(
			orderEstimate([
				lineFromOption(option('a'), 2, 100),
				{ ...lineFromOption(option('b'), 1, 100), price: 'abc' },
				{ ...lineFromOption(option('c'), null, 100) },
			]),
		).toEqual({ linesINR: 200, gstINR: 10, totalINR: 210, rates: [5] });
	});

	it('a new order: header problems, the shop’s delivery addresses, and suppliers to pick from', () => {
		h.settings = { defaultDeliverTo: 'Warehouse · Howrah' };
		h.stores = [
			{ name: { en: 'Gariahat shop' }, address: { en: '12 Gariahat Rd' }, pinCode: '700019' },
			{ name: { en: 'Warehouse · Howrah' } },
			{ name: {}, address: {} },
		];
		const { page, fixture } = form();
		expect(h.enabled.map((enabled) => enabled())).toEqual([true, true]);
		expect(page.addressOptions()).toEqual(['Warehouse · Howrah', 'Gariahat shop · 12 Gariahat Rd · 700019']);
		expect(page.deliverTo()).toBe('Warehouse · Howrah');
		page.deliverTo.set(' ');
		page.expectedBy.set('');
		expect(page.headerProblems()).toEqual([
			'po_supplier_required',
			'po_expected_required',
			'po_deliver_to_required',
		]);
		expect(page.canSave()).toBe(false);
		expect(h.supplierQuery?.()).not.toHaveProperty('q');
		page.searchSuppliers({ search: 'tant' } as never);
		expect(h.supplierQuery?.()).toMatchObject({ q: 'tant' });
		page.searchSuppliers({ search: undefined } as never);
		suppliers.set({
			items: [
				{ id: 'sup_1', legalName: 'Tant Ghar', shortName: 'TG', active: true },
				{ id: 'sup_off', legalName: 'Old Looms', shortName: '', active: false },
			],
		});
		fixture.detectChanges();
		page.chooseSupplier({ value: 'sup_off' } as never);
		expect(page.supplierOptions().map((row) => row.label)).toEqual(['TG', 'Old Looms']);
		suppliers.set({ items: [] });
		fixture.detectChanges();
		expect(page.supplierOptions()).toEqual([{ value: 'sup_off', label: 'Old Looms' }]);
		page.chooseSupplier({ value: 'sup_off' } as never);
		page.chooseSupplier({ value: 7 } as never);
		expect(page.supplierId()).toBe('');
		page.cancel();
	});

	it('with no settings or stores to read, no delivery address is offered', () => {
		const { page, router } = form({ permissions: [] });
		expect([page.addressOptions(), page.deliverTo()]).toEqual([[], '']);
		expect(page.supplierOptions()).toEqual([]);
		page.cancel();
		expect(router.navigate).toHaveBeenCalledWith(['/purchase-orders']);
	});

	it('starts with the supplier named in the address, ignoring one it cannot find', async () => {
		const named = form({ query: { supplier: 'sup_1' } });
		await settle();
		expect([named.page.supplierId(), named.page.supplier()?.legalName]).toEqual(['sup_1', 'Tant Ghar']);
		const unknown = form({ query: { supplier: 'sup_gone' } });
		await settle();
		expect(unknown.page.supplierId()).toBe('');
	});

	it('opens a draft (even when its supplier cannot be read), a sent order on its page, and says why one cannot', async () => {
		const draft = form({ id: 'po_3', gateway: { supplier: vi.fn(() => throwError(() => new Error('gone'))) } });
		await settle();
		expect([draft.page.noteToSupplier(), draft.page.internalNote(), draft.page.lines()[0]?.quantity]).toEqual([
			'',
			'Pay on arrival',
			'6',
		]);
		expect(draft.page.supplier()).toBeNull();
		draft.page.cancel();
		expect(draft.router.navigate).toHaveBeenCalledWith(['/purchase-orders', 'po_3']);
		const sent = form({
			id: 'po_3',
			gateway: { order: vi.fn(() => of(order({ status: 'sent' }))) },
		});
		const bare = form({
			id: 'po_3',
			gateway: { order: vi.fn(() => of(order({ noteToSupplier: 'Pairs', internalNote: null }))) },
		});
		await settle();
		expect([bare.page.noteToSupplier(), bare.page.internalNote()]).toEqual(['Pairs', '']);
		expect(sent.router.navigate).toHaveBeenCalledWith(['/purchase-orders', 'po_3'], { replaceUrl: true });
		const failing = form({ id: 'po_3', gateway: { order: vi.fn(() => throwError(() => new Error('down'))) } });
		await settle();
		expect(failing.notifier.showError).toHaveBeenCalledWith('purchasing_action_failed');
		await failing.page.reload();
		await draft.page.reload();
		expect(draft.gateway.order).toHaveBeenCalledTimes(2);
	});

	it('adds an item again as one more piece or 0.1 m, and merges what the grid picks', async () => {
		const { page } = form({
			results: [
				undefined,
				[
					{ option: option('v1'), units: 4, priceINR: 9100 },
					{ option: option('v2'), units: 1, priceINR: 500 },
				],
			],
		});
		page.addOption(option('v1'));
		page.addOption(option('v1'));
		page.addOption(option('m', { soldBy: 'metre' }));
		page.addOption(option('m', { soldBy: 'metre' }));
		page.setLine(0, 'quantity', 'x');
		page.addOption(option('v1'));
		expect(page.lines().map((line) => line.quantity)).toEqual(['1', '2.0']);
		await page.openGrid(option('v1'));
		await page.openGrid(option('v1'));
		expect(page.lines().map((line) => [line.variantId, line.quantity])).toEqual([
			['v1', '4'],
			['m', '2.0'],
			['v2', '1'],
		]);
		page.setLine(2, 'price', 'abc');
		expect(page.lineProblems()).toEqual([null, null, 'payment_amount_invalid']);
		expect(page.lineValue(page.lines()[2] as never)).toBeNull();
		expect(page.lineValue(page.lines()[1] as never)).toBe(17200);
		expect(page.lineValue(page.lines()[0] as never)).toBe(36400);
		page.setLine(2, 'quantity', '1.5');
		page.setLine(1, 'quantity', '0');
		page.addOption(option('v4'));
		page.setLine(3, 'quantity', '');
		expect(page.lineProblems()).toEqual([null, 'qty_required', 'qty_whole_pieces', 'qty_required']);
		expect(page.body().lines.map((line) => [line.quantity, line.agreedPriceINR])).toEqual([
			[4, 9100],
			[0, 8600],
			[0, 0],
			[0, 8600],
		]);
		page.removeLine(3);
		expect(page.estimate().rates).toEqual([5]);
	});

	describe('saving and sending', () => {
		const ready = (page: OrderForm) => {
			page.supplierId.set('sup_1');
			page.deliverTo.set(' Shop ');
			page.addOption(option('v1'));
		};

		it('a new order saves, says so and moves to its address; a saved one saves quietly with its version', async () => {
			const { page, gateway, notifier, router, queries } = form();
			await page.save();
			expect(gateway.saveOrder).not.toHaveBeenCalled();
			ready(page);
			page.noteToSupplier.set(' Please pack in pairs ');
			expect(await page.save()).toMatchObject({ id: 'po_9' });
			expect(gateway.saveOrder).toHaveBeenCalledWith(
				null,
				expect.objectContaining({
					deliverTo: 'Shop',
					noteToSupplier: 'Please pack in pairs',
					internalNote: null,
				}),
			);
			expect(notifier.showSuccess).toHaveBeenCalledWith('po_saved:{"number":"PO/9"}');
			expect(router.navigate).toHaveBeenCalledWith(['/purchase-orders', 'po_9', 'edit'], { replaceUrl: true });
			expect([page.id(), queries.invalidateQueries.mock.calls.length]).toEqual(['po_9', 1]);
			await page.save(true);
			expect(gateway.saveOrder).toHaveBeenLastCalledWith('po_9', expect.objectContaining({ version: 2 }));
			expect(gateway.saveOrder.mock.calls[1]?.[1]).toMatchObject({
				lines: [expect.objectContaining({ lineId: 'pol_1' })],
			});
			expect(notifier.showSuccess).toHaveBeenCalledTimes(1);
			expect(router.navigate).toHaveBeenCalledTimes(1);
		});

		it('another admin saving first is shown on the form; other refusals as a message', async () => {
			const saveOrder = vi
				.fn()
				.mockReturnValueOnce(
					throwError(() => ({ status: 409, error: { issues: [{ code: 'x', message: 'Saved by Asha' }] } })),
				)
				.mockReturnValueOnce(throwError(() => new Error('down')));
			const { page, notifier } = form({ gateway: { saveOrder } });
			ready(page);
			expect(await page.save()).toBeNull();
			expect(page.conflict()).toBe('Saved by Asha');
			await page.save();
			expect(notifier.showError).toHaveBeenCalledWith('purchasing_action_failed');
			expect(page.saving()).toBe(false);
		});

		it('Send saves first when needed, then the send popup; sent goes to the order page, closed does nothing', async () => {
			const sent = order({ id: 'po_9', number: 'PO/9', status: 'sent' });
			const { page, fixture, instance, notifier, router, gateway } = form({ results: [undefined, sent] });
			await page.send();
			expect(instance.start).not.toHaveBeenCalled();
			suppliers.set({
				items: [{ id: 'sup_1', legalName: 'Tant Ghar', shortName: '', active: true, email: 'o@t.test' }],
			});
			fixture.detectChanges();
			ready(page);
			await page.send();
			expect(instance.start).toHaveBeenCalledWith(expect.objectContaining({ id: 'po_9' }), 'o@t.test');
			expect(router.navigate).not.toHaveBeenCalledWith(['/purchase-orders', 'po_9']);
			page.supplierId.set('sup_x');
			page.dirty.set(false);
			await page.send();
			expect(gateway.saveOrder).toHaveBeenCalledTimes(1);
			expect(instance.start).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'po_9' }), null);
			expect(notifier.showSuccess).toHaveBeenCalledWith('po_sent:{"number":"PO/9"}');
			expect(router.navigate).toHaveBeenLastCalledWith(['/purchase-orders', 'po_9']);
		});
	});
});
