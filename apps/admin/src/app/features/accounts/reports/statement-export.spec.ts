import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ReportsGateway } from '@core/accounts/reports.gateway';
import { LocationsGateway } from '@core/locations/locations.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { StatementPage, statementCsv } from './statement-page';

/** The profit and loss account through the Export menu (brief 25 EX1): named for the statement shown. */

const STATEMENT = {
	asAt: '2026-11-25',
	lastAsAt: null,
	code: 'PL-PROPRIETOR',
	name: 'Profit and loss (proprietorship)',
	version: 2,
	problems: [],
	rows: [{ key: 'income', label: 'Income', depth: 0, thisYearPaise: 12_000_000, lastYearPaise: null }],
};

describe('a profit and loss account for the Export menu (EX1)', () => {
	it('names the file and the title for the profit and loss account, with the statement’s own columns', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			imports: [
				StatementPage,
				TranslocoTestingModule.forRoot({
					langs: { en: { report_profit_loss: 'Profit and loss' } },
					translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
					preloadLangs: true,
				}),
			],
			providers: [
				provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
				provideRouter([]),
				provideHttpClient(),
				provideHttpClientTesting(),
				{ provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ kind: 'profitLoss' })) } },
				{ provide: ReportsGateway, useValue: { statement: vi.fn(() => of(STATEMENT)) } },
				{ provide: LocationsGateway, useValue: { list: vi.fn(() => of([])) } },
				{ provide: NotificationService, useValue: { showError: vi.fn(), showSuccess: vi.fn() } },
			],
		});
		TestBed.overrideComponent(StatementPage, { set: { template: '' } });
		const page = TestBed.createComponent(StatementPage).componentInstance;
		expect(page.kind()).toBe('profitLoss');
		const { header, rows } = statementCsv(STATEMENT as never);
		expect(page.exportSource(STATEMENT as never)()).toEqual({
			fileName: 'Profit and loss-2026-11-25',
			title: 'Profit and loss',
			header,
			rows,
			area: 'accounts',
		});
	});
});
