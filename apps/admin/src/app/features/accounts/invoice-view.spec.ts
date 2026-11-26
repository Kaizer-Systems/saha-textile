import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InvoicesGateway } from '@core/accounts/invoices.gateway';
import { LocationsGateway } from '@core/locations/locations.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { InvoiceViewPage } from './invoice-view';

import type { InvoiceCheck, TaxInvoice } from '@saha-textile/contracts';

const invoice = {
	id: 'ti_1',
	orderId: 'ord_1',
	orderNumber: 'ST-2611-000001',
	number: 'TI/26-27/000001',
	date: '2026-11-23',
	gstin: '19DBYPS6736R1ZZ',
	locationId: 'loc_bar',
	shipmentId: null,
	seller: { name: 'K.R. Marketing', gstin: '19DBYPS6736R1ZZ', address: 'Barasat', stateCode: '19' },
	buyer: { name: 'Rang Mahal', gstin: null, address: 'Mumbai', stateCode: '27' },
	placeOfSupply: '27',
	interState: true,
	lines: [],
	shippingINR: 0,
	roundOffINR: 0,
	totalINR: 0,
	ratesPendingCa: true,
	status: 'issued',
	cancellation: null,
	createdAt: '2026-11-23T10:00:00.000Z',
} as unknown as TaxInvoice;

function setup(options: { id?: string | null; pdf?: () => unknown; locations?: unknown[] } = {}) {
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			InvoiceViewPage,
			TranslocoTestingModule.forRoot({
				langs: { en: { inv_outside_india: 'Outside India (96)', inv_check_after: 'after {{previous}}' } },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideRouter([]),
			provideTanStackQuery(new QueryClient()),
			{
				provide: ActivatedRoute,
				useValue: { paramMap: of(convertToParamMap(options.id === null ? {} : { id: options.id ?? 'ti_1' })) },
			},
			{
				provide: InvoicesGateway,
				useValue: {
					one: () => of(invoice),
					accounting: () => of({ lines: [], checks: [] }),
					pdf: vi.fn(options.pdf ?? (() => of(new Blob(['%PDF'])))),
				},
			},
			{
				provide: LocationsGateway,
				useValue: { list: () => of(options.locations ?? [{ id: 'loc_bar', name: 'Barasat warehouse' }]) },
			},
			{ provide: NotificationService, useValue: notifier },
		],
	});
	const fixture = TestBed.createComponent(InvoiceViewPage);
	return { fixture, page: fixture.componentInstance, notifier };
}

const check = (key: InvoiceCheck['key'], ok: boolean, params: Record<string, string> = {}): InvoiceCheck => ({
	key,
	ok,
	params,
});

describe('a tax invoice’s page (D1, Q5)', () => {
	afterEach(() => vi.restoreAllMocks());

	it('loads the invoice, its books view and where it shipped from', async () => {
		const { fixture, page } = setup();
		expect(page.locationName()).toBe('');
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.locationName()).toBe('Barasat warehouse'));
		expect(page.invoice.data()).toEqual(invoice);
		expect(page.tab()).toBe('accounting');
		const elsewhere = setup({ locations: [] });
		elsewhere.fixture.detectChanges();
		await vi.waitFor(() => expect(elsewhere.page.locations.data()).toEqual([]));
		expect(elsewhere.page.locationName()).toBe('');
		expect(setup({ id: null }).page.id()).toBe('');
	});

	it('names States, days, months and amounts as the screen writes them', () => {
		const { page } = setup();
		expect(page.state('27')).toBe('Maharashtra (27)');
		expect(page.state('00')).toBe('00 (00)');
		expect(page.state('96')).toBe('Outside India (96)');
		expect(page.day('2026-11-23')).toBe('23 Nov 2026');
		expect(page.month('2026-11')).toBe('Nov 2026');
		expect(page.when('2026-11-23T10:00:00.000Z')).toContain('2026');
		expect(page.inr(1_738.1)).toBe('₹1,738.10');
	});

	it('says each check in words', () => {
		const { page } = setup();
		expect(
			[
				check('period_open', true, { month: '2026-11' }),
				check('period_open', false),
				check('number_in_series', true, { previous: 'TI/26-27/000144' }),
				check('number_in_series', true),
				check('number_in_series', false),
				check('place_of_supply', true, { from: 'West Bengal', to: 'Maharashtra', tax: 'IGST' }),
				check('stock_at_cost', true, { cost: '6240.00' }),
				check('stock_at_cost', false),
				check('rates', true),
				check('rates', false),
				check('cancel', false, { shipped: 'yes' }),
				check('cancel', false, { shipped: 'no' }),
			].map((c) => page.detail(c)),
		).toEqual([
			'Nov 2026',
			'',
			'after TI/26-27/000144',
			'inv_check_first',
			'inv_check_gap',
			'inv_check_place_detail',
			'inv_check_cost_detail',
			'inv_check_cost_missing',
			'inv_check_rates_ok',
			'inv_check_rates_wait',
			'inv_check_cancel_shipped',
			'inv_check_cancel_issued',
		]);
	});

	it('prints or saves a copy once the invoice is loaded, and says when it fails', async () => {
		Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined });
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
		const { fixture, page } = setup();
		await page.print('original', false);
		expect(open).not.toHaveBeenCalled();
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.invoice.data()).toEqual(invoice));
		await page.print('original', false);
		await page.print('all', true);
		expect(open).toHaveBeenCalled();
		expect(click).toHaveBeenCalled();
		const failing = setup({ pdf: () => throwError(() => new Error('down')) });
		failing.fixture.detectChanges();
		await vi.waitFor(() => expect(failing.page.invoice.data()).toEqual(invoice));
		await failing.page.print('original', false);
		expect(failing.notifier.showError).toHaveBeenCalled();
		expect(failing.page.busy()).toBe(false);
	});
});
