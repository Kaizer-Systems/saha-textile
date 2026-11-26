import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { TRANSFER_CHIPS as CONTRACT_CHIPS } from '@saha-textile/contracts';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';
import { AuthStore } from '@core/state/auth.store';
import { TransfersGateway, transferProblemKey } from '@core/transfers/transfers.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { RequestPopup } from './request-popup';
import { STOCK_CHIPS, StockByLocationPage } from './stock-by-location';
import { quantityText, TRANSFER_CHIPS } from './transfer-format';
import { TransferPage } from './transfer-page';
import { TransfersListPage } from './transfers-list';
import transferRoutes from './transfers.routes';

/** Stock transfers in the admin (accounts brief N1–N6). */

const opened: Blob[] = [];
vi.mock('@core/purchasing/purchasing-format', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing-format')>()),
	openPdf: (blob: Blob) => void opened.push(blob),
}));
afterEach(() => {
	opened.length = 0;
});

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};

function mount<T>(
	component: Type<T>,
	gateway: Record<string, unknown>,
	options: { id?: string; answers?: unknown[]; permissions?: string[] } = {},
) {
	const queue = [...(options.answers ?? [])];
	const instance = { start: vi.fn() };
	const modals = {
		open: vi.fn(() => {
			const answer = queue.shift();
			return {
				componentInstance: instance,
				result: answer === undefined ? Promise.reject(new Error('closed')) : Promise.resolve(answer),
			};
		}),
	};
	const router = { navigate: vi.fn(async () => true) };
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			component,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient()),
			{ provide: TransfersGateway, useValue: gateway },
			{ provide: NgbModal, useValue: modals },
			{ provide: NgbActiveModal, useValue: { close: vi.fn(), dismiss: vi.fn() } },
			{ provide: NotificationService, useValue: notifier },
			{ provide: Router, useValue: router },
			{
				provide: AuthStore,
				useValue: {
					permissions: signal(
						options.permissions ?? ['transfer.create', 'transfer.manage', 'transfer.index'],
					),
				},
			},
			{
				provide: ActivatedRoute,
				useValue: { paramMap: of(convertToParamMap(options.id ? { id: options.id } : {})) },
			},
		],
	});
	const fixture = TestBed.createComponent(component);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, modals, instance, router, notifier };
}

const line = (id: string, patch: Record<string, unknown> = {}) => ({
	lineId: id,
	variantId: `v_${id}`,
	productId: `p_${id}`,
	sku: id.toUpperCase(),
	title: `Item ${id}`,
	hsn: '5007',
	soldBy: 'piece',
	quantity: 2,
	packed: 0,
	arrived: null,
	damaged: null,
	note: '',
	drawn: [],
	valueINR: null,
	holdId: null,
	...patch,
});
const view = (patch: Record<string, unknown> = {}) => ({
	id: 'tr1',
	number: 'TR/26-27/000018',
	status: 'packing',
	fromLocationId: 'loc_bar',
	toLocationId: 'loc_gar',
	fromName: 'Barasat',
	toName: 'Gariahat',
	pieces: 4,
	lines: [line('a'), line('m', { soldBy: 'metre', quantity: 20 })],
	neededBy: null,
	forOrderId: null,
	forOrderNumber: null,
	note: 'Customer waiting',
	crossGstin: false,
	sealNumber: '',
	boxes: null,
	photoAssetIds: ['ast_0'],
	vehicle: '',
	ewayBillNumber: null,
	challanNumber: null,
	branchInvoice: null,
	valueINR: 0,
	short: null,
	rejectReason: null,
	voucherIds: [],
	timeline: [{ status: 'requested', at: '2026-11-21T05:00:00.000Z', by: 'u', byName: null }],
	requestedBy: 'u',
	version: 1,
	createdAt: '2026-11-21T05:00:00.000Z',
	updatedAt: '2026-11-21T05:00:00.000Z',
	may: { decide: false, pack: true, receive: false, cancel: true },
	ewayBillFromINR: 50_000,
	estimatedValueINR: 46_200,
	...patch,
});

describe('the transfers list (N3)', () => {
	it('lists by chip and period with each row’s route, value and document, and opens a row', async () => {
		const rows = [
			view({ status: 'in_transit', valueINR: 46_200, challanNumber: 'DC/26-27/000031' }),
			view({ id: 'tr2', status: 'requested', valueINR: 0 }),
			view({ id: 'tr3', status: 'received', valueINR: 10, branchInvoice: { number: 'TI/26-27/000300' } }),
		];
		const gateway = { list: vi.fn(() => of({ items: rows, total: 3, counts: { all: 3, requested: 1 } })) };
		const { fixture, page, router } = mount(TransfersListPage, gateway);
		await settle(fixture);
		const data = page.tableConfig().data;
		expect(data.map((r) => [r['routeText'], r['valueText'], r['documentText']])).toEqual([
			['Barasat → Gariahat', '₹46,200', 'DC/26-27/000031'],
			['Barasat → Gariahat', '—', '—'],
			['Barasat → Gariahat', '₹10', 'TI/26-27/000300'],
		]);
		page.setChip('in_transit');
		page.setPeriod({ period: 'last_month' } as never);
		page.onTableChange({ search: ' DC ', page: 2, paginate: 500 });
		await settle(fixture);
		expect(gateway.list).toHaveBeenLastCalledWith(
			expect.objectContaining({ chip: 'in_transit', search: 'DC', page: 2, pageSize: 100 }),
		);
		page.onTableChange(undefined);
		expect(page.query()).toMatchObject({ page: 1, pageSize: 30 });
		page.onAction({ actionToPerform: 'view', data: data[0] } as never);
		page.onAction({ actionToPerform: 'other', data: data[0] } as never);
		page.onAction({ actionToPerform: 'view' } as never);
		expect(router.navigate).toHaveBeenCalledTimes(1);
		expect(router.navigate).toHaveBeenCalledWith(['/transfers', 'tr1']);
		const empty = mount(TransfersListPage, { list: vi.fn(() => of(undefined)) });
		expect(empty.page.tableConfig().total).toBe(0);
	});
});

describe('stock by location (N1) and a request (N2)', () => {
	const stock = {
		here: 'loc_gar',
		locations: [
			{ id: 'loc_gar', name: 'Gariahat' },
			{ id: 'loc_bar', name: 'Barasat' },
		],
		items: [
			{
				variantId: 'v_kan',
				productId: 'p_kan',
				sku: 'KAN',
				title: 'Kanchipuram',
				soldBy: 'piece',
				byLocation: { loc_gar: { onHand: 0, free: 0 }, loc_bar: { onHand: 3, free: 2 } },
				inTransit: 1,
				total: 4,
			},
			{
				variantId: 'v_mul',
				productId: 'p_mul',
				sku: 'MUL',
				title: 'Mulmul',
				soldBy: 'metre',
				byLocation: { loc_bar: { onHand: 425, free: 400 } },
				inTransit: 0,
				total: 425,
			},
		],
		total: 60,
	};

	it('shows each location’s stock, the chip’s first, pages and filters, and asks for stock from a row or the header', async () => {
		const gateway = { stock: vi.fn(() => of(stock)) };
		const { fixture, page, modals, instance } = mount(StockByLocationPage, gateway, { answers: [{ id: 'tr9' }] });
		await page.request(null);
		expect(modals.open).not.toHaveBeenCalled();
		await settle(fixture);
		const text = fixture.nativeElement.textContent as string;
		expect(text).toContain('tr_you');
		expect(text).toContain('42.5 m');
		page.setChip('low');
		page.find('kan');
		await settle(fixture);
		expect(gateway.stock).toHaveBeenLastCalledWith({ chip: 'low', page: 1, pageSize: 25, search: 'kan' });
		(fixture.nativeElement.querySelector('#tr_request_any') as HTMLButtonElement).click();
		await settle(fixture);
		expect(instance.start).toHaveBeenCalledWith({ view: stock, item: null });
		await page.request(stock.items[0] as never);
		expect(instance.start).toHaveBeenLastCalledWith({ view: stock, item: stock.items[0] });
		expect(page.text(15, 'metre')).toBe('1.5 m');
		expect(STOCK_CHIPS).toEqual(['all', 'low', 'out']);
		const none = mount(StockByLocationPage, { stock: vi.fn(() => of({ ...stock, items: [], total: 0 })) });
		await settle(none.fixture);
		expect(none.fixture.nativeElement.textContent).toContain('tr_stock_none');
	});

	it('picks the item, the location for it and the one with most free, and sends the request', async () => {
		const request = vi.fn(() => of({ id: 'tr9' }));
		const { fixture, page } = mount(RequestPopup, { request });
		const modal = TestBed.inject(NgbActiveModal) as unknown as { close: ReturnType<typeof vi.fn> };
		expect(page.sources()).toEqual([]);
		expect(page.text(3)).toBe('3');
		page.start({ view: stock as never, item: stock.items[1] as never });
		fixture.detectChanges();
		expect([page.variantId(), page.to(), page.from(), page.quantity()]).toEqual([
			'v_mul',
			'loc_gar',
			'loc_bar',
			10,
		]);
		expect(page.sources()).toEqual([{ id: 'loc_bar', name: 'Barasat', free: 400 }]);
		expect(page.text(15)).toBe('1.5 m');
		page.variantId.set('v_kan');
		page.quantity.set(2);
		page.neededBy.set('2026-11-25');
		page.note.set(' For Siliguri ');
		fixture.detectChanges();
		(fixture.nativeElement.querySelector('#tr_send') as HTMLButtonElement).click();
		await settle(fixture);
		expect(request).toHaveBeenCalledWith({
			fromLocationId: 'loc_bar',
			toLocationId: 'loc_gar',
			lines: [{ variantId: 'v_kan', quantity: 2 }],
			neededBy: '2026-11-25',
			forOrderId: null,
			note: 'For Siliguri',
		});
		expect(modal.close).toHaveBeenCalledWith({ id: 'tr9' });
	});

	it('waits for a sender, takes the first item from the header, and keeps a refusal in words', async () => {
		const refused = vi.fn(() => throwError(() => ({ error: { message: 'transfer_not_enough_stock:KAN' } })));
		const { page } = mount(RequestPopup, { request: refused });
		page.start({ view: { ...stock, here: null } as never, item: null });
		expect([page.variantId(), page.to()]).toEqual(['v_kan', '']);
		expect(page.ready()).toBe(false);
		await page.send();
		expect(refused).not.toHaveBeenCalled();
		page.to.set('loc_gar');
		page.from.set('loc_bar');
		await page.send();
		expect(page.problem()).toEqual({ key: 'tr_problem_transfer_not_enough_stock', params: { sku: 'KAN' } });
		page.neededBy.set('');
		const empty = mount(RequestPopup, { request: refused });
		empty.page.start({ view: { ...stock, here: 'loc_gar', items: [] } as never, item: null });
		expect([empty.page.variantId(), empty.page.from()]).toEqual(['', '']);
		const lone = mount(RequestPopup, { request: refused });
		lone.page.start({
			view: {
				...stock,
				here: 'loc_gar',
				locations: [
					{ id: 'loc_gar', name: 'G' },
					{ id: 'loc_x', name: 'X' },
				],
			} as never,
			item: null,
		});
		expect(lone.page.sources()).toEqual([{ id: 'loc_x', name: 'X', free: 0 }]);
	});
});

describe('a transfer’s page (N4–N6)', () => {
	const gatewayFor = (t: Record<string, unknown>, patch: Record<string, unknown> = {}) => ({
		one: vi.fn(() => of(t)),
		decide: vi.fn(() => of({})),
		cancel: vi.fn(() => of({})),
		pack: vi.fn(() => of({})),
		receive: vi.fn(() => of({})),
		print: vi.fn(() => of(new Blob(['%PDF']))),
		...patch,
	});

	it('packs by tick or scan, needs the seal and the e-way bill above the threshold, then dispatches', async () => {
		const t = view();
		const gateway = gatewayFor(t);
		const { fixture, page, modals, instance, notifier } = mount(TransferPage, gateway, {
			id: 'tr1',
			answers: [
				[{ assetId: 'ast_0' }, { assetId: 'ast_1', name: 'box.jpg' }],
				[{ assetId: 'ast_1' }, { assetId: 'ast_2' }],
				undefined,
			],
		});
		await settle(fixture);
		expect(page.canDispatch()).toBe(false);
		page.scanCode.set('a');
		page.scan(t as never);
		page.scanCode.set('A');
		page.scan(t as never);
		page.scanCode.set('A');
		page.scan(t as never);
		page.scanCode.set('M');
		page.scan(t as never);
		page.scanCode.set('nope');
		page.scan(t as never);
		expect(page.problem()).toEqual({ key: 'counter_problem_counter_code_unknown', params: {} });
		page.setPacked('m', 'x' as never, 20);
		page.setPacked('m', 50, 20);
		expect([page.packedOf(t.lines[0] as never), page.packedOf(t.lines[1] as never)]).toEqual([2, 20]);
		page.sealEdit.set('S-55120');
		fixture.detectChanges();
		expect(page.checks().map((c) => c.ok)).toEqual([true, true, true]);
		await page.addPhoto();
		await page.addPhoto();
		await page.addPhoto();
		expect(instance.start).toHaveBeenCalledWith(expect.objectContaining({ title: 'tr_photo', accept: 'image' }));
		expect(page.photos().map((p) => p.assetId)).toEqual(['ast_0', 'ast_1', 'ast_2']);
		expect(modals.open).toHaveBeenCalledTimes(3);
		page.vehicleEdit.set(' WB 02 AB 1234 ');
		page.boxesEdit.set(2);
		page.ewayEdit.set('');
		fixture.detectChanges();
		(fixture.nativeElement.querySelector('#tr_dispatch') as HTMLButtonElement).click();
		await settle(fixture);
		expect(gateway.pack).toHaveBeenCalledWith('tr1', {
			lines: [
				{ lineId: 'a', packed: 2 },
				{ lineId: 'm', packed: 20 },
			],
			sealNumber: 'S-55120',
			boxes: 2,
			photoAssetIds: ['ast_0', 'ast_0', 'ast_1', 'ast_2'],
			vehicle: 'WB 02 AB 1234',
			ewayBillNumber: '',
			version: 1,
			dispatch: true,
		});
		expect(notifier.showSuccess).toHaveBeenCalledWith('tr_done_dispatched');
		await page.pack(t as never, false);
		expect(notifier.showSuccess).toHaveBeenLastCalledWith('tr_done_saved');
		expect([page.boxesOf(view() as never), page.sealOf(view({ sealNumber: 'S-9' }) as never)]).toEqual([
			2,
			'S-55120',
		]);
		page.boxesEdit.set(undefined);
		page.sealEdit.set(null);
		page.ewayEdit.set(null);
		page.vehicleEdit.set(null);
		expect([
			page.boxesOf(view({ boxes: 3 }) as never),
			page.sealOf(view({ sealNumber: 'S-9' }) as never),
			page.ewayOf(view({ ewayBillNumber: '1' }) as never),
			page.vehicleOf(view({ vehicle: 'V' }) as never),
		]).toEqual([3, 'S-9', '1', 'V']);
		const big = gatewayFor(view({ estimatedValueINR: 60_000, ewayBillNumber: null }));
		const heavy = mount(TransferPage, big, { id: 'tr1' });
		await settle(heavy.fixture);
		heavy.page.sealEdit.set('S-1');
		heavy.page.setPacked('a', 2, 2);
		heavy.page.setPacked('m', 20, 20);
		expect(heavy.page.checks()[2]).toMatchObject({ key: 'tr_check_eway', ok: false });
		heavy.page.ewayEdit.set('341012345678');
		expect(heavy.page.canDispatch()).toBe(true);
	});

	it('approves, rejects or cancels with a reason, and keeps a refusal in words', async () => {
		const asked = view({ status: 'requested', may: { decide: true, pack: false, receive: false, cancel: true } });
		const gateway = gatewayFor(asked, {
			cancel: vi.fn(() => throwError(() => ({ error: { message: 'transfer_already_left' } }))),
		});
		const { fixture, page } = mount(TransferPage, gateway, { id: 'tr1' });
		await settle(fixture);
		(fixture.nativeElement.querySelector('#tr_approve') as HTMLButtonElement).click();
		await settle(fixture);
		expect(gateway.decide).toHaveBeenCalledWith('tr1', { approve: true, reason: '', version: 1 });
		(fixture.nativeElement.querySelector('#tr_reject') as HTMLButtonElement).click();
		fixture.detectChanges();
		page.reason.set(' Needed here ');
		fixture.detectChanges();
		(fixture.nativeElement.querySelector('#tr_confirm_reason') as HTMLButtonElement).click();
		await settle(fixture);
		expect(gateway.decide).toHaveBeenLastCalledWith('tr1', { approve: false, reason: 'Needed here', version: 1 });
		expect(page.asking()).toBeNull();
		(fixture.nativeElement.querySelector('#tr_cancel') as HTMLButtonElement).click();
		fixture.detectChanges();
		page.reason.set('Order cancelled');
		fixture.detectChanges();
		(fixture.nativeElement.querySelector('#tr_confirm_reason') as HTMLButtonElement).click();
		await settle(fixture);
		expect(page.problem()).toEqual({ key: 'tr_problem_transfer_already_left', params: {} });
		expect(page.asking()).toBe('cancel');
	});

	it('counts what arrived, needs a reason for short and damaged pieces, and receives', async () => {
		const moving = view({
			status: 'in_transit',
			challanNumber: 'DC/26-27/000031',
			valueINR: 46_200,
			may: { decide: false, pack: false, receive: true, cancel: false },
			lines: [line('a', { packed: 2 }), line('b', { packed: 2 })],
		});
		const gateway = gatewayFor(moving);
		const { fixture, page } = mount(TransferPage, gateway, { id: 'tr1' });
		await settle(fixture);
		const [a, b] = moving.lines as never[];
		expect([page.shortPieces(), page.damagedPieces()]).toEqual([0, 0]);
		page.setCount(a, 'arrived', 1);
		page.setCount(a, 'damaged', 5);
		page.setCount(b, 'damaged', 2);
		page.setCount(b, 'arrived', 1);
		page.setCount(b, 'arrived', 'x' as never);
		page.setNote(a, 'one stained');
		page.short.set('transit_loss');
		fixture.detectChanges();
		expect([page.shortPieces(), page.damagedPieces()]).toEqual([3, 1]);
		expect(fixture.nativeElement.textContent).toContain('tr_receive_warning');
		(fixture.nativeElement.querySelector('#tr_receive') as HTMLButtonElement).click();
		await settle(fixture);
		expect(gateway.receive).toHaveBeenCalledWith('tr1', {
			lines: [
				{ lineId: 'a', arrived: 1, damaged: 1, note: 'one stained' },
				{ lineId: 'b', arrived: 0, damaged: 0, note: '' },
			],
			short: 'transit_loss',
			version: 1,
		});
		(fixture.nativeElement.querySelector('#tr_print') as HTMLButtonElement).click();
		await settle(fixture);
		expect(opened).toHaveLength(1);
	});

	it('shows a finished transfer’s steps, values and documents, and says when the print fails', async () => {
		const done = view({
			status: 'rejected',
			rejectReason: 'Needed here',
			crossGstin: true,
			branchInvoice: { number: 'TI/26-27/000300' },
			sealNumber: 'S-1',
			may: { decide: false, pack: false, receive: false, cancel: false },
			lines: [line('a', { arrived: 2, valueINR: 8_200 }), line('b')],
		});
		const gateway = gatewayFor(done, {
			print: vi.fn(() => throwError(() => ({ error: { message: 'transfer_not_dispatched' } }))),
		});
		const { fixture, page } = mount(TransferPage, gateway, { id: 'tr1' });
		await settle(fixture);
		const text = fixture.nativeElement.textContent as string;
		expect(text).toContain('Needed here');
		expect(text).toContain('TI/26-27/000300');
		expect(text).toContain('₹8,200');
		expect(page.stepAt(done as never, 'requested')).toBe('21 Nov 2026');
		expect(page.stepAt(done as never, 'received')).toBeNull();
		expect([page.text(null, 'piece'), page.date(null)]).toEqual(['—', '—']);
		await page.print(done as never);
		expect(page.problem()).toEqual({ key: 'cash_failed', params: { code: 'transfer_not_dispatched' } });
		const nothing = mount(TransferPage, gatewayFor(done));
		expect([
			nothing.page.checks(),
			nothing.page.shortPieces(),
			nothing.page.damagedPieces(),
			nothing.page.canDispatch(),
		]).toEqual([[], 0, 0, false]);
	});
});

describe('the transfers gateway, words and routes', () => {
	it('calls each transfer route', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(TransfersGateway);
		const http = TestBed.inject(HttpTestingController);
		const api = `${runtimeConfig.apiUrl}/admin/transfers`;
		const calls: [() => unknown, string, string][] = [
			[() => gateway.stock({ chip: 'low' }), 'GET', '/stock?chip=low'],
			[() => gateway.list({ chip: 'all' }), 'GET', '?chip=all'],
			[() => gateway.one('tr/1'), 'GET', '/tr%2F1'],
			[() => gateway.request({} as never), 'POST', ''],
			[() => gateway.decide('t', {} as never), 'POST', '/t/decide'],
			[() => gateway.pack('t', {} as never), 'POST', '/t/pack'],
			[() => gateway.receive('t', {} as never), 'POST', '/t/receive'],
			[() => gateway.cancel('t', {} as never), 'POST', '/t/cancel'],
			[() => gateway.print('t'), 'GET', '/t/print'],
		];
		for (const [call, method, path] of calls) {
			(call() as { subscribe: () => void }).subscribe();
			http.expectOne((req) => req.method === method && req.urlWithParams === api + path).flush(
				path.endsWith('print') ? new Blob() : {},
			);
		}
		http.verify();
	});

	it('words each refusal, naming the SKU or what keeps Dispatch off', () => {
		expect(transferProblemKey('transfer_same_location')).toEqual({
			key: 'tr_problem_transfer_same_location',
			params: {},
		});
		expect(transferProblemKey('location_out_of_scope')).toEqual({
			key: 'cash_problem_location_out_of_scope',
			params: {},
		});
		expect(transferProblemKey('transfer_cannot_dispatch:seal_missing')).toEqual({
			key: 'tr_problem_cannot_dispatch',
			params: { what: 'seal_missing' },
		});
		for (const code of [
			'transfer_not_enough_stock',
			'cost_layers_missing',
			'transfer_hsn_missing',
			'transfer_hsn_rate_missing',
			'transfer_count_missing',
			'transfer_count_wrong',
		])
			expect(transferProblemKey(`${code}:KAN`)).toEqual({ key: `tr_problem_${code}`, params: { sku: 'KAN' } });
		expect(transferProblemKey('voucher_problem:role_not_mapped:transit_loss')).toEqual({
			key: 'cash_problem_role',
			params: { role: 'transit_loss' },
		});
		expect(transferProblemKey('voucher_problem:role_not_mapped')).toEqual({
			key: 'cash_problem_role',
			params: { role: '' },
		});
		expect(transferProblemKey('boom')).toEqual({ key: 'cash_failed', params: { code: 'boom' } });
	});

	it('keeps the chips equal to the contract’s, words quantities, and lazy-loads every page', async () => {
		expect([...TRANSFER_CHIPS]).toEqual([...CONTRACT_CHIPS]);
		expect([quantityText(25, 'metre'), quantityText(3, 'piece')]).toEqual(['2.5 m', '3']);
		const pages = await Promise.all(transferRoutes.map((route) => route.loadComponent()));
		expect(pages).toHaveLength(3);
	});
});
