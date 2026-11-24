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
import { PAYROLL_STEPS, PayrollRunPage, payingFrom, payrollStepIcon, payrollTotals } from './payroll-run-page';

/** A month's payroll run (accounts brief S5): prepared, approved, posted and paid. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const refusal = (code: string) => ({ error: { message: code } });
const ALL = ['accounts.index', 'accounts.edit', 'accounts.lock', 'accounts.post'];

const row = (employeeId: string, over: Record<string, unknown> = {}) => ({
	employeeId,
	name: 'Asha Das',
	locationId: 'l1',
	paidDays: 30,
	grossPaise: 3_200_000,
	pfEmployeePaise: 192_000,
	esiEmployeePaise: 0,
	ptPaise: 20_000,
	tdsPaise: 0,
	advancePaise: 100_000,
	netPaise: 2_888_000,
	...over,
});
const ROWS = [
	row('e1'),
	row('e2', {
		name: 'Rafiq Ali',
		locationId: 'l9',
		paidDays: 26,
		grossPaise: 1_500_000,
		pfEmployeePaise: 0,
		esiEmployeePaise: 11_250,
		ptPaise: 13_000,
		tdsPaise: 5_000,
		advancePaise: 0,
		netPaise: 1_470_750,
	}),
];
const run = (status: string, over: Record<string, unknown> = {}) => ({
	month: '2026-11',
	status,
	rows: ROWS,
	version: 3,
	voucherId: null,
	payVoucherId: null,
	...over,
});
const at = '2026-01-01T00:00:00.000Z';
const group = (id: string, systemKey: string | null, parentId: string | null = null) => ({
	id,
	systemKey,
	parentId,
	name: id,
	nature: 'asset',
	order: 0,
	createdAt: at,
	updatedAt: at,
});
const CHART = {
	groups: [
		group('g_cash', 'cash_in_hand'),
		group('g_bank', 'bank_accounts'),
		group('g_branch', null, 'g_bank'),
		group('g_od', 'bank_od'),
		group('g_cred', 'sundry_creditors'),
		group('g_loose', null),
	],
	ledgers: [
		{ id: 'cash', name: 'Cash', groupId: 'g_cash' },
		{ id: 'hdfc', name: 'HDFC current', groupId: 'g_branch', active: true },
		{ id: 'od', name: 'SBI overdraft', groupId: 'g_od' },
		{ id: 'old', name: 'Old bank', groupId: 'g_bank', active: false },
		{ id: 'nadia', name: 'Nadia Weavers', groupId: 'g_cred' },
		{ id: 'loose', name: 'Loose', groupId: 'g_loose' },
		{ id: 'orphan', name: 'Orphan', groupId: 'g_missing' },
	],
};

function mount(
	gateway: Record<string, unknown> = {},
	options: { permissions?: string[]; locked?: string | null } = {},
) {
	TestBed.resetTestingModule();
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const invalidate = vi.spyOn(queries, 'invalidateQueries');
	const calls = {
		run: vi.fn(() => of(run('draft'))),
		attendance: vi.fn(() =>
			of({ lockedAt: options.locked === undefined ? '2026-12-01T05:30:00.000Z' : options.locked }),
		),
		prepare: vi.fn(() => of(run('draft'))),
		step: vi.fn(() => of(run('approved'))),
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
			{
				provide: LocationsGateway,
				useValue: { list: vi.fn(() => of([{ id: 'l1', name: 'Barasat', active: true }])) },
			},
			{ provide: NotificationService, useValue: notifier },
			{ provide: AuthStore, useValue: { permissions: signal(options.permissions ?? ALL) } },
		],
	});
	const fixture = TestBed.createComponent(PayrollRunPage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, notifier, invalidate, calls };
}

async function payroll(gateway: Record<string, unknown> = {}, options: Parameters<typeof mount>[1] = {}) {
	const harness = mount(gateway, options);
	await settle(harness.fixture);
	return harness;
}

const el = (fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as HTMLElement | null;
const all = (fixture: { nativeElement: HTMLElement }, selector: string) =>
	[...fixture.nativeElement.querySelectorAll(selector)] as HTMLElement[];
const enter = (control: HTMLElement | null, value: string) => {
	const box = control as HTMLInputElement;
	box.value = value;
	box.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
};
const stepIcons = (fixture: { nativeElement: HTMLElement }) =>
	all(fixture, 'i')
		.filter((i) => /ri-(checkbox|time)/.test(i.className))
		.map((i) => i.className);

describe('a run’s steps, totals and the ledgers pay leaves from', () => {
	it('marks the steps passed, the next one, and those to come', () => {
		expect([...PAYROLL_STEPS]).toEqual(['draft', 'approved', 'posted', 'paid']);
		expect([0, 1, 2].map((i) => payrollStepIcon('draft', i))).toEqual([
			'ri-checkbox-circle-line text-success',
			'ri-time-line text-warning',
			'ri-checkbox-blank-circle-line text-muted',
		]);
		expect(payrollStepIcon('paid', 3)).toBe('ri-checkbox-circle-line text-success');
	});

	it('adds up every money column', () => {
		expect(payrollTotals(ROWS as never)).toEqual({
			gross: 4_700_000,
			pf: 192_000,
			esi: 11_250,
			pt: 33_000,
			tds: 5_000,
			advance: 100_000,
			net: 4_358_750,
		});
		expect(payrollTotals([])).toEqual({ gross: 0, pf: 0, esi: 0, pt: 0, tds: 0, advance: 0, net: 0 });
	});

	it('pays only from active cash, bank and overdraft ledgers, however deep', () => {
		expect(payingFrom(CHART as never)).toEqual([
			{ id: 'cash', name: 'Cash' },
			{ id: 'hdfc', name: 'HDFC current' },
			{ id: 'od', name: 'SBI overdraft' },
		]);
	});
});

describe('the payroll run page (S5)', () => {
	it('offers to prepare a month with no run, Draft next, and links to attendance while it is not locked', async () => {
		const { fixture, page, calls, notifier, invalidate } = await payroll(
			{ run: vi.fn(() => of(null)) },
			{ locked: null },
		);
		expect(calls.run).toHaveBeenCalledWith(currentMonth());
		expect(stepIcons(fixture)[0]).toContain('ri-time-line');
		expect(el(fixture, 'a[href="/payroll/attendance"]')).not.toBeNull();
		expect(fixture.nativeElement.textContent).toContain('payroll_run_none');
		expect(fixture.nativeElement.textContent).not.toContain('payroll_total');
		expect(el(fixture, '#run_approve')).toBeNull();
		expect(page.totals().net).toBe(0);
		(el(fixture, '#run_prepare') as HTMLButtonElement).click();
		await settle(fixture);
		expect(calls.prepare).toHaveBeenCalledWith(currentMonth());
		expect(notifier.showSuccess).toHaveBeenCalledWith('payroll_run_prepared');
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['payroll'] });
	});

	it('shows a draft’s people and totals, prepares it again, and lets someone who may lock approve it', async () => {
		const { fixture, page, calls, notifier } = await payroll();
		expect(fixture.nativeElement.textContent).toContain('payroll_status_draft');
		expect(fixture.nativeElement.textContent).toContain('payroll_attendance_locked_on');
		expect(stepIcons(fixture).slice(0, 2)).toEqual([
			'ri-checkbox-circle-line text-success',
			'ri-time-line text-warning',
		]);
		const rows = all(fixture, 'tbody tr');
		expect(rows[0]?.textContent).toContain('Barasat');
		expect(rows[2]?.textContent).toContain('payroll_total');
		expect(rows[2]?.textContent).toContain('₹43,587.50');
		expect(page.locationName('l9')).toBe('');
		expect(el(fixture, '#run_prepare')).not.toBeNull();
		(el(fixture, '#run_approve') as HTMLButtonElement).click();
		await settle(fixture);
		expect(calls.step).toHaveBeenCalledWith(currentMonth(), { to: 'approved', version: 3 });
		expect(notifier.showSuccess).toHaveBeenCalledWith('payroll_run_approved');
		expect(page.day('2026-12-01T05:30:00.000Z')).toBeTruthy();
	});

	it('cannot approve a draft with no one on it, nor without accounts.lock', async () => {
		const empty = await payroll({ run: vi.fn(() => of(run('draft', { rows: [] }))) });
		expect((el(empty.fixture, '#run_approve') as HTMLButtonElement).disabled).toBe(true);
		const accountant = await payroll({}, { permissions: ['accounts.index', 'accounts.edit', 'accounts.post'] });
		expect(el(accountant.fixture, '#run_approve')).toBeNull();
	});

	it('posts an approved run, and prepares it no more', async () => {
		const { fixture, calls, notifier } = await payroll({ run: vi.fn(() => of(run('approved'))) });
		expect(el(fixture, '#run_prepare')).toBeNull();
		(el(fixture, '#run_post') as HTMLButtonElement).click();
		await settle(fixture);
		expect(calls.step).toHaveBeenCalledWith(currentMonth(), { to: 'posted', version: 3 });
		expect(notifier.showSuccess).toHaveBeenCalledWith('payroll_run_posted');
	});

	it('marks a posted run paid from the bank picked, on the day given', async () => {
		const { fixture, page, calls } = await payroll({
			run: vi.fn(() => of(run('posted', { voucherId: 'jv7' }))),
		});
		expect(all(fixture, '#run_bank option').map((o) => (o as HTMLOptionElement).value)).toEqual([
			'',
			'cash',
			'hdfc',
			'od',
		]);
		const pay = el(fixture, '#run_pay') as HTMLButtonElement;
		expect(pay.disabled).toBe(true);
		enter(el(fixture, '#run_bank'), 'hdfc');
		enter(el(fixture, '#run_paid_on'), '2026-12-01');
		await settle(fixture);
		expect(pay.disabled).toBe(false);
		pay.click();
		await settle(fixture);
		expect(calls.step).toHaveBeenCalledWith(currentMonth(), {
			to: 'paid',
			version: 3,
			bankLedgerId: 'hdfc',
			paidOn: '2026-12-01',
		});
		expect(el(fixture, 'a[href="/accounts/vouchers/jv7"]')).not.toBeNull();
		page.bankLedgerId.set('');
		page.paidOn.set('');
		await page.step(run('posted') as never, 'paid');
		expect(calls.step).toHaveBeenLastCalledWith(currentMonth(), {
			to: 'paid',
			version: 3,
			bankLedgerId: null,
			paidOn: null,
		});
	});

	it('shows a paid run with both its vouchers and no more steps', async () => {
		const { fixture } = await payroll({
			run: vi.fn(() => of(run('paid', { voucherId: 'jv7', payVoucherId: 'pv3' }))),
		});
		expect(el(fixture, 'a[href="/accounts/vouchers/jv7"]')).not.toBeNull();
		expect(el(fixture, 'a[href="/accounts/vouchers/pv3"]')).not.toBeNull();
		expect(stepIcons(fixture).every((icon) => icon.includes('text-success'))).toBe(true);
		for (const id of ['#run_prepare', '#run_approve', '#run_post', '#run_pay']) expect(el(fixture, id)).toBeNull();
	});

	it('reads another month, and nothing for a month not filled in', async () => {
		const { fixture, page, calls } = await payroll();
		enter(el(fixture, '#run_month'), '2026-10');
		await settle(fixture);
		expect(calls.run).toHaveBeenLastCalledWith('2026-10');
		const reads = calls.run.mock.calls.length;
		enter(el(fixture, '#run_month'), '');
		await settle(fixture);
		expect(page.month()).toBe('');
		expect(calls.run).toHaveBeenCalledTimes(reads);
	});

	it('names a refusal, says when it simply failed, and has no banks before the chart is read', async () => {
		const prepare = vi
			.fn()
			.mockReturnValueOnce(throwError(() => refusal('payroll_attendance_not_locked')))
			.mockReturnValueOnce(throwError(() => new Error('down')));
		const { page, notifier } = await payroll({ prepare });
		await page.prepare();
		expect(notifier.showError).toHaveBeenLastCalledWith('payroll_problem_payroll_attendance_not_locked');
		await page.prepare();
		expect(notifier.showError).toHaveBeenLastCalledWith('payroll_problem_failed');
		expect(page.busy()).toBe(false);
		const fresh = mount();
		expect(fresh.page.banks()).toEqual([]);
	});
});
