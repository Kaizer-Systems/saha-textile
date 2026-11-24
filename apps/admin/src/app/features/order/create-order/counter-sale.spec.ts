import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';
import { CounterGateway, counterProblemKey } from '@core/counter/counter.gateway';
import { OrdersGateway } from '@core/orders/orders.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { CounterPayment, rupeesTyped, type CounterPaymentStart } from './counter-payment';
import { ADDRESS_NEEDED_FROM_INR, CounterSale, counterWrites } from './counter-sale';

import type { AdminProductCard } from '@saha-textile/contracts';

/** Counter mode in Create order (accounts brief P1) and its Take payment popup (P2). */

const opened: Blob[] = [];
vi.mock('@core/purchasing/purchasing-format', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing-format')>()),
	openPdf: (blob: Blob) => void opened.push(blob),
}));

afterEach(() => {
	opened.length = 0;
});

const GAR = { locationId: 'loc_gar', name: 'Gariahat store', place: 'Kolkata, West Bengal', sheetOpen: true };
const BAR = { locationId: 'loc_bar', name: 'Barasat store', place: 'Barasat, West Bengal', sheetOpen: false };
const priced = (sku: string, price: number, problem: string | null = null) => ({
	lineId: sku,
	productId: `p_${sku}`,
	title: sku,
	sku,
	unitPriceINR: price,
	lineTotalINR: price,
	children: [],
	problem,
});
const card = (patch: Partial<AdminProductCard> = {}): AdminProductCard =>
	({
		productId: 'p_tnt',
		title: 'Tant',
		imageUrl: null,
		categoryIds: [],
		hasVariants: false,
		soldBy: 'piece',
		shortestCutTenths: null,
		stock: 3,
		retailINR: 1250,
		price: 1250,
		zonePrice: null,
		isBundle: false,
		setsPossible: null,
		...patch,
	}) as AdminProductCard;

function setup(
	options: {
		permissions?: string[];
		stores?: (typeof GAR)[];
		current?: string | null;
		quote?: (write: { lines: unknown[] }) => unknown;
		answers?: unknown[];
		scan?: (code: string) => unknown;
		customers?: () => unknown;
		print?: () => unknown;
	} = {},
) {
	const queue = [...(options.answers ?? [])];
	const instance = { start: vi.fn(async () => undefined) };
	const modals = {
		open: vi.fn(() => {
			const answer = queue.shift();
			return {
				componentInstance: instance,
				result: answer === undefined ? Promise.reject(new Error('dismissed')) : Promise.resolve(answer),
			};
		}),
	};
	const gateway = {
		here: vi.fn(() => of({ current: options.current ?? null, stores: options.stores ?? [GAR] })),
		scan: vi.fn((code: string) =>
			options.scan
				? (options.scan(code) as never)
				: code === 'TNT-WHT'
					? of({ productId: 'p_tnt', variationId: 'v_wht', sku: 'TNT-WHT', title: 'Tant', soldBy: 'piece' })
					: code === 'HLC'
						? of({ productId: 'p_hlc', variationId: null, sku: 'HLC', title: 'Handloom', soldBy: 'metre' })
						: throwError(() => new Error('counter_code_unknown')),
		),
		quote: vi.fn((write: { lines: unknown[] }) =>
			of(
				options.quote
					? options.quote(write)
					: {
							lines: write.lines.map((_l, i) => priced(`S${i}`, 1000)),
							taxableINR: 952.38 * write.lines.length,
							cgstINR: 23.81 * write.lines.length,
							sgstINR: 23.81 * write.lines.length,
							totalINR: 1000 * write.lines.length,
							problems: [],
						},
			),
		),
		print: vi.fn(() => (options.print ? (options.print() as never) : of(new Blob(['%PDF'])))),
	};
	const orders = {
		cards: vi.fn(() => of({ items: [card()], total: 1 })),
		searchCustomers: vi.fn(() =>
			options.customers
				? (options.customers() as never)
				: of([
						{ id: 'c0', name: 'Other', phone: null, email: null, addressCount: 0 },
						{ id: 'c1', name: 'Shreya Ghosh', phone: '+91 98311 22334', email: null, addressCount: 0 },
					]),
		),
	};
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			CounterSale,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient()),
			{ provide: CounterGateway, useValue: gateway },
			{ provide: OrdersGateway, useValue: orders },
			{ provide: NgbModal, useValue: modals },
			{ provide: NotificationService, useValue: notifier },
			{ provide: AuthStore, useValue: { permissions: signal(options.permissions ?? ['cash.count']) } },
		],
	});
	const fixture = TestBed.createComponent(CounterSale);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, gateway, orders, modals, notifier, instance };
}

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};

describe('counter mode is offered at a store (P1)', () => {
	it('stays hidden without the counter permission or a store with a till', async () => {
		const none = setup({ permissions: [] });
		await settle(none.fixture);
		expect(none.gateway.here).not.toHaveBeenCalled();
		expect(none.page.stores()).toEqual([]);
		const noStore = setup({ stores: [] });
		await settle(noStore.fixture);
		expect(noStore.fixture.nativeElement.textContent.trim()).toBe('');
	});

	it('switches on and off, telling Create order, at the one store or the chip’s, or the one picked', async () => {
		const { fixture, page } = setup();
		await settle(fixture);
		expect(page.store()).toEqual(GAR);
		const told: boolean[] = [];
		page.active.subscribe((on) => told.push(on));
		(fixture.nativeElement.querySelector('#counter_on') as HTMLInputElement).dispatchEvent(new Event('change'));
		await settle(fixture);
		expect(page.on()).toBe(true);
		expect(fixture.nativeElement.querySelector('#counter_store')).toBeNull();
		(fixture.nativeElement.querySelector('#counter_off') as HTMLInputElement).dispatchEvent(new Event('change'));
		expect(told).toEqual([true, false]);

		const two = setup({ stores: [GAR, BAR] });
		await settle(two.fixture);
		two.page.toggle(true);
		await settle(two.fixture);
		expect(two.page.store()).toBeNull();
		const select = two.fixture.nativeElement.querySelector('#counter_store') as HTMLSelectElement;
		select.value = 'loc_bar';
		select.dispatchEvent(new Event('change'));
		await settle(two.fixture);
		expect(two.page.store()).toEqual(BAR);
		expect(two.fixture.nativeElement.textContent).toContain('counter_sheet_not_open');
		select.value = '';
		select.dispatchEvent(new Event('change'));
		expect(two.page.picked()).toBeNull();

		const chip = setup({ stores: [GAR, BAR], current: 'loc_bar' });
		await settle(chip.fixture);
		expect(chip.page.store()).toEqual(BAR);
	});
});

describe('the counter’s bill (P1)', () => {
	it('adds a scanned SKU, again to the same line, fabric by the metre, and searches what isn’t a SKU', async () => {
		const { fixture, page, orders } = setup();
		await settle(fixture);
		page.toggle(true);
		await page.scan();
		page.code.set('TNT-WHT');
		await page.scan();
		page.code.set(' TNT-WHT ');
		await page.scan();
		page.code.set('HLC');
		await page.scan();
		expect(page.lines().map((l) => [l.productId, l.variationId, l.quantity, l.scanned])).toEqual([
			['p_tnt', 'v_wht', 2, true],
			['p_hlc', null, 10, true],
		]);
		expect(page.code()).toBe('');
		page.code.set('tant');
		await settle(fixture);
		const input = fixture.nativeElement.querySelector('#counter_scan') as HTMLInputElement;
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
		await settle(fixture);
		expect(page.search()).toBe('tant');
		expect(orders.cards).toHaveBeenCalledWith({ q: 'tant', page: 1, pageSize: 12, currency: 'INR' });
		expect(fixture.nativeElement.textContent).toContain('counter_found');
		expect(page.quantityWords(page.lines()[0]!)).toBe('2');
		expect(page.quantityWords(page.lines()[1]!)).toBe('ord_metres');
	});

	it('changes and removes lines, and shows no cards when a search finds none', async () => {
		const { fixture, page, orders } = setup();
		orders.cards.mockReturnValue(of({ items: [], total: 0 }));
		await settle(fixture);
		page.toggle(true);
		page.addLine({ productId: 'p_a', variationId: null, soldBy: 'piece', scanned: false });
		page.addLine({ productId: 'p_b', variationId: null, soldBy: 'piece', scanned: false });
		const [a, b] = page.lines();
		page.change(a!.key, 1);
		page.change(b!.key, -1);
		expect(page.lines().map((l) => l.quantity)).toEqual([2]);
		page.remove(a!.key);
		expect(page.lines()).toEqual([]);
		page.search.set('nothing');
		await settle(fixture);
		expect(fixture.nativeElement.querySelector('app-no-data')).not.toBeNull();
	});

	it('adds from a card: a plain piece, a variant picked, a set configured, and nothing when a popup is closed', async () => {
		const bundle = { levels: [] };
		const { fixture, page, instance } = setup({
			answers: [{ variationId: 'v_red' }, undefined, bundle, undefined],
		});
		await settle(fixture);
		await page.add(card({ soldBy: 'metre' }));
		await page.add(card({ hasVariants: true }));
		await page.add(card({ hasVariants: true, productId: 'p_x' }));
		await page.add(card({ isBundle: true, productId: 'p_set' }));
		await page.add(card({ isBundle: true, productId: 'p_set2' }));
		expect(instance.start).toHaveBeenCalledTimes(4);
		expect(page.lines().map((l) => [l.productId, l.variationId, l.quantity, !!l.bundle])).toEqual([
			['p_tnt', null, 10, false],
			['p_tnt', 'v_red', 1, false],
			['p_set', null, 1, true],
		]);
		// A set is always its own line.
		page.addLine({
			productId: 'p_set',
			variationId: null,
			soldBy: 'piece',
			scanned: false,
			bundle: bundle as never,
		});
		expect(page.lines()).toHaveLength(4);
		expect(counterWrites(page.lines()).at(-1)).toMatchObject({ productId: 'p_set', bundle });
	});

	it('prices the bill with its tax, and lets payment start only for lines the invoice can take', async () => {
		const quote = vi.fn((write: { lines: unknown[] }) => ({
			lines: write.lines.map((_l, i) => priced(`S${i}`, 30_000, i === 1 ? 'limited' : null)),
			taxableINR: 0,
			cgstINR: 0,
			sgstINR: 0,
			totalINR: 30_000 * write.lines.length,
			problems: [],
		}));
		const { fixture, page } = setup({ quote });
		await settle(fixture);
		expect(page.total()).toBe(0);
		page.toggle(true);
		page.addLine({ productId: 'p_a', variationId: null, soldBy: 'piece', scanned: true });
		await settle(fixture);
		expect(page.total()).toBe(30_000);
		expect(page.rows()[0]?.priced?.sku).toBe('S0');
		expect(page.canPay()).toBe(true);
		page.gstin.set('19AAAAA0000A1Z5');
		expect(page.addressNeeded()).toBe(true);
		expect(page.canPay()).toBe(false);
		page.address.set('5 Lake Rd');
		expect(page.canPay()).toBe(true);
		page.gstin.set('');
		page.addLine({ productId: 'p_b', variationId: null, soldBy: 'piece', scanned: false });
		await settle(fixture);
		expect(page.total()).toBeGreaterThanOrEqual(ADDRESS_NEEDED_FROM_INR);
		expect(page.addressNeeded()).toBe(true);
		expect(fixture.nativeElement.textContent).toContain('counter_scanned');
	});

	it('holds payment back for a line that can’t be sold, a line the invoice can’t take, or prices still coming', async () => {
		const blocked = setup({
			quote: (write) => ({
				lines: write.lines.map(() => priced('X', 100, 'out_of_stock')),
				taxableINR: 0,
				cgstINR: 0,
				sgstINR: 0,
				totalINR: 100,
				problems: [],
			}),
		});
		await settle(blocked.fixture);
		blocked.page.toggle(true);
		blocked.page.addLine({ productId: 'p_a', variationId: null, soldBy: 'piece', scanned: false });
		await settle(blocked.fixture);
		expect(blocked.page.canPay()).toBe(false);
		expect(blocked.fixture.nativeElement.textContent).toContain('ord_cart_problem_out_of_stock');

		const noHsn = setup({
			quote: () => ({
				lines: [priced('X', 100)],
				taxableINR: 0,
				cgstINR: 0,
				sgstINR: 0,
				totalINR: 100,
				problems: [{ sku: 'X', problem: 'hsn_missing' }],
			}),
		});
		await settle(noHsn.fixture);
		noHsn.page.toggle(true);
		noHsn.page.addLine({ productId: 'p_a', variationId: null, soldBy: 'piece', scanned: false });
		await settle(noHsn.fixture);
		expect(noHsn.page.canPay()).toBe(false);
		expect(noHsn.fixture.nativeElement.textContent).toContain('counter_problem_invoice_hsn_missing');

		const short = setup({
			quote: () => ({ lines: [], taxableINR: 0, cgstINR: 0, sgstINR: 0, totalINR: 0, problems: [] }),
		});
		await settle(short.fixture);
		short.page.toggle(true);
		short.page.addLine({ productId: 'p_a', variationId: null, soldBy: 'piece', scanned: false });
		await settle(short.fixture);
		expect(short.page.rows()[0]?.priced).toBeNull();
		expect(short.page.canPay()).toBe(false);
		expect(setup({ stores: [GAR, BAR] }).page.canPay()).toBe(false);
	});
});

describe('the customer at the counter (P1)', () => {
	it('fills the name of a past customer found by phone, only when the name is still empty', async () => {
		const { fixture, page, orders } = setup();
		await settle(fixture);
		page.phone.set('98311');
		await page.lookUp();
		expect(orders.searchCustomers).not.toHaveBeenCalled();
		page.phone.set('+91 98311 22334');
		await page.lookUp();
		expect(orders.searchCustomers).toHaveBeenCalledWith('9831122334');
		expect(page.name()).toBe('Shreya Ghosh');
		await page.lookUp();
		expect(orders.searchCustomers).toHaveBeenCalledTimes(1);

		const nobody = setup({ customers: () => of([]) });
		nobody.page.phone.set('9000000000');
		await nobody.page.lookUp();
		expect(nobody.page.name()).toBe('');
		const down = setup({ customers: () => throwError(() => new Error('down')) });
		down.page.phone.set('9000000000');
		await expect(down.page.lookUp()).resolves.toBeUndefined();
	});
});

describe('taking payment from the counter (P2)', () => {
	const sold = {
		orderId: 'ord_1',
		orderNumber: 'ST-1',
		invoiceId: 'ti_1',
		invoiceNumber: 'TI/26-27/000153',
		totalINR: 1000,
		changeINR: 0,
		receiptNumbers: [],
		print: 'roll80',
	};

	it('hands the popup the bill, then clears it, says so and prints the invoice', async () => {
		const { fixture, page, instance, notifier, gateway } = setup({ answers: [sold] });
		await settle(fixture);
		await page.takePayment();
		expect(instance.start).not.toHaveBeenCalled();
		page.toggle(true);
		page.addLine({ productId: 'p_a', variationId: null, soldBy: 'piece', scanned: true });
		page.addLine({ productId: 'p_m', variationId: null, soldBy: 'metre', scanned: false });
		page.phone.set('9831122334');
		page.name.set('Shreya');
		await settle(fixture);
		(fixture.nativeElement.querySelector('#counter_take_payment') as HTMLButtonElement).click();
		await settle(fixture);
		const start = (instance.start.mock.calls[0] as unknown[])[0] as CounterPaymentStart;
		expect(start).toMatchObject({ store: GAR, totalINR: 2000, gstINR: 95.24, pieces: 2 });
		expect(start.sale.buyer).toEqual({ phone: '9831122334', name: 'Shreya', address: '', gstin: '' });
		expect(page.lines()).toEqual([]);
		expect(page.name()).toBe('');
		expect(notifier.showSuccess).toHaveBeenCalledWith('counter_sold');
		expect(gateway.print).toHaveBeenCalledWith('ord_1', 'roll80');
		expect(opened).toHaveLength(1);
	});

	it('keeps the bill when the popup is closed, and says when the print fails after a sale', async () => {
		const closed = setup({ answers: [undefined] });
		await settle(closed.fixture);
		closed.page.toggle(true);
		closed.page.addLine({ productId: 'p_a', variationId: null, soldBy: 'piece', scanned: true });
		await settle(closed.fixture);
		await closed.page.takePayment();
		expect(closed.page.lines()).toHaveLength(1);

		const noPrint = setup({ answers: [sold], print: () => throwError(() => new Error('down')) });
		await settle(noPrint.fixture);
		noPrint.page.toggle(true);
		noPrint.page.addLine({ productId: 'p_a', variationId: null, soldBy: 'piece', scanned: true });
		await settle(noPrint.fixture);
		await noPrint.page.takePayment();
		expect(noPrint.notifier.showError).toHaveBeenCalledWith('counter_print_failed');
	});
});

describe('the Take payment popup (P2)', () => {
	const start = (patch: Partial<CounterPaymentStart> = {}): CounterPaymentStart => ({
		store: GAR,
		totalINR: 4000,
		taxableINR: 3809.52,
		gstINR: 190.48,
		pieces: 4,
		sale: {
			locationId: 'loc_gar',
			lines: [],
			buyer: { phone: '', name: '', address: '', gstin: '' },
			expectedTotalINR: 4000,
		},
		...patch,
	});
	function popup(sell: () => unknown = () => of({ orderId: 'ord_1' })) {
		const modal = { close: vi.fn(), dismiss: vi.fn() };
		const gateway = { sell: vi.fn(sell) };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			imports: [
				CounterPayment,
				TranslocoTestingModule.forRoot({
					langs: { en: {} },
					translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
					preloadLangs: true,
				}),
			],
			providers: [
				{ provide: NgbActiveModal, useValue: modal },
				{ provide: CounterGateway, useValue: gateway },
			],
		});
		const fixture = TestBed.createComponent(CounterPayment);
		fixture.detectChanges();
		return { fixture, page: fixture.componentInstance, modal, gateway };
	}

	it('starts in cash with the till open, else UPI, and works out the change', () => {
		const { fixture, page } = popup();
		expect(page.booksWords()).toBe('');
		expect(page.canTake()).toBe(false);
		page.start(start());
		fixture.detectChanges();
		expect([page.cash(), page.handed(), page.upi()]).toEqual(['4000.00', '4000.00', '']);
		expect(page.changeINR()).toBe(0);
		expect(fixture.nativeElement.textContent).toContain('counter_effect_cash');
		page.upi.set('1,500');
		page.cash.set('2500');
		page.handed.set('₹3,000');
		fixture.detectChanges();
		expect(page.changeINR()).toBe(500);
		expect(page.canTake()).toBe(true);
		expect(fixture.nativeElement.textContent).toContain('counter_effect_cash_change');
		page.handed.set('2000');
		expect(page.canTake()).toBe(false);
		page.handed.set('abc');
		expect(page.canTake()).toBe(false);
		// Anything that isn't a sum of money counts as nothing until it is fixed.
		expect([page.cashINR(), page.paidINR(), page.changeINR(), page.booksWords()]).toEqual([0, 0, 0, '']);

		const closedTill = popup();
		closedTill.page.start(start({ store: { ...GAR, sheetOpen: false } }));
		closedTill.fixture.detectChanges();
		expect([closedTill.page.upi(), closedTill.page.cash()]).toEqual(['4000.00', '']);
		expect(closedTill.page.canTake()).toBe(true);
		expect(closedTill.fixture.nativeElement.textContent).toContain('counter_effect_no_cash');
		expect(closedTill.fixture.nativeElement.textContent).toContain('counter_cash_sheet_closed');
		closedTill.page.cash.set('100');
		closedTill.page.upi.set('3900');
		closedTill.page.handed.set('100');
		expect(closedTill.page.canTake()).toBe(false);
	});

	it('refuses to start until the payments add up, and words the books both ways', () => {
		const { fixture, page } = popup();
		page.start(start());
		page.cash.set('100');
		fixture.detectChanges();
		expect(page.canTake()).toBe(false);
		expect(fixture.nativeElement.textContent).toContain('counter_payments_add_up');
		page.cash.set('');
		page.card.set('4000');
		expect(page.booksWords()).toBe('counter_effect_books');
		page.cash.set('x');
		expect(page.canTake()).toBe(false);
	});

	it('does nothing on Take while an amount isn’t money', async () => {
		const { page, gateway } = popup();
		page.start(start());
		page.upi.set('abc');
		await page.take();
		expect(gateway.sell).not.toHaveBeenCalled();
	});

	it('sells with the payments taken, the cash handed over and the print chosen, and closes with the sale', async () => {
		const { fixture, page, gateway, modal } = popup();
		await page.take();
		page.start(start());
		page.upi.set('1500');
		page.upiRef.set(' 409912345678 ');
		page.cash.set('2500');
		page.handed.set('3000');
		fixture.detectChanges();
		(fixture.nativeElement.querySelector('#counter_print_a4') as HTMLInputElement).dispatchEvent(
			new Event('change'),
		);
		await page.take();
		expect(gateway.sell).toHaveBeenCalledWith({
			...start().sale,
			payments: [
				{ method: 'upi', amountINR: 1500, reference: '409912345678' },
				{ method: 'cash', amountINR: 2500, reference: '' },
			],
			cashHandedINR: 3000,
			print: 'a4',
		});
		expect(modal.close).toHaveBeenCalledWith({ orderId: 'ord_1' });
		(fixture.nativeElement.querySelector('#counter_print_roll') as HTMLInputElement).dispatchEvent(
			new Event('change'),
		);
		expect(page.print()).toBe('roll80');
	});

	it('keeps a refusal in words and the popup open; card only sends no cash handed over', async () => {
		const { fixture, page, modal } = popup(() =>
			throwError(() => ({ error: { message: 'cash_receipt_over_limit' } })),
		);
		page.start(start({ store: { ...GAR, sheetOpen: false } }));
		page.upi.set('');
		page.card.set('4000');
		page.cardRef.set('AUTH1');
		await page.take();
		fixture.detectChanges();
		expect(page.problem()).toEqual({ key: 'counter_problem_cash_receipt_over_limit', params: {} });
		expect(modal.close).not.toHaveBeenCalled();
		expect(page.busy()).toBe(false);
	});

	it('reads typed rupees', () => {
		expect([rupeesTyped(''), rupeesTyped('₹ 1,234.50'), rupeesTyped('12.345'), rupeesTyped('-1')]).toEqual([
			0,
			1234.5,
			null,
			null,
		]);
	});
});

describe('the counter gateway', () => {
	it('calls each counter route', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(CounterGateway);
		const http = TestBed.inject(HttpTestingController);
		const api = `${runtimeConfig.apiUrl}/admin/counter/`;
		const calls: [() => unknown, string, string][] = [
			[() => gateway.here(), 'GET', 'here'],
			[() => gateway.scan('TNT WHT'), 'GET', 'scan?code=TNT%20WHT'],
			[() => gateway.quote({} as never), 'POST', 'quote'],
			[() => gateway.sell({} as never), 'POST', 'sales'],
			[() => gateway.print('ord/1', 'roll80'), 'GET', 'sales/ord%2F1/print?paper=roll80'],
		];
		for (const [call, method, path] of calls) {
			(call() as { subscribe: () => void }).subscribe();
			http.expectOne((req) => req.method === method && req.urlWithParams === api + path).flush(
				path.includes('print') ? new Blob(['%PDF']) : {},
			);
		}
		http.verify();
	});

	it('puts counter refusals in words, naming the SKU or the role where there is one', () => {
		expect(counterProblemKey('counter_price_changed')).toEqual({
			key: 'counter_problem_counter_price_changed',
			params: {},
		});
		expect(counterProblemKey('cash_sheet_not_open')).toEqual({
			key: 'cash_problem_cash_sheet_not_open',
			params: {},
		});
		expect(counterProblemKey('counter_line_problem:out_of_stock:TNT')).toEqual({
			key: 'counter_problem_line_out_of_stock',
			params: { sku: 'TNT' },
		});
		expect(counterProblemKey('invoice_problem:hsn_missing:TNT')).toEqual({
			key: 'counter_problem_invoice_hsn_missing',
			params: { sku: 'TNT' },
		});
		expect(counterProblemKey('invoice_problem:no_location')).toEqual({
			key: 'counter_problem_invoice_no_location',
			params: { sku: '' },
		});
		expect(counterProblemKey('voucher_problem:role_not_mapped:upi_card_clearing')).toEqual({
			key: 'cash_problem_role',
			params: { role: 'upi_card_clearing' },
		});
		expect(counterProblemKey('voucher_problem:other')).toEqual({
			key: 'cash_failed',
			params: { code: 'voucher_problem:other' },
		});
	});
});
