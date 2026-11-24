import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { BanksGateway } from '@core/accounts/banks.gateway';

import { BrsPage } from './brs-page';

/** The bank reconciliation statement (accounts brief BA9). */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};

const statement = (over: Record<string, unknown> = {}) => ({
	asAt: '2026-11-28',
	bookPaise: 53_206_900,
	rows: [
		{
			kind: 'unpresented',
			paise: 4_500_000,
			items: [{ date: '2026-11-20', text: 'PV/7 · Cheque 000416 Haritala Estates', paise: 4_500_000 }],
		},
		{
			kind: 'bank_out',
			paise: -1_200_000,
			items: [{ date: '2026-11-27', text: 'NEFT DR NADIA WEAVERS', paise: -1_200_000 }],
		},
		{ kind: 'before_start', paise: 0, items: [] },
	],
	computedPaise: 56_506_900,
	statementPaise: 56_506_900,
	startsOn: '2026-11-01',
	...over,
});

function mount(brs: ReturnType<typeof statement>, id = 'bank_1') {
	TestBed.resetTestingModule();
	const gateway = { one: vi.fn(() => of({ shortName: 'HDFC · Barasat' })), brs: vi.fn(() => of(brs)) };
	TestBed.configureTestingModule({
		imports: [
			BrsPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient()),
			provideRouter([]),
			{ provide: BanksGateway, useValue: gateway },
			{ provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap(id ? { id } : {})) } },
		],
	});
	const fixture = TestBed.createComponent(BrsPage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, gateway };
}

describe('the bank reconciliation statement page (BA9)', () => {
	it('goes from the books to the bank, item by item, with a tick when they agree, as at the day chosen', async () => {
		const { fixture, page, gateway } = mount(statement());
		await settle(fixture);
		const text = fixture.nativeElement.textContent as string;
		expect(text).toContain('₹5,32,069.00 Dr');
		expect(text).toContain('PV/7 · Cheque 000416 Haritala Estates');
		expect(text).toContain('−₹12,000.00');
		expect(text).toContain('✓');
		expect((fixture.nativeElement.querySelector('#bank_brs_result') as HTMLElement).className).toContain(
			'text-success',
		);
		page.asAt.set('2026-11-20');
		await settle(fixture);
		expect(gateway.brs).toHaveBeenLastCalledWith('bank_1', '2026-11-20');
		const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
		(fixture.nativeElement.querySelector('#bank_brs_print') as HTMLButtonElement).click();
		expect(print).toHaveBeenCalled();
		page.asAt.set('');
		expect(page.day('2026-11-28')).toBe('28 Nov 2026');
	});

	it('says when the statements show something else, and when none is imported yet', async () => {
		const differs = mount(statement({ statementPaise: 56_506_000 }));
		await settle(differs.fixture);
		expect(differs.fixture.nativeElement.textContent).toContain('bank_brs_differs');
		expect((differs.fixture.nativeElement.querySelector('#bank_brs_result') as HTMLElement).className).toContain(
			'text-danger',
		);
		const none = mount(statement({ rows: [], statementPaise: null }));
		await settle(none.fixture);
		expect(none.fixture.nativeElement.textContent).toContain('bank_brs_none');
		const noId = mount(statement(), '');
		expect(noId.page.id()).toBe('');
	});
});
