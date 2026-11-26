import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { NEVER, type Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { FxGateway } from '@core/fx/fx.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { Currency } from './currency';

import type { AdminCurrencyRow, AdminFxOverview } from '@saha-textile/contracts';

const USD: AdminCurrencyRow = {
	code: 'USD',
	symbol: 'US$',
	stored: false,
	enabled: false,
	inrPerUnit: 88.42,
	setBy: 'staff',
	setByName: null,
	setAt: null,
	examplePrice: 119.88,
};

const overview = (source: 'stored' | 'paypalFxaas' = 'stored'): AdminFxOverview => ({
	settings: {
		source,
		paypalFxaas: { approved: true, unavailableSince: '2026-11-24T03:00:00.000Z', lastQuoteAt: null },
		paypalMarkupPercent: 6,
		dailyFetch: { enabled: true, time: '12:30', lastRunAt: null, lastError: null },
		revision: 3,
		updatedBy: null,
	},
	currencies: [USD],
	canEditMarkup: false,
	exampleINR: 10_000,
	fetchUsesKey: false,
});

const flush = async (fixture: { detectChanges: () => void }) => {
	for (let i = 0; i < 20; i += 1) {
		await new Promise((done) => setTimeout(done, 2));
		fixture.detectChanges();
	}
};

async function setup(options: { overview?: Observable<AdminFxOverview>; held?: string[] } = {}) {
	const gateway = {
		overview: vi.fn(() => options.overview ?? of(overview())),
		saveSettings: vi.fn(() => of(overview())),
		setRate: vi.fn(() => of(overview())),
		fetchNow: vi.fn(() => of({ ok: true, updated: [], problem: null, at: '2026-11-24T03:00:00.000Z' })),
	};
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const modals = { open: vi.fn(() => ({ close: vi.fn() })) };
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
			{ provide: AuthStore, useValue: { permissions: () => options.held ?? ['currency.index'] } },
			{ provide: NgbModal, useValue: modals },
		],
	});
	TestBed.overrideComponent(Currency, {
		set: { imports: [], template: '<ng-template #ratePopup></ng-template>' },
	});
	const fixture = TestBed.createComponent(Currency);
	fixture.detectChanges();
	await flush(fixture);
	return { page: fixture.componentInstance, gateway, notifier, modals, fixture };
}

describe('Admin › Currencies: before the settings arrive', () => {
	it('changes and saves nothing, and puts nothing back for a refused time', async () => {
		const { page, gateway, notifier } = await setup({ overview: NEVER });
		expect(page.draft()).toBeNull();
		page.patch({ markup: 7 });
		expect(page.draft()).toBeNull();
		page.setFetchTime('25:99');
		expect(notifier.showError).toHaveBeenCalledWith('fx_err_time');
		expect(gateway.saveSettings).not.toHaveBeenCalled();
		page.patchEditing({ enabled: true });
		expect(page.editing()).toBeNull();
		await page.saveRate();
		expect(gateway.setRate).not.toHaveBeenCalled();
	});
});

describe('Admin › Currencies: words, PayPal and fetching', () => {
	it('writes missing values as a dash, a staff rate with no name, and who may edit', async () => {
		const { page } = await setup();
		expect([page.when(null), page.rate(null), page.setBy(USD)]).toEqual(['—', '—', 'fx_set_by_staff:{"name":""}']);
		expect(page.canEdit()).toBe(false);
		expect(page.paypalDown()).toBeNull();
	});

	it('says since when PayPal’s rates have failed while they are the chosen source', async () => {
		const { page } = await setup({ overview: of(overview('paypalFxaas')) });
		expect(page.paypalDown()).toBe('2026-11-24T03:00:00.000Z');
	});

	it('fetches once at a time, and says what went wrong', async () => {
		const { page, gateway, notifier } = await setup();
		gateway.fetchNow.mockReturnValueOnce(of({ ok: false, updated: [], problem: null, at: 'x' }) as never);
		await page.fetchNow();
		expect(notifier.showError).toHaveBeenLastCalledWith('fx_fetch_failed:{"problem":""}');
		gateway.fetchNow.mockReturnValueOnce(throwError(() => new Error('offline')));
		await page.fetchNow();
		expect(notifier.showError).toHaveBeenCalledTimes(2);
		page.fetching.set(true);
		await page.fetchNow();
		expect(gateway.fetchNow).toHaveBeenCalledTimes(2);
	});
});

describe('Admin › Currencies: the rate popup', () => {
	it('opens for a currency not yet stored as switched on, and says why a rate was refused', async () => {
		const { page, gateway, notifier, modals } = await setup({ held: ['currency.edit'] });
		page.edit(USD);
		expect(modals.open).toHaveBeenCalledOnce();
		expect(page.editing()).toMatchObject({ enabled: true, inrPerUnit: 88.42 });
		gateway.setRate.mockReturnValueOnce(throwError(() => new Error('refused')));
		await page.saveRate();
		expect(notifier.showError).toHaveBeenCalled();
		page.saving.set(true);
		await page.saveRate();
		expect(gateway.setRate).toHaveBeenCalledOnce();
	});
});
