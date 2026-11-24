import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { PayrollGateway } from '@core/accounts/payroll.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { AttendancePage, currentMonth } from './attendance-page';

/** Attendance and leave (accounts brief S8): paid days per person, locked before the payroll run. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const refusal = (code: string) => ({ error: { message: code } });

const ATTENDANCE = {
	month: '2026-11',
	daysInMonth: 30,
	rows: [
		{ employeeId: 'e1', paidDays: 30, leaveTaken: 0, note: '' },
		{ employeeId: 'e7', paidDays: 26, leaveTaken: 4, note: 'Sick' },
	],
	lockedAt: null,
	version: 2,
};

function mount(gateway: Record<string, unknown> = {}, permissions = ['accounts.index', 'accounts.edit']) {
	TestBed.resetTestingModule();
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const invalidate = vi.spyOn(queries, 'invalidateQueries');
	const calls = {
		attendance: vi.fn(() => of(ATTENDANCE)),
		employees: vi.fn(() => of([{ id: 'e1', name: 'Asha Das' }])),
		saveAttendance: vi.fn(() => of(ATTENDANCE)),
		...gateway,
	};
	TestBed.configureTestingModule({
		imports: [
			AttendancePage,
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
			{ provide: NotificationService, useValue: notifier },
			{ provide: AuthStore, useValue: { permissions: signal(permissions) } },
		],
	});
	const fixture = TestBed.createComponent(AttendancePage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, notifier, invalidate, calls };
}

async function attendance(gateway: Record<string, unknown> = {}, permissions?: string[]) {
	const harness = mount(gateway, permissions);
	await settle(harness.fixture);
	return harness;
}

const el = (fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as HTMLElement | null;
const inputs = (fixture: { nativeElement: HTMLElement }) =>
	[...fixture.nativeElement.querySelectorAll('tbody input')] as HTMLInputElement[];
const enter = (control: HTMLElement | null | undefined, value: string) => {
	(control as HTMLInputElement).value = value;
	(control as HTMLInputElement).dispatchEvent(new Event('input'));
};

describe('the month in India', () => {
	it('is already the new month in the small hours of the 1st', () => {
		expect(currentMonth(new Date('2026-11-30T19:00:00.000Z'))).toBe('2026-12');
		expect(currentMonth(new Date('2026-11-30T18:00:00.000Z'))).toBe('2026-11');
		expect(currentMonth()).toMatch(/^\d{4}-\d{2}$/);
	});
});

describe('the attendance page (S8)', () => {
	it('reads this month’s paid days, names each person (or shows their id), and saves the changes', async () => {
		const { fixture, page, calls, notifier, invalidate } = await attendance();
		expect(calls.attendance).toHaveBeenCalledWith(currentMonth());
		expect(page.rows()).toEqual(ATTENDANCE.rows);
		expect(page.rows()[0]).not.toBe(ATTENDANCE.rows[0]);
		const rows = [...fixture.nativeElement.querySelectorAll('tbody tr')] as HTMLElement[];
		expect(rows[0]?.textContent).toContain('Asha Das');
		expect(rows[1]?.textContent).toContain('e7');
		const [paid, leave, note] = inputs(fixture);
		enter(paid, '29');
		enter(leave, '1');
		enter(note, 'Half day on the 12th');
		expect(page.rows()[0]).toEqual({ employeeId: 'e1', paidDays: 29, leaveTaken: 1, note: 'Half day on the 12th' });
		expect(page.rows()[1]).toEqual(ATTENDANCE.rows[1]);
		(el(fixture, '#att_save') as HTMLButtonElement).click();
		await settle(fixture);
		expect(calls.saveAttendance).toHaveBeenCalledWith(currentMonth(), {
			rows: page.rows(),
			lock: false,
			version: 2,
		});
		expect(notifier.showSuccess).toHaveBeenCalledWith('payroll_attendance_saved');
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['payroll'] });
		(el(fixture, '#att_lock') as HTMLButtonElement).click();
		await settle(fixture);
		expect(calls.saveAttendance).toHaveBeenLastCalledWith(currentMonth(), expect.objectContaining({ lock: true }));
		expect(notifier.showSuccess).toHaveBeenLastCalledWith('payroll_attendance_locked');
		expect(page.busy()).toBe(false);
	});

	it('reads another month, and reads nothing for a month not filled in', async () => {
		const { fixture, page, calls } = await attendance();
		enter(el(fixture, '#att_month'), '2026-10');
		await settle(fixture);
		expect(calls.attendance).toHaveBeenLastCalledWith('2026-10');
		const reads = calls.attendance.mock.calls.length;
		enter(el(fixture, '#att_month'), '');
		await settle(fixture);
		expect(page.month()).toBe('');
		expect(calls.attendance).toHaveBeenCalledTimes(reads);
	});

	it('locks the inputs of a locked month, with no Save', async () => {
		const { fixture, page } = await attendance({
			attendance: vi.fn(() => of({ ...ATTENDANCE, lockedAt: '2026-12-01T05:30:00.000Z' })),
		});
		expect(page.locked()).toBe(true);
		expect(inputs(fixture).every((input) => input.disabled)).toBe(true);
		expect(el(fixture, '#att_save')).toBeNull();
		expect(el(fixture, '#att_lock')).toBeNull();
	});

	it('offers no Save to someone who may not edit, and says when no one is on the month', async () => {
		const reader = await attendance({}, ['accounts.index']);
		expect(el(reader.fixture, '#att_save')).toBeNull();
		const empty = await attendance({ attendance: vi.fn(() => of({ ...ATTENDANCE, rows: [] })) });
		expect(el(empty.fixture, 'tbody td[colspan]')).not.toBeNull();
	});

	it('saves version 0 when the month could not be read, and names a refusal or a failure', async () => {
		const saveAttendance = vi
			.fn()
			.mockReturnValueOnce(of(ATTENDANCE))
			.mockReturnValueOnce(throwError(() => refusal('payroll_attendance_locked')))
			.mockReturnValueOnce(throwError(() => new Error('down')));
		const { page, calls, notifier } = await attendance({
			attendance: vi.fn(() => throwError(() => new Error('gone'))),
			employees: vi.fn(() => of()),
			saveAttendance,
		});
		expect(page.name('e1')).toBe('e1');
		expect(page.rows()).toEqual([]);
		await page.save(false);
		expect(calls.saveAttendance).toHaveBeenCalledWith(currentMonth(), { rows: [], lock: false, version: 0 });
		await page.save(true);
		expect(notifier.showError).toHaveBeenLastCalledWith('payroll_problem_payroll_attendance_locked');
		await page.save(true);
		expect(notifier.showError).toHaveBeenLastCalledWith('payroll_problem_failed');
		expect(page.busy()).toBe(false);
	});
});
