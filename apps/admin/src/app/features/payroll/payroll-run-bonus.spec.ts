import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { PayrollGateway } from '@core/accounts/payroll.gateway';
import { LocationsGateway } from '@core/locations/locations.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { currentMonth } from './attendance-page';
import { yearOf } from './employees-page';
import { PayrollRunPage } from './payroll-run-page';

/** The year's statutory bonus on Payroll › Payroll runs (brief 25 BN1): provided each month, paid once a year. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const refusal = (code: string) => ({ error: { message: code } });
const ALL = ['accounts.index', 'accounts.edit', 'accounts.lock', 'accounts.post'];

const person = (employeeId: string, name: string, providedPaise: number, duePaise: number) => ({
	employeeId,
	name,
	wagesPaise: 84_000_00,
	providedPaise,
	duePaise,
});
const BONUS = {
	year: '2026-27',
	ratePct: 8.33,
	rows: [person('e1', 'Asha Das', 7_000_00, 7_000_00), person('e2', 'Rafiq Ali', 4_200_00, 5_831_00)],
	providedPaise: 11_200_00,
	duePaise: 12_831_00,
	paidVoucherId: null,
};
const at = '2026-01-01T00:00:00.000Z';
const CHART = {
	groups: [
		{
			id: 'g_bank',
			systemKey: 'bank_accounts',
			parentId: null,
			name: 'Banks',
			nature: 'asset',
			order: 0,
			createdAt: at,
			updatedAt: at,
		},
	],
	ledgers: [{ id: 'hdfc', name: 'HDFC current', groupId: 'g_bank', active: true }],
};

function mount(gateway: Record<string, unknown> = {}, permissions = ALL) {
	TestBed.resetTestingModule();
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const invalidate = vi.spyOn(queries, 'invalidateQueries');
	const calls = {
		run: vi.fn(() =>
			of({ month: '2026-11', status: 'paid', rows: [], version: 1, voucherId: 'jv1', payVoucherId: 'pv1' }),
		),
		attendance: vi.fn(() => of({ lockedAt: '2026-12-01T05:30:00.000Z' })),
		bonusYear: vi.fn(() => of(BONUS)),
		payBonus: vi.fn(() => of({ ...BONUS, paidVoucherId: 'bv1' })),
		...gateway,
	};
	TestBed.configureTestingModule({
		imports: [
			PayrollRunPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(queries),
			provideRouter([]),
			{ provide: PayrollGateway, useValue: calls },
			{ provide: LedgerGateway, useValue: { chart: vi.fn(() => of(CHART)) } },
			{ provide: LocationsGateway, useValue: { list: vi.fn(() => of([])) } },
			{ provide: NotificationService, useValue: notifier },
			{ provide: AuthStore, useValue: { permissions: signal(permissions) } },
		],
	});
	const fixture = TestBed.createComponent(PayrollRunPage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, notifier, invalidate, calls };
}

async function opened(gateway: Record<string, unknown> = {}, permissions?: string[]) {
	const harness = mount(gateway, permissions);
	await settle(harness.fixture);
	return harness;
}

const el = <T extends HTMLElement = HTMLElement>(fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as T | null;
const enter = (control: Element | null, value: string) => {
	const box = control as HTMLInputElement;
	box.value = value;
	box.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
};

describe('the year’s statutory bonus on the payroll run (BN1)', () => {
	it('reads the bonus of the month’s financial year, and reads the new year when the month moves', async () => {
		const { fixture, page, calls } = await opened();
		expect(page.bonusYearLabel()).toBe(yearOf(currentMonth()));
		expect(calls.bonusYear).toHaveBeenCalledWith(yearOf(currentMonth()));
		enter(el(fixture, '#run_month'), '2027-04');
		await settle(fixture);
		expect(page.bonusYearLabel()).toBe('2027-28');
		expect(calls.bonusYear).toHaveBeenLastCalledWith('2027-28');
	});

	it('shows the year’s totals, each person still short, and the bank and day to pay from', async () => {
		const { fixture, page } = await opened();
		const card = el(fixture, '#run_bonus') as HTMLElement;
		expect(card.querySelector('h6')?.textContent).toContain('payroll_bonus_title');
		expect(card.querySelector('p')?.textContent).toContain('payroll_bonus_totals');
		expect(page.bonusShort().map((s) => s.employeeId)).toEqual(['e2']);
		expect([...card.querySelectorAll('small.text-warning')]).toHaveLength(1);
		expect(card.querySelector('a')).toBeNull();
		const bank = el<HTMLSelectElement>(fixture, '#run_bonus_bank') as HTMLSelectElement;
		expect([...bank.options].map((o) => [o.value, o.textContent?.trim()])).toEqual([
			['', 'payroll_paid_from'],
			['hdfc', 'HDFC current'],
		]);
		expect(el<HTMLInputElement>(fixture, '#run_bonus_day')?.value).toBe(page.bonusPaidOn());
		expect(el<HTMLButtonElement>(fixture, '#run_bonus_pay')?.disabled).toBe(true);
	});

	it('pays it only with a bank and a day, says so, and reads payroll again', async () => {
		const { fixture, page, calls, notifier, invalidate } = await opened();
		const pay = () => el<HTMLButtonElement>(fixture, '#run_bonus_pay') as HTMLButtonElement;
		enter(el(fixture, '#run_bonus_bank'), 'hdfc');
		enter(el(fixture, '#run_bonus_day'), '');
		fixture.detectChanges();
		expect([page.bonusBank(), pay().disabled]).toEqual(['hdfc', true]);
		enter(el(fixture, '#run_bonus_day'), '2027-04-07');
		fixture.detectChanges();
		expect(pay().disabled).toBe(false);
		pay().click();
		await settle(fixture);
		expect(calls.payBonus).toHaveBeenCalledWith(yearOf(currentMonth()), {
			bankLedgerId: 'hdfc',
			paidOn: '2027-04-07',
		});
		expect(notifier.showSuccess).toHaveBeenCalledWith('payroll_bonus_paid');
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['payroll'] });
		expect(page.busy()).toBe(false);
	});

	it('names a refusal to pay, or says it simply failed', async () => {
		const payBonus = vi
			.fn()
			.mockReturnValueOnce(throwError(() => refusal('payroll_bonus_paid_already')))
			.mockReturnValueOnce(throwError(() => new Error('down')));
		const { page, notifier } = await opened({ payBonus });
		await page.payBonus();
		expect(notifier.showError).toHaveBeenLastCalledWith('payroll_problem_payroll_bonus_paid_already');
		await page.payBonus();
		expect(notifier.showError).toHaveBeenLastCalledWith('payroll_problem_failed');
		expect(page.busy()).toBe(false);
	});

	it('links to the payment once paid, with nobody short', async () => {
		const paid = {
			...BONUS,
			rows: [person('e1', 'Asha Das', 7_000_00, 7_000_00)],
			paidVoucherId: 'bv1',
		};
		const { fixture, page } = await opened({ bonusYear: vi.fn(() => of(paid)) });
		expect(el(fixture, '#run_bonus a[href="/accounts/vouchers/bv1"]')?.textContent).toContain('payroll_bonus_view');
		expect(el(fixture, '#run_bonus_bank')).toBeNull();
		expect(page.bonusShort()).toEqual([]);
		expect(el(fixture, '#run_bonus small.text-warning')).toBeNull();
	});

	it('offers paying only to someone who may post', async () => {
		const { fixture } = await opened({}, ['accounts.index', 'accounts.edit']);
		expect(el(fixture, '#run_bonus')).not.toBeNull();
		expect(el(fixture, '#run_bonus_pay')).toBeNull();
	});

	it('has no bonus card for a year with nobody on it, nor before the year is read', async () => {
		const empty = await opened({ bonusYear: vi.fn(() => of({ ...BONUS, rows: [] })) });
		expect(el(empty.fixture, '#run_bonus')).toBeNull();
		const unread = await opened({ bonusYear: vi.fn(() => throwError(() => new Error('down'))) });
		expect(el(unread.fixture, '#run_bonus')).toBeNull();
		expect(unread.page.bonusShort()).toEqual([]);
	});
});
