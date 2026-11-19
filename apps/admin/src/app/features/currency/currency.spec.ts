import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { FxGateway } from '@core/fx/fx.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { PaymentRouting } from '@features/setting/payment-routing/payment-routing';

import { Currency, fxProblemKey } from './currency';

import type {
	AdminFxOverview,
	AdminPaymentRouting,
	FxSettingsWrite,
	PaymentRoutingWrite,
} from '@saha-textile/contracts';

const OVERVIEW: AdminFxOverview = {
	settings: {
		source: 'stored',
		paypalFxaas: { approved: false, unavailableSince: null, lastQuoteAt: null },
		paypalMarkupPercent: 6,
		dailyFetch: { enabled: true, time: '12:30', lastRunAt: '2026-11-19T07:00:00.000Z', lastError: null },
		revision: 3,
		updatedBy: null,
	},
	currencies: [
		{
			code: 'USD',
			symbol: 'US$',
			stored: true,
			enabled: true,
			inrPerUnit: 88.42,
			setBy: 'fetch',
			setByName: null,
			setAt: '2026-11-19T07:00:00.000Z',
			examplePrice: 119.88,
		},
		{
			code: 'EUR',
			symbol: '€',
			stored: true,
			enabled: true,
			inrPerUnit: 101.8,
			setBy: 'staff',
			setByName: 'Moulik Patra',
			setAt: '2026-11-19T05:35:00.000Z',
			examplePrice: 104.13,
		},
		{
			code: 'GBP',
			symbol: '£',
			stored: false,
			enabled: false,
			inrPerUnit: null,
			setBy: null,
			setByName: null,
			setAt: null,
			examplePrice: null,
		},
	],
	canEditMarkup: false,
	exampleINR: 10_000,
	fetchUsesKey: false,
};

const ROUTING: AdminPaymentRouting = {
	settings: {
		activeInrGateway: 'ccavenue',
		paypalTakesNewPayments: true,
		testMode: { ccavenue: false, razorpay: false, paypal: false },
		popups: { paypalChooseCurrency: true, inrCardRefused: true },
		revision: 0,
		updatedBy: null,
	},
	keysOnServer: { ccavenue: false, razorpay: false, paypal: false },
	built: { ccavenue: true, razorpay: false, paypal: false },
};

const flush = async () => {
	for (let i = 0; i < 10; i += 1) await new Promise((done) => setTimeout(done, 1));
};

const setup = async <T>(type: new (...args: never[]) => T) => {
	const gateway = {
		overview: vi.fn(() => of(OVERVIEW)),
		saveSettings: vi.fn((write: FxSettingsWrite) =>
			of({
				...OVERVIEW,
				settings: {
					...OVERVIEW.settings,
					source: write.source,
					paypalMarkupPercent: write.paypalMarkupPercent,
					dailyFetch: { ...OVERVIEW.settings.dailyFetch, ...write.dailyFetch },
					revision: write.revision + 1,
				},
			}),
		),
		setRate: vi.fn(() => of(OVERVIEW)),
		fetchNow: vi.fn(() => of({ ok: true, updated: ['USD', 'GBP'], problem: null, at: '2026-11-19T07:00:00.000Z' })),
		routing: vi.fn(() => of(ROUTING)),
		saveRouting: vi.fn((write: PaymentRoutingWrite) =>
			of({ ...ROUTING, settings: { ...ROUTING.settings, ...write, revision: write.revision + 1 } }),
		),
	};
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const modal = { open: vi.fn(() => ({ close: vi.fn() })) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			provideTanStackQuery(new QueryClient()),
			{ provide: FxGateway, useValue: gateway },
			{ provide: NotificationService, useValue: notifier },
			{
				provide: TranslocoService,
				useValue: {
					translate: (key: string, params?: Record<string, unknown>) =>
						params ? `${key}:${JSON.stringify(params)}` : key,
					getActiveLang: () => 'en',
				},
			},
			{
				provide: AuthStore,
				useValue: { permissions: () => ['currency.index', 'currency.edit', 'setting.edit'] },
			},
			{ provide: NgbModal, useValue: modal },
		],
	});
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(type);
	fixture.detectChanges();
	for (let i = 0; i < 40; i += 1) {
		await new Promise((done) => setTimeout(done, 5));
		fixture.detectChanges();
	}
	return { page: fixture.componentInstance, gateway, notifier, modal };
};

describe('Admin › Currencies (brief fx01–fx03)', () => {
	it('reads each row as the brief writes it', async () => {
		const { page } = await setup(Currency);
		const [usd, eur, gbp] = OVERVIEW.currencies as [never, never, never];
		expect(page.setBy(usd)).toBe('fx_set_by_fetch');
		expect(page.setBy(eur)).toBe('fx_set_by_staff:{"name":"Moulik"}');
		expect(page.setBy(gbp)).toBe('—');
		expect(page.when('2026-11-19T07:00:00.000Z')).toBe('19 Nov, 12:30');
		expect(page.example(usd, 10_000)).toBe('₹10,000 → US$119.88');
		expect(page.example(gbp, 10_000)).toBe('—');
		expect(page.rate(88.42)).toBe('88.42');
		expect(page.rate(122.9861)).toBe('122.99');
		expect(page.currencyName('USD')).toBe('US Dollar');
		// The brief's name, not the browser's "British Pound".
		expect(page.currencyName('GBP')).toBe('fx_name_GBP');
		expect(page.paypalDown()).toBeNull();
	});

	it('saves each change as it is made (no Save button in fx01), one at a time on the latest revision', async () => {
		const { page, gateway } = await setup(Currency);
		page.patch({ fetchEnabled: false });
		page.patch({ fetchTime: '09:00' });
		await flush();
		expect(gateway.saveSettings.mock.calls.map(([write]) => write)).toEqual([
			{ source: 'stored', paypalMarkupPercent: 6, dailyFetch: { enabled: false, time: '12:30' }, revision: 3 },
			{ source: 'stored', paypalMarkupPercent: 6, dailyFetch: { enabled: false, time: '09:00' }, revision: 4 },
		]);
		expect(page.draft()).toMatchObject({ fetchEnabled: false, fetchTime: '09:00' });
		// Nothing changed: nothing sent.
		await page.save();
		expect(gateway.saveSettings).toHaveBeenCalledTimes(2);
	});

	it('takes the fetch time as 24-hour "12:30" and refuses anything else', async () => {
		const { page, gateway, notifier } = await setup(Currency);
		page.setFetchTime('7:5 pm');
		expect(notifier.showError).toHaveBeenCalledWith('fx_err_time');
		expect(page.draft()?.fetchTime).toBe('12:30');
		expect(gateway.saveSettings).not.toHaveBeenCalled();
		page.setFetchTime(' 18:05 ');
		await flush();
		expect(gateway.saveSettings).toHaveBeenCalledWith(
			expect.objectContaining({ dailyFetch: { enabled: true, time: '18:05' } }),
		);
	});

	it('fetches now and types a rate', async () => {
		const { page, gateway, notifier, modal } = await setup(Currency);
		await page.fetchNow();
		expect(notifier.showSuccess).toHaveBeenCalledWith('fx_fetched:{"count":2}');

		page.edit(OVERVIEW.currencies[2] as never);
		expect(page.editing()).toMatchObject({ inrPerUnit: null, enabled: true });
		page.patchEditing({ inrPerUnit: 116.95 });
		await page.saveRate();
		expect(gateway.setRate).toHaveBeenCalledWith('GBP', { inrPerUnit: 116.95, enabled: true });

		// Switching off without a new rate sends only the switch.
		page.edit(OVERVIEW.currencies[0] as never);
		page.patchEditing({ enabled: false });
		await page.saveRate();
		expect(gateway.setRate).toHaveBeenLastCalledWith('USD', { enabled: false });
		expect(modal.open).toHaveBeenCalledTimes(0); // no popup template without a view
	});

	it('names the server’s refusals', () => {
		expect(fxProblemKey({ error: { code: 'super_admin_only' } })).toBe('fx_err_super_admin_only');
		expect(fxProblemKey({ error: { issues: [{ code: 'rate_required' }] } })).toBe('fx_err_rate_required');
		expect(fxProblemKey(new Error('offline'))).not.toMatch(/^fx_err_/);
	});

	it('shows a failed save and puts the saved value back', async () => {
		const { page, gateway, notifier } = await setup(Currency);
		gateway.saveSettings.mockReturnValueOnce(throwError(() => ({ error: { code: 'super_admin_only' } })));
		page.patch({ markup: 7 });
		await flush();
		expect(notifier.showError).toHaveBeenCalledWith('fx_err_super_admin_only');
		expect(page.draft()?.markup).toBe(6);
	});
});

describe('Settings › Payment method (brief pay01)', () => {
	it('switches gateways, test mode and popups, then saves', async () => {
		const { page, gateway, notifier } = await setup(PaymentRouting);
		expect(page.foreignCurrencies).toBe('US$ · £ · € · C$ · A$ · S$ · NZ$');
		expect(page.takesNewPayments('ccavenue')).toBe(true);
		expect(page.takesNewPayments('razorpay')).toBe(false);
		page.setTakesNewPayments('ccavenue', false);
		expect(page.draft()?.activeInrGateway).toBeNull();
		page.setTakesNewPayments('ccavenue', true);
		page.setTakesNewPayments('paypal', false);
		page.setTestMode('ccavenue', true);
		page.setPopup('inrCardRefused', false);
		expect(page.changed()).toBe(true);
		await page.save();
		expect(gateway.saveRouting).toHaveBeenCalledWith({
			activeInrGateway: 'ccavenue',
			paypalTakesNewPayments: false,
			testMode: { ccavenue: true, razorpay: false, paypal: false },
			popups: { paypalChooseCurrency: true, inrCardRefused: false },
			revision: 0,
		});
		expect(notifier.showSuccess).toHaveBeenCalledWith('pay_saved');
		await flush();
		// The settings page's Save button saves this tab only when something on it changed.
		expect(page.changed()).toBe(false);
		await page.save();
		expect(gateway.saveRouting).toHaveBeenCalledTimes(1);
	});
});
