import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';
import { CounterGateway, counterProblemKey, istToday } from '@core/counter/counter.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { CounterExchangePage, EXCHANGE_REASONS } from './counter-exchange';
import { CounterSummaryPage } from './counter-summary';

/** Exchange at the counter (accounts brief P3) and the counter summary (P4). */

const opened: Blob[] = [];
vi.mock('@core/purchasing/purchasing-format', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing-format')>()),
	openPdf: (blob: Blob) => void opened.push(blob),
}));
afterEach(() => {
	opened.length = 0;
});

const BILL = {
	orderId: 'ord_c',
	orderNumber: 'ST-2611-000009',
	locationId: 'loc_gar',
	buyerName: 'Shreya Ghosh',
	buyerPhone: '',
	invoiceNumber: 'TI/26-27/000153',
	deliveredOn: '2026-11-23',
	windowOpen: true,
	lines: [
		{ lineId: 'a', sku: 'TNT', title: 'Tant', bought: 2, returnedBefore: 0, returnable: true, unitPriceINR: 1250 },
		{ lineId: 'b', sku: 'BLS', title: 'Blouse', bought: 1, returnedBefore: 1, returnable: true, unitPriceINR: 900 },
	],
};

function mount<T>(component: Type<T>, gateway: Record<string, unknown>, orderId: string | null = null) {
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
			{ provide: CounterGateway, useValue: gateway },
			{ provide: NotificationService, useValue: notifier },
			{ provide: Router, useValue: router },
			{
				provide: ActivatedRoute,
				useValue: { paramMap: of(convertToParamMap(orderId ? { orderId } : {})) },
			},
		],
	});
	const fixture = TestBed.createComponent(component);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, router, notifier };
}

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};

const exchangeGateway = (patch: Record<string, unknown> = {}) => ({
	find: vi.fn((n: string) =>
		n === 'TI/26-27/000153'
			? of({ orderId: 'ord_c' })
			: throwError(() => ({ error: { message: 'counter_sale_not_found' } })),
	),
	bill: vi.fn(() => of(BILL)),
	scan: vi.fn((code: string) =>
		code === 'PTC'
			? of({ productId: 'p_ptc', variationId: null, sku: 'PTC', title: 'Petticoat', soldBy: 'piece' })
			: code === 'CLOTH'
				? of({ productId: 'p_cl', variationId: 'v1', sku: 'CLOTH', title: 'Cloth', soldBy: 'metre' })
				: throwError(() => new Error('nope')),
	),
	quote: vi.fn((write: { lines: unknown[] }) =>
		of({
			lines: write.lines.map((_l, i) => ({ lineTotalINR: 650 + i })),
			totalINR: write.lines.length * 650 + (write.lines.length > 1 ? 1 : 0),
			taxableINR: 0,
			cgstINR: 0,
			sgstINR: 0,
			problems: [],
		}),
	),
	exchange: vi.fn(() =>
		of({ creditNoteNumber: 'CN/26-27/000014', sale: { orderId: 'ord_new', invoiceNumber: 'TI/26-27/000154' } }),
	),
	print: vi.fn(() => of(new Blob(['%PDF']))),
	...patch,
});

describe('finding a bill to exchange (P3)', () => {
	it('opens the bill found by its number, and says when there is none', async () => {
		const { fixture, page, router } = mount(CounterExchangePage, exchangeGateway());
		await settle(fixture);
		expect(page.rows()).toEqual([]);
		await page.find();
		expect(router.navigate).not.toHaveBeenCalled();
		page.number.set(' TI/26-27/000153 ');
		(fixture.nativeElement.querySelector('#exchange_find') as HTMLButtonElement).click();
		await settle(fixture);
		expect(router.navigate).toHaveBeenCalledWith(['/cash/exchange', 'ord_c']);
		page.number.set('X');
		await page.find();
		fixture.detectChanges();
		expect(page.problem()).toEqual({ key: 'counter_problem_counter_sale_not_found', params: {} });
		expect(fixture.nativeElement.querySelector('.alert-danger')).not.toBeNull();
	});
});

describe('an exchange at the counter (P3)', () => {
	it('picks what comes back within what is left, scans what goes out, and refunds the difference in cash', async () => {
		const gateway = exchangeGateway();
		const { fixture, page, router, notifier } = mount(CounterExchangePage, gateway, 'ord_c');
		await settle(fixture);
		expect(fixture.nativeElement.textContent).toContain('counter_exchange_bill');
		expect(page.rows().map((r) => [r.left, r.returnable])).toEqual([
			[2, true],
			[0, false],
		]);
		const [tant] = page.rows();
		page.setGoes(tant!, 'damaged');
		page.setBack(tant!, 5);
		expect(page.back()['a']).toEqual({ quantity: 2, goes: 'damaged' });
		page.setBack(tant!, 'x' as never);
		page.setBack(tant!, 1);
		page.setGoes(tant!, 'stock');
		expect(page.backINR()).toBe(1250);
		await page.scan();
		page.code.set('PTC');
		await page.scan();
		page.code.set('CLOTH');
		await page.scan();
		page.code.set('PTC');
		await page.scan();
		expect(page.out().map((r) => r.quantity)).toEqual([2, 10]);
		page.code.set('NOPE');
		await page.scan();
		expect(page.problem()).toEqual({ key: 'counter_problem_counter_code_unknown', params: {} });
		page.removeOut(page.out()[1]!.key);
		await settle(fixture);
		expect(page.outINR()).toBe(650);
		expect(page.outValue(0)).toBe(650);
		expect(page.differenceINR()).toBe(-600);
		expect(fixture.nativeElement.textContent).toContain('counter_exchange_refund');
		page.reason.set('changed_mind');
		(fixture.nativeElement.querySelector('#exchange_do') as HTMLButtonElement).click();
		await settle(fixture);
		expect(gateway.exchange).toHaveBeenCalledWith('ord_c', {
			back: [{ lineId: 'a', quantity: 1, goes: 'stock' }],
			out: [{ productId: 'p_ptc', variationId: null, quantity: 2, scanned: true }],
			reason: 'changed_mind',
			settle: 'cash',
			reference: '',
			expectedBackINR: 1250,
			expectedOutINR: 650,
		});
		expect(notifier.showSuccess).toHaveBeenCalledWith('counter_exchanged');
		expect(opened).toHaveLength(1);
		expect(router.navigate).toHaveBeenCalledWith(['/cash/exchange']);
		expect(EXCHANGE_REASONS).toContain('size_or_fit');
	});

	it('takes a difference the buyer pays by UPI with its reference, and a plain return with nothing going out', async () => {
		const gateway = exchangeGateway({
			quote: vi.fn(() => of({ lines: [{ lineTotalINR: 2000 }], totalINR: 2000, problems: [] })),
			exchange: vi.fn(() => of({ creditNoteNumber: 'CN/26-27/000015', sale: null })),
		});
		const { fixture, page } = mount(CounterExchangePage, gateway, 'ord_c');
		await settle(fixture);
		page.setBack(page.rows()[0]!, 1);
		page.code.set('PTC');
		await page.scan();
		await settle(fixture);
		expect(page.differenceINR()).toBe(750);
		expect(fixture.nativeElement.textContent).toContain('counter_exchange_take');
		page.settle.set('upi');
		fixture.detectChanges();
		expect(page.canExchange()).toBe(false);
		page.reference.set('409912345678');
		await page.exchange();
		expect(gateway.exchange).toHaveBeenCalledWith(
			'ord_c',
			expect.objectContaining({ settle: 'upi', reference: '409912345678', expectedOutINR: 2000 }),
		);
		expect(opened).toHaveLength(0);

		const even = mount(
			CounterExchangePage,
			exchangeGateway({
				quote: vi.fn(() => of({ lines: [{ lineTotalINR: 1250 }], totalINR: 1250, problems: [] })),
			}),
			'ord_c',
		);
		await settle(even.fixture);
		even.page.setBack(even.page.rows()[0]!, 1);
		even.page.code.set('PTC');
		await even.page.scan();
		await settle(even.fixture);
		expect(even.fixture.nativeElement.textContent).toContain('counter_exchange_even');
	});

	it('waits for something coming back, keeps a refusal in words, and says when the new invoice didn’t print', async () => {
		const refused = exchangeGateway({
			exchange: vi.fn(() => throwError(() => ({ error: { message: 'return_too_many:TNT' } }))),
		});
		const { fixture, page } = mount(CounterExchangePage, refused, 'ord_c');
		await settle(fixture);
		await page.exchange();
		expect(refused.exchange).not.toHaveBeenCalled();
		page.setBack(page.rows()[0]!, 1);
		await page.exchange();
		expect(page.problem()).toEqual({ key: 'ret_problem_return_too_many', params: { sku: 'TNT' } });
		expect(page.busy()).toBe(false);

		const noPrint = exchangeGateway({ print: vi.fn(() => throwError(() => new Error('down'))) });
		const second = mount(CounterExchangePage, noPrint, 'ord_c');
		await settle(second.fixture);
		second.page.setBack(second.page.rows()[0]!, 1);
		await second.page.exchange();
		expect(second.notifier.showError).toHaveBeenCalledWith('counter_print_failed');
		expect(second.page.outValue(0)).toBeNull();

		const closed = mount(
			CounterExchangePage,
			exchangeGateway({
				bill: vi.fn(() => of({ ...BILL, windowOpen: false, invoiceNumber: null, buyerName: '' })),
			}),
			'ord_c',
		);
		await settle(closed.fixture);
		expect(closed.fixture.nativeElement.textContent).toContain('ret_problem_return_window_closed');
		expect(closed.page.date(null)).toBe('—');
	});
});

describe('the counter summary (P4)', () => {
	const summary = (cash: boolean) => ({
		date: '2026-11-24',
		locationId: 'loc_gar',
		locationName: 'Gariahat store',
		byMethod: [
			{ method: 'cash', bills: 2, amountINR: cash ? 3150 : null },
			{ method: 'upi', bills: 1, amountINR: 1500 },
			{ method: 'card', bills: 0, amountINR: 0 },
		],
		returns: { notes: 1, amountINR: 1250 },
		exchangeNew: { bills: 1, amountINR: 650 },
		netSalesINR: cash ? 3400 : null,
		billNumbers: cash ? ['TI/26-27/000153', 'TI/26-27/000155'] : [],
		firstAt: cash ? '2026-11-24T04:30:00.000Z' : null,
		lastAt: cash ? '2026-11-24T10:15:00.000Z' : null,
		discountsINR: 0,
		sheetStatus: cash ? 'open' : null,
		cash,
	});

	it('shows the store’s day for the chip’s store, another store or day on asking, and prints', async () => {
		const gateway = {
			here: vi.fn(() =>
				of({
					current: 'loc_gar',
					stores: [
						{ locationId: 'loc_gar', name: 'Gariahat store' },
						{ locationId: 'loc_bar', name: 'Barasat store' },
					],
				}),
			),
			summary: vi.fn((q: { locationId: string }) => of(summary(q.locationId === 'loc_gar'))),
		};
		const { fixture, page } = mount(CounterSummaryPage, gateway);
		await settle(fixture);
		expect(gateway.summary).toHaveBeenCalledWith({ date: istToday(), locationId: 'loc_gar' });
		const text = () => fixture.nativeElement.textContent as string;
		expect(text()).toContain('counter_summary_manager_copy');
		expect(text()).toContain('TI/26-27/000153 – TI/26-27/000155');
		page.picked.set('loc_bar');
		page.date.set('2026-11-23');
		await settle(fixture);
		expect(gateway.summary).toHaveBeenLastCalledWith({ date: '2026-11-23', locationId: 'loc_bar' });
		expect(text()).toContain('counter_summary_cashier_copy');
		expect(text()).toContain('counter_summary_no_sheet');
		expect(page.time(null)).toBe('—');
		const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
		(fixture.nativeElement.querySelector('#summary_print') as HTMLButtonElement).click();
		expect(print).toHaveBeenCalled();
	});

	it('takes the only store when the chip is on all locations, and says so when there is no store', async () => {
		const one = mount(CounterSummaryPage, {
			here: vi.fn(() => of({ current: null, stores: [{ locationId: 'loc_bar', name: 'Barasat' }] })),
			summary: vi.fn(() => of(summary(true))),
		});
		await settle(one.fixture);
		expect(one.page.locationId()).toBe('loc_bar');
		const none = mount(CounterSummaryPage, {
			here: vi.fn(() => of({ current: null, stores: [] })),
			summary: vi.fn(),
		});
		await settle(none.fixture);
		expect(none.page.query()).toBeNull();
		expect(none.fixture.nativeElement.textContent).toContain('counter_summary_no_store');
	});
});

describe('the counter gateway’s exchange and summary calls', () => {
	it('calls each route', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(CounterGateway);
		const http = TestBed.inject(HttpTestingController);
		const api = `${runtimeConfig.apiUrl}/admin/counter/`;
		const calls: [() => unknown, string, string][] = [
			[() => gateway.find('TI/1'), 'GET', 'sales?number=TI/1'],
			[() => gateway.bill('ord/1'), 'GET', 'sales/ord%2F1'],
			[() => gateway.exchange('ord/1', {} as never), 'POST', 'sales/ord%2F1/exchange'],
			[
				() => gateway.summary({ date: '2026-11-24', locationId: 'loc_gar' }),
				'GET',
				'summary?date=2026-11-24&locationId=loc_gar',
			],
		];
		for (const [call, method, path] of calls) {
			(call() as { subscribe: () => void }).subscribe();
			http.expectOne((req) => req.method === method && req.urlWithParams === api + path).flush({});
		}
		http.verify();
	});

	it('words a refused return in the returns screens’ words, and knows India’s day', () => {
		expect(counterProblemKey('return_window_closed')).toEqual({
			key: 'ret_problem_return_window_closed',
			params: { sku: '' },
		});
		expect(istToday(new Date('2026-11-23T19:00:00.000Z'))).toBe('2026-11-24');
	});
});
