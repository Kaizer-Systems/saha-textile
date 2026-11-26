import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { YearCloseGateway } from '@core/accounts/year-close.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { YearClosePage, checkIcon, lastEndedYear, yearChoices, yearLabel } from './year-close-page';

/** Close the year (accounts brief T3): the ten checks, the closing entries, and the year locked. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const refusal = (code: string) => ({ error: { message: code } });
const ALL = ['accounts.index', 'accounts.post', 'accounts.lock'];

const check = (key: string, state: string, over: Record<string, unknown> = {}) => ({
	key,
	state,
	count: 0,
	of: null,
	amountPaise: null,
	...over,
});
/** A year being prepared: every kind of line the page draws. */
const OPEN = {
	year: '2025-26',
	from: '2025-04-01',
	to: '2026-03-31',
	checks: [
		check('cash', 'ok'),
		check('banks', 'attention', { count: 1, of: 3 }),
		check('stock_count', 'attention', { count: 2, of: 5 }),
		check('transfers', 'attention', { count: 3 }),
		check('depreciation', 'not_in_use'),
		check('payroll', 'ok'),
		check('gst', 'ok', { count: 12, of: 12 }),
		check('suspense', 'warning', { amountPaise: 50_000 }),
		check('accruals', 'attention'),
		check('closing', 'ok', { count: 1 }),
	],
	done: 4,
	canPostClosing: true,
	canClose: false,
	closingVoucherId: null,
	profitPaise: 1_234_500,
	suspenseNote: null,
	accrualsConfirmedAt: null,
	closedAt: null,
	closedBy: null,
};
/** A closed year: suspense carried with a note, the closing posted. */
const CLOSED = {
	...OPEN,
	checks: [
		check('stock_count', 'ok', { of: 5 }),
		check('suspense', 'ok'),
		check('accruals', 'ok'),
		check('closing', 'attention'),
	],
	done: 10,
	canPostClosing: false,
	canClose: true,
	closingVoucherId: 'jv99',
	profitPaise: null,
	suspenseNote: 'Carried: unknown UPI credit, reconciled in April',
	closedAt: '2026-05-10T06:00:00.000Z',
	closedBy: 'u1',
};

function mount(gateway: Record<string, unknown> = {}, options: { year?: string; permissions?: string[] } = {}) {
	TestBed.resetTestingModule();
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const invalidate = vi.spyOn(queries, 'invalidateQueries');
	const calls = {
		view: vi.fn(() => of(OPEN)),
		confirm: vi.fn(() => of(OPEN)),
		postClosing: vi.fn(() => of(OPEN)),
		close: vi.fn(() => of(CLOSED)),
		...gateway,
	};
	TestBed.configureTestingModule({
		imports: [
			YearClosePage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(queries),
			provideRouter([]),
			{ provide: YearCloseGateway, useValue: calls },
			{ provide: NotificationService, useValue: notifier },
			{ provide: AuthStore, useValue: { permissions: signal(options.permissions ?? ALL) } },
			{
				provide: ActivatedRoute,
				useValue: { queryParamMap: of(convertToParamMap(options.year ? { year: options.year } : {})) },
			},
		],
	});
	const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
	const fixture = TestBed.createComponent(YearClosePage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, notifier, invalidate, navigate, calls };
}

async function yearClose(gateway: Record<string, unknown> = {}, options: Parameters<typeof mount>[1] = {}) {
	const harness = mount(gateway, options);
	await settle(harness.fixture);
	return harness;
}

const el = (fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as HTMLElement | null;
const lines = (fixture: { nativeElement: HTMLElement }) =>
	[...fixture.nativeElement.querySelectorAll('.card-body > div.border-bottom')] as HTMLElement[];
const enter = (control: Element | null | undefined, value: string) => {
	const box = control as HTMLInputElement;
	box.value = value;
	box.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
};
const button = (row: HTMLElement | undefined) => row?.querySelector('button') as HTMLButtonElement | null;

describe('financial years', () => {
	it('labels a year by its two calendar years', () => {
		expect([yearLabel(2025), yearLabel(1999), yearLabel(2009)]).toEqual(['2025-26', '1999-00', '2009-10']);
	});

	it('takes the last year that has ended in India, turning over on 1 April', () => {
		expect(lastEndedYear(new Date('2027-03-31T17:30:00.000Z'))).toBe('2025-26');
		expect(lastEndedYear(new Date('2027-03-31T19:00:00.000Z'))).toBe('2026-27');
		expect(lastEndedYear(new Date('2026-11-24T06:00:00.000Z'))).toBe('2025-26');
		expect(lastEndedYear()).toMatch(/^\d{4}-\d{2}$/);
	});

	it('offers the year running now and the three before it', () => {
		expect(yearChoices(new Date('2026-11-24T06:00:00.000Z'))).toEqual(['2026-27', '2025-26', '2024-25', '2023-24']);
		expect(yearChoices()).toHaveLength(4);
	});

	it('draws each check as done, needing doing, a warning or not in use', () => {
		expect(['ok', 'attention', 'warning', 'not_in_use'].map((s) => checkIcon(s as never))).toEqual([
			'ri-checkbox-circle-line text-success',
			'ri-close-circle-line text-danger',
			'ri-error-warning-line text-warning',
			'ri-checkbox-blank-circle-line text-muted',
		]);
	});
});

describe('the year close page (T3)', () => {
	it('opens the last ended year, showing what each check still has open', async () => {
		const { fixture, page, calls } = await yearClose();
		expect(calls.view).toHaveBeenCalledWith(lastEndedYear());
		expect(page.years).toEqual(yearChoices());
		const rows = lines(fixture);
		expect(rows).toHaveLength(10);
		const right = (i: number) => rows[i]?.querySelector('small.text-end')?.textContent?.trim();
		expect(right(0)).toBe('✓');
		expect(right(1)).toContain('year_close_n_of');
		expect(rows[2]?.textContent).toContain('year_close_counts_open');
		expect(right(2)).toContain('year_close_counts_posted');
		expect(right(3)).toContain('year_close_n_open');
		expect(right(4)).toContain('year_close_not_in_use');
		expect(right(6)).toContain('year_close_n_of');
		expect(right(7)).toBe('₹500.00');
		expect(rows[7]?.querySelector('input')).not.toBeNull();
		expect(button(rows[8])?.textContent).toContain('year_close_confirm_accruals');
		expect(rows[9]?.textContent).toContain('year_close_closing_stale');
		expect(right(9)).toContain('year_close_profit_to');
		expect(rows[0]?.querySelector('i')?.className).toContain('text-success');
		expect(fixture.nativeElement.textContent).toContain('year_close_done');
		expect((el(fixture, '#yc_post') as HTMLButtonElement).disabled).toBe(false);
		expect((el(fixture, '#yc_close') as HTMLButtonElement).disabled).toBe(true);
		expect(el(fixture, 'a[href^="/accounts/vouchers/"]')).toBeNull();
	});

	it('shows a closed year with its carried suspense note, its closing voucher and nothing left to do', async () => {
		const { fixture } = await yearClose({ view: vi.fn(() => of(CLOSED)) }, { year: '2024-25' });
		const rows = lines(fixture);
		const right = (i: number) => rows[i]?.querySelector('small.text-end')?.textContent?.trim();
		expect(rows[0]?.textContent).not.toContain('year_close_counts_open');
		expect(right(1)).toBe('✓');
		expect(rows[1]?.textContent).toContain('Carried: unknown UPI credit');
		expect(rows[1]?.querySelector('input')).toBeNull();
		expect(button(rows[2])).toBeNull();
		expect(rows[3]?.textContent).not.toContain('year_close_closing_stale');
		expect(right(3)).toBe('—');
		expect(el(fixture, 'a[href="/accounts/vouchers/jv99"]')).not.toBeNull();
		expect(fixture.nativeElement.textContent).toContain('year_close_closed');
		expect((el(fixture, '#yc_post') as HTMLButtonElement).disabled).toBe(true);
		expect((el(fixture, '#yc_close') as HTMLButtonElement).disabled).toBe(false);
	});

	it('opens the year asked for and moves to the year picked', async () => {
		const { fixture, calls, navigate } = await yearClose({}, { year: '2024-25' });
		expect(calls.view).toHaveBeenCalledWith('2024-25');
		enter(el(fixture, '#yc_year'), '2023-24');
		expect(navigate).toHaveBeenCalledWith([], { queryParams: { year: '2023-24' } });
	});
});

describe('closing a year', () => {
	it('confirms the accruals, carries the suspense with a note of five or more, posts the closing entries and closes', async () => {
		const { fixture, page, calls, notifier, invalidate } = await yearClose({}, { year: '2025-26' });
		const rows = lines(fixture);
		button(rows[8])?.click();
		await settle(fixture);
		expect(calls.confirm).toHaveBeenCalledWith('2025-26', { accruals: true });
		expect(notifier.showSuccess).toHaveBeenLastCalledWith('year_close_saved');
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['accounts', 'year-close', '2025-26'] });
		const carry = button(lines(fixture)[7]) as HTMLButtonElement;
		enter(lines(fixture)[7]?.querySelector('input'), 'UPI');
		fixture.detectChanges();
		expect(carry.disabled).toBe(true);
		enter(lines(fixture)[7]?.querySelector('input'), 'Unknown UPI credit, reconciled in April');
		fixture.detectChanges();
		expect(carry.disabled).toBe(false);
		carry.click();
		await settle(fixture);
		expect(calls.confirm).toHaveBeenLastCalledWith('2025-26', {
			suspenseNote: 'Unknown UPI credit, reconciled in April',
		});
		(el(fixture, '#yc_post') as HTMLButtonElement).click();
		await settle(fixture);
		expect(calls.postClosing).toHaveBeenCalledWith('2025-26');
		expect(notifier.showSuccess).toHaveBeenLastCalledWith('year_close_posted');
		await page.close();
		expect(calls.close).toHaveBeenCalledWith('2025-26');
		expect(notifier.showSuccess).toHaveBeenLastCalledWith('year_close_closed');
		expect(page.busy()).toBe(false);
	});

	it('names a refusal, says when it simply failed, and is ready again', async () => {
		const close = vi
			.fn()
			.mockReturnValueOnce(throwError(() => refusal('year_close_checks_open')))
			.mockReturnValueOnce(throwError(() => new Error('down')));
		const { page, notifier } = await yearClose({ close });
		await page.close();
		expect(notifier.showError).toHaveBeenLastCalledWith('year_close_problem_year_close_checks_open');
		await page.close();
		expect(notifier.showError).toHaveBeenLastCalledWith('year_close_problem_failed');
		expect(page.busy()).toBe(false);
	});

	it('offers posting and closing only to those who may, and has no checks before the year is read', async () => {
		const accountant = await yearClose({}, { permissions: ['accounts.index', 'accounts.post'] });
		expect(el(accountant.fixture, '#yc_post')).not.toBeNull();
		expect(el(accountant.fixture, '#yc_close')).toBeNull();
		const reader = await yearClose({}, { permissions: ['accounts.index'] });
		expect(el(reader.fixture, '#yc_post')).toBeNull();
		expect(button(lines(reader.fixture)[8])).toBeNull();
		const unread = mount({ view: vi.fn(() => of()) });
		expect(unread.page.checks()).toEqual([]);
	});
});
