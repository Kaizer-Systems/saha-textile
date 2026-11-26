import { type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ReportsGateway } from '@core/accounts/reports.gateway';
import { accountsRange } from '@features/accounts/accounts-period';

import { CASH_SECTIONS, CashFlowPage, RATIO_KEYS, RatiosPage, ratioText } from './cash-flow-page';

/** Cash flow and the usual ratios for a period (accounts brief U1). */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};

function mount<T>(component: Type<T>, gateway: Record<string, unknown>) {
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
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			provideRouter([]),
			{ provide: ReportsGateway, useValue: gateway },
		],
	});
	const fixture = TestBed.createComponent(component);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance };
}

const rows = (fixture: { nativeElement: HTMLElement }) =>
	([...fixture.nativeElement.querySelectorAll('tbody tr')] as HTMLElement[]).map((tr) =>
		[...tr.querySelectorAll('td')].map((td) => td.textContent?.trim()),
	);
const alerts = (fixture: { nativeElement: HTMLElement }) =>
	([...fixture.nativeElement.querySelectorAll('.alert-warning')] as HTMLElement[]).map((a) => a.textContent?.trim());

const CASH = {
	from: '2026-04-01',
	to: '2027-03-31',
	lines: [
		{ section: 'operating', key: 'profit', paise: 500_000 },
		{ section: 'operating', key: 'stock', paise: -120_000 },
		{ section: 'investing', key: 'assets', paise: -200_000 },
		{ section: 'financing', key: 'capital', paise: 100_000 },
	],
	sections: { operating: 380_000, investing: -200_000, financing: 100_000 },
	netChange: 280_000,
	openingCash: 50_000,
	closingCash: 330_000,
};

describe('a ratio as shown', () => {
	it('shows margins in percent, days rounded, the rest as they are, and a dash for none', () => {
		expect([...CASH_SECTIONS]).toEqual(['operating', 'investing', 'financing']);
		expect(RATIO_KEYS).toHaveLength(8);
		expect(ratioText('currentRatio', null)).toBe('—');
		expect(ratioText('currentRatio', undefined)).toBe('—');
		expect(ratioText('grossMargin', 32.5)).toBe('32.5%');
		expect(ratioText('netMargin', -4)).toBe('-4%');
		expect(ratioText('debtorDays', 41.6)).toBe('42');
		expect(ratioText('creditorDays', 29.4)).toBe('29');
		expect(ratioText('debtEquity', 0.45)).toBe('0.45');
		expect(ratioText('stockTurnover', 0)).toBe('0');
	});
});

describe('cash flow (indirect method)', () => {
	it('reads this financial year, each line under its section with the section’s net, and the cash at both ends', async () => {
		const cashFlow = vi.fn(() => of(CASH));
		const { fixture } = mount(CashFlowPage, { cashFlow });
		await settle(fixture);
		expect(cashFlow).toHaveBeenCalledWith(accountsRange({ period: 'this_fy' }));
		expect(rows(fixture)).toEqual([
			['cash_flow_operating'],
			['cash_flow_line_profit', '₹5,000.00'],
			['cash_flow_line_stock', '−₹1,200.00'],
			['cash_flow_net_operating', '₹3,800.00'],
			['cash_flow_investing'],
			['cash_flow_line_assets', '−₹2,000.00'],
			['cash_flow_net_investing', '−₹2,000.00'],
			['cash_flow_financing'],
			['cash_flow_line_capital', '₹1,000.00'],
			['cash_flow_net_financing', '₹1,000.00'],
			['cash_flow_net', '₹2,800.00'],
			['cash_flow_opening', '₹500.00'],
			['cash_flow_closing', '₹3,300.00'],
		]);
		expect(alerts(fixture)).toEqual([]);
	});

	it('warns when opening cash and the change don’t make the closing cash, and reads the period picked', async () => {
		const cashFlow = vi.fn(() => of({ ...CASH, closingCash: 330_100 }));
		const { fixture, page } = mount(CashFlowPage, { cashFlow });
		await settle(fixture);
		expect(alerts(fixture)).toEqual(['cash_flow_unbalanced']);
		page.setPeriod({ period: 'custom', from: '2026-10-01', to: '2026-10-31' });
		await settle(fixture);
		expect(cashFlow).toHaveBeenLastCalledWith({ from: '2026-10-01', to: '2026-10-31' });
	});

	it('says when the cash flow cannot be read', async () => {
		const { fixture } = mount(CashFlowPage, { cashFlow: vi.fn(() => throwError(() => new Error('down'))) });
		await settle(fixture);
		expect(alerts(fixture)).toEqual(['statement_problem']);
		expect(rows(fixture)).toEqual([]);
	});
});

describe('the usual ratios', () => {
	it('shows each ratio’s value and what it means, a dash for one that can’t be worked out', async () => {
		const ratios = vi.fn(() =>
			of({
				from: '2026-04-01',
				to: '2027-03-31',
				values: {
					currentRatio: 1.8,
					quickRatio: 1.1,
					grossMargin: 31.2,
					netMargin: 6.4,
					debtorDays: 38.7,
					creditorDays: 45.2,
					stockTurnover: null,
				},
			}),
		);
		const { fixture, page } = mount(RatiosPage, { ratios });
		await settle(fixture);
		expect(ratios).toHaveBeenCalledWith(accountsRange({ period: 'this_fy' }));
		expect(rows(fixture)).toEqual([
			['ratio_currentRatio', '1.8', 'ratio_currentRatio_means'],
			['ratio_quickRatio', '1.1', 'ratio_quickRatio_means'],
			['ratio_grossMargin', '31.2%', 'ratio_grossMargin_means'],
			['ratio_netMargin', '6.4%', 'ratio_netMargin_means'],
			['ratio_debtorDays', '39', 'ratio_debtorDays_means'],
			['ratio_creditorDays', '45', 'ratio_creditorDays_means'],
			['ratio_stockTurnover', '—', 'ratio_stockTurnover_means'],
			['ratio_debtEquity', '—', 'ratio_debtEquity_means'],
		]);
		page.setPeriod({ period: 'custom', from: '2026-10-01', to: '2026-10-31' });
		await settle(fixture);
		expect(ratios).toHaveBeenLastCalledWith({ from: '2026-10-01', to: '2026-10-31' });
	});

	it('says when the ratios cannot be read', async () => {
		const { fixture } = mount(RatiosPage, { ratios: vi.fn(() => throwError(() => new Error('down'))) });
		await settle(fixture);
		expect(alerts(fixture)).toEqual(['statement_problem']);
	});
});
