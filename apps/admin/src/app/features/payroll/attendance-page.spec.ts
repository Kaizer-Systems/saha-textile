import { ApplicationRef, CUSTOM_ELEMENTS_SCHEMA, TemplateRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { NEVER, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AttendanceGateway } from '@core/accounts/attendance.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { ExportMenu } from '@shared/ui/export-menu/export-menu';

import { AttendancePage, currentMonth } from './attendance-page';

import type { AttendanceDay, AttendanceMonthGrid } from '@saha-textile/contracts';

/**
 * Payroll › Attendance (brief 26 AT2, AT3): a store's month day by day, each person's totals, the reports in the
 * Export menu, Lock the month, and the day pop-up that saves a change or asks for it.
 */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const refusal = (code: string) => ({ error: { message: code } });
const IN_AT = '2026-11-02T04:42:00.000Z';
const OUT_AT = '2026-11-02T13:35:00.000Z';
const rec = (over: Partial<AttendanceDay>): AttendanceDay => ({
	id: `att_${over.day}`,
	employeeId: 'emp_1',
	day: '2026-11-02',
	locationId: 'loc_b',
	status: 'present',
	leaveKey: null,
	inAt: null,
	outAt: null,
	lateMinutes: 0,
	markedBy: null,
	changedBy: null,
	reason: null,
	pending: null,
	version: 1,
	...over,
});
type Person = AttendanceMonthGrid['people'][number];
const ASHA: Person = {
	employeeId: 'emp_1',
	name: 'Asha Das',
	days: [
		rec({ day: '2026-11-02', inAt: IN_AT, outAt: OUT_AT, lateMinutes: 12, markedBy: 'usr_1' }),
		rec({ day: '2026-11-03', status: 'absent', changedBy: 'adm_1' }),
		rec({ day: '2026-11-04', status: 'leave', leaveKey: 'CL', changedBy: 'adm_1' }),
		rec({
			day: '2026-11-05',
			inAt: IN_AT,
			markedBy: 'usr_1',
			pending: {
				status: 'leave',
				leaveKey: 'SL',
				inAt: null,
				outAt: null,
				reason: 'Was unwell',
				askedBy: 'adm_2',
				askedAt: '2026-11-06T06:00:00.000Z',
			},
		}),
		// A record nobody marked or set counts as not set.
		rec({ day: '2026-11-06', status: 'absent' }),
		rec({ day: '2026-11-09', status: 'incomplete', inAt: IN_AT, markedBy: 'usr_1' }),
		rec({ day: '2026-11-10', status: 'half', lateMinutes: 30, changedBy: 'adm_1' }),
	],
	paidDays: 22.5,
	leaveByType: { CL: 1, SL: 2 },
	withoutPay: 1,
	lateMarks: 2,
	unmarked: 3,
	// The days on her roll nobody marked, as the API names them; the 27th is still to come.
	unmarkedDays: ['2026-11-06', '2026-11-07', '2026-11-27'],
};
const RAFIQ: Person = {
	employeeId: 'emp_2',
	name: 'Rafiq Ali',
	days: [],
	paidDays: 26,
	leaveByType: {},
	withoutPay: 0,
	lateMarks: 0,
	unmarked: 0,
	unmarkedDays: [],
};
const grid = (over: Partial<AttendanceMonthGrid> = {}): AttendanceMonthGrid => ({
	month: '2026-11',
	locationId: 'loc_b',
	people: [ASHA, RAFIQ],
	offDays: ['2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29'],
	holidays: [{ day: '2026-11-14', name: 'Children’s Day' }],
	leaveTypes: [
		{ key: 'EL', name: 'Earned leave' },
		{ key: 'CL', name: 'Casual leave' },
	],
	lockedAt: null,
	...over,
});
const STORES = [
	{ id: 'loc_b', name: 'Barasat' },
	{ id: 'loc_s', name: 'Sodepur' },
];

interface Options {
	stores?: unknown;
	grid?: AttendanceMonthGrid | null;
	permissions?: string[];
	confirm?: boolean | 'dismissed';
	gateway?: Record<string, unknown>;
}

async function attendance(options: Options = {}) {
	TestBed.resetTestingModule();
	document.body.querySelectorAll('.att-test-modal').forEach((node) => node.remove());
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const asked: unknown[] = [];
	const refs: { close: ReturnType<typeof vi.fn>; dismiss: ReturnType<typeof vi.fn> }[] = [];
	const views: { detectChanges: () => void }[] = [];
	const gateway = {
		stores: vi.fn(() => (options.stores === null ? NEVER : of(options.stores ?? STORES))),
		grid: vi.fn((month: string, locationId: string) =>
			options.grid === null ? NEVER : of(options.grid ?? grid({ month, locationId })),
		),
		lock: vi.fn(() => of({})),
		change: vi.fn(() => of({})),
		...options.gateway,
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
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			provideRouter([]),
			{ provide: AttendanceGateway, useValue: gateway },
			{ provide: NotificationService, useValue: notifier },
			{
				provide: AuthStore,
				useValue: { permissions: signal(options.permissions ?? ['attendance.index', 'attendance.edit']) },
			},
			{
				provide: NgbModal,
				useValue: {
					open: vi.fn((content: unknown) => {
						const ref = { close: vi.fn(), dismiss: vi.fn() };
						if (!(content instanceof TemplateRef))
							return {
								componentInstance: { start: (ask: unknown) => asked.push(ask) },
								result:
									options.confirm === 'dismissed'
										? Promise.reject(new Error('dismissed'))
										: Promise.resolve(options.confirm ?? true),
							};
						refs.push(ref);
						const view = content.createEmbeddedView({ $implicit: ref });
						TestBed.inject(ApplicationRef).attachView(view);
						view.detectChanges();
						const holder = document.createElement('div');
						holder.className = 'att-test-modal';
						holder.append(...(view.rootNodes as Node[]));
						document.body.append(holder);
						views.push(view);
						return ref;
					}),
				},
			},
		],
	});
	// The Export menu is its own component; this page hands it the source.
	TestBed.overrideComponent(AttendancePage, {
		remove: { imports: [ExportMenu] },
		add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
	});
	const fixture = TestBed.createComponent(AttendancePage);
	fixture.detectChanges();
	// A month that never arrives keeps the page from going stable: wait a few turns instead.
	const wait =
		options.grid === null
			? async () => {
					for (let i = 0; i < 4; i++) {
						await new Promise((resolve) => setTimeout(resolve, 0));
						fixture.detectChanges();
					}
				}
			: () => settle(fixture);
	await wait();
	const redraw = async () => {
		views.at(-1)?.detectChanges();
		await new Promise((resolve) => setTimeout(resolve, 0));
		views.at(-1)?.detectChanges();
	};
	const find = <T extends HTMLElement = HTMLElement>(selector: string) =>
		fixture.nativeElement.querySelector(selector) as T | null;
	return {
		fixture,
		page: fixture.componentInstance,
		gateway,
		notifier,
		asked,
		refs,
		redraw,
		find,
		settle: wait,
	};
}

const inModal = <T extends HTMLElement = HTMLInputElement>(selector: string) =>
	[...document.querySelectorAll('.att-test-modal')].at(-1)?.querySelector(selector) as T | null;
const enter = async (redraw: () => Promise<void>, box: Element | null | undefined, value: string) => {
	(box as HTMLInputElement).value = value;
	box?.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
	await redraw();
};
const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim();

describe('the month in India', () => {
	it('is already the new month in the small hours of the 1st', () => {
		expect(currentMonth(new Date('2026-11-30T19:00:00.000Z'))).toBe('2026-12');
		expect(currentMonth(new Date('2026-11-30T18:00:00.000Z'))).toBe('2026-11');
	});
});

describe('Payroll › Attendance (AT2, AT3)', () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-26T06:00:00.000Z'));
	});
	afterEach(() => vi.useRealTimers());

	it('opens this month at the first store in the user’s charge, and reads another store or month on picking', async () => {
		const { page, gateway, find, settle } = await attendance();
		expect([page.month(), page.locationId()]).toEqual(['2026-11', 'loc_b']);
		expect(gateway.grid).toHaveBeenCalledWith('2026-11', 'loc_b');
		expect([...(find<HTMLSelectElement>('#att_store')?.options ?? [])].map((o) => [o.value, text(o)])).toEqual([
			['loc_b', 'Barasat'],
			['loc_s', 'Sodepur'],
		]);
		const store = find<HTMLSelectElement>('#att_store') as HTMLSelectElement;
		store.value = 'loc_s';
		store.dispatchEvent(new Event('change'));
		await settle();
		expect(gateway.grid).toHaveBeenLastCalledWith('2026-11', 'loc_s');
		// The first store is taken only while none is picked.
		expect(page.locationId()).toBe('loc_s');
		const month = find<HTMLInputElement>('#att_month') as HTMLInputElement;
		month.value = '2026-10';
		month.dispatchEvent(new Event('input'));
		await settle();
		expect(gateway.grid).toHaveBeenLastCalledWith('2026-10', 'loc_s');
		expect(page.days()).toHaveLength(31);
		const calls = gateway.grid.mock.calls.length;
		page.month.set('2026-1');
		await settle();
		expect([page.days(), gateway.grid.mock.calls.length]).toEqual([[], calls]);
	});

	it('reads no month without a store, and names a store it does not know by its id', async () => {
		const none = await attendance({ stores: [] });
		expect([none.page.locationId(), none.gateway.grid.mock.calls.length]).toEqual(['', 0]);
		expect(text(none.find('tbody td[colspan="31"]'))).toBe('payroll_no_employees');
		expect(none.page.exportSource()).toBeNull();
		const loading = await attendance({ stores: null });
		expect([loading.page.storeName('loc_b'), loading.page.unmarked(), loading.page.locked()]).toEqual([
			'loc_b',
			0,
			false,
		]);
		const read = await attendance();
		expect([read.page.storeName('loc_s'), read.page.storeName('loc_gone')]).toEqual(['Sodepur', 'loc_gone']);
	});

	it('shows each person’s day: a change waiting, their record, a holiday, a weekly off, or nothing', async () => {
		const { page, find } = await attendance();
		const cell = (day: string) => page.cell(ASHA, day);
		expect(cell('2026-11-02')).toEqual({
			day: '2026-11-02',
			letter: 'P',
			tone: 'bg-success',
			waiting: false,
			record: ASHA.days[0],
		});
		expect([cell('2026-11-03').letter, cell('2026-11-03').tone]).toEqual(['A', 'bg-danger']);
		expect([cell('2026-11-04').letter, cell('2026-11-04').tone]).toEqual(['CL', 'bg-info text-dark']);
		expect(cell('2026-11-05')).toEqual({
			day: '2026-11-05',
			letter: '?',
			tone: 'bg-light text-dark border border-warning',
			waiting: true,
			record: ASHA.days[3],
		});
		expect(cell('2026-11-06')).toEqual({ day: '2026-11-06', letter: '', tone: '', waiting: false, record: null });
		expect([cell('2026-11-09').letter, cell('2026-11-09').tone]).toEqual([
			'?',
			'bg-light text-dark border border-warning',
		]);
		expect([cell('2026-11-10').letter, cell('2026-11-10').tone]).toEqual(['½', 'bg-warning text-dark']);
		expect(cell('2026-11-14')).toEqual({
			day: '2026-11-14',
			letter: 'H',
			tone: 'bg-secondary',
			waiting: false,
			record: null,
		});
		expect([cell('2026-11-08').letter, cell('2026-11-08').tone]).toEqual(['WO', 'bg-light text-dark border']);
		const button = (day: string) => find(`#att_cell_emp_1_${day}`) as HTMLButtonElement;
		expect([button('2026-11-05').title, text(button('2026-11-05'))]).toEqual([
			'Asha Das · 2026-11-05 · att_waiting',
			'?',
		]);
		expect([button('2026-11-06').title, text(button('2026-11-06'))]).toEqual(['Asha Das · 2026-11-06', '·']);
		const classes = (day: string) => [...(button(day).querySelector('span')?.classList ?? [])].sort();
		expect(classes('2026-11-06')).toEqual(['badge', 'bg-light', 'border', 'text-muted']);
		expect(classes('2026-11-02')).toEqual(['badge', 'bg-success']);
		// Before the month is read, a day with no record is blank.
		const loading = await attendance({ grid: null });
		expect(loading.page.cell(RAFIQ, '2026-11-14').letter).toBe('');
	});

	it('totals each person: paid days, leave by type (a dash for none), without pay, late marks, not marked', async () => {
		const { page, find } = await attendance();
		expect([page.leaveLine(ASHA), page.leaveLine(RAFIQ)]).toEqual(['CL 1 · SL 2', '']);
		expect(text(find('#att_paid_emp_1'))).toBe('22.5');
		const rows = [...(find('#att_paid_emp_1')?.closest('tbody')?.querySelectorAll('tr') ?? [])] as HTMLElement[];
		expect(rows.map((r) => [...r.querySelectorAll('td')].map((td) => text(td)))).toEqual([
			['Asha Das', '22.5', 'CL 1 · SL 2', '1', '2', '3'],
			['Rafiq Ali', '26', '—', '0', '0', '0'],
		]);
		expect([page.unmarked(), page.dayNumber('2026-11-09')]).toEqual([3, 9]);
		expect(text(find('#att_month + select + small'))).toBe('att_month_open');
	});

	it('writes the month grid for the Export menu, or nothing before the month is read', async () => {
		const { page } = await attendance();
		const source = page.exportSource();
		expect(source).toMatchObject({
			fileName: 'attendance-grid-2026-11-loc_b',
			title: 'payroll_attendance: att_report_grid',
			area: 'accounts',
			filters: [
				{ label: 'att_month', value: '2026-11' },
				{ label: 'location', value: 'Barasat' },
			],
		});
		expect(source?.header).toEqual(['payroll_col_name', ...Array.from({ length: 30 }, (_, i) => String(i + 1))]);
		expect(source?.rows[0]?.slice(0, 11)).toEqual(['Asha Das', 'WO', 'P', 'A', 'CL', '?', '', '', 'WO', '?', '½']);
		expect(source?.rows[1]?.[14]).toBe('H');
		const loading = await attendance({ grid: null });
		expect(loading.page.exportSource()).toBeNull();
	});

	it('writes the late marks, the absences and the totals as their reports', async () => {
		const { page, find, settle } = await attendance();
		const report = find<HTMLSelectElement>('#att_report') as HTMLSelectElement;
		expect([...report.options].map((o) => o.value)).toEqual(['grid', 'late', 'absences', 'leave']);
		report.value = 'late';
		report.dispatchEvent(new Event('change'));
		await settle();
		expect(page.exportSource()).toMatchObject({
			fileName: 'attendance-late-2026-11-loc_b',
			header: ['payroll_col_name', 'date', 'att_in', 'att_late_minutes'],
			rows: [
				['Asha Das', '2026-11-02', '10:12', 12],
				['Asha Das', '2026-11-10', '', 30],
			],
		});
		page.report.set('absences');
		const absences = page.exportSource();
		expect(absences?.header).toEqual(['payroll_col_name', 'date', 'att_day']);
		// Days marked absent, and the days nobody marked up to today: none still to come or off the roll.
		expect(absences?.rows).toEqual([
			['Asha Das', '2026-11-03', 'att_status_absent'],
			['Asha Das', '2026-11-06', 'att_not_marked'],
			['Asha Das', '2026-11-07', 'att_not_marked'],
		]);
		page.report.set('leave');
		expect(page.exportSource()).toMatchObject({
			title: 'payroll_attendance: att_report_leave',
			header: [
				'payroll_col_name',
				'att_paid_days',
				'att_leave_by_type',
				'att_without_pay',
				'att_late_marks',
				'att_unmarked',
			],
			rows: [
				['Asha Das', 22.5, 'CL 1 · SL 2', 1, 2, 3],
				['Rafiq Ali', 26, '', 0, 0, 0],
			],
		});
	});

	it('locks the month once told the days nobody marked count absent, and does nothing when declined', async () => {
		const { page, gateway, notifier, asked, find, settle } = await attendance();
		find<HTMLButtonElement>('#att_lock')?.click();
		await settle();
		expect(asked).toEqual([
			{
				icon: 'ri-lock-line',
				title: 'att_lock_title',
				body: 'att_lock_unmarked',
				params: { n: 3 },
				yes: 'att_lock',
			},
		]);
		expect(gateway.lock).toHaveBeenCalledWith('2026-11');
		expect(notifier.showSuccess).toHaveBeenCalledWith('payroll_attendance_locked');
		expect(page.busy()).toBe(false);
		for (const confirm of [false, 'dismissed'] as const) {
			const declined = await attendance({ confirm });
			await declined.page.lock();
			expect([declined.asked.length, declined.gateway.lock.mock.calls.length]).toEqual([1, 0]);
		}
	});

	it('locks a month everyone marked without asking, and names a refusal', async () => {
		const marked = grid({ people: [RAFIQ] });
		const clean = await attendance({ grid: marked });
		await clean.page.lock();
		expect([clean.asked, clean.gateway.lock.mock.calls.length]).toEqual([[], 1]);
		const refused = await attendance({
			grid: marked,
			gateway: { lock: vi.fn(() => throwError(() => refusal('attendance_already_locked'))) },
		});
		await refused.page.lock();
		expect(refused.notifier.showError).toHaveBeenCalledWith('payroll_problem_attendance_already_locked');
		expect(refused.page.busy()).toBe(false);
	});

	it('offers no Lock on a locked month, nor to someone who may not edit, nor before the month is read', async () => {
		const locked = await attendance({ grid: grid({ lockedAt: '2026-12-01T06:00:00.000Z' }) });
		expect([locked.page.locked(), locked.find('#att_lock')]).toEqual([true, null]);
		expect(text(locked.find('#att_month + select + small'))).toBe('att_month_locked');
		const viewer = await attendance({ permissions: ['attendance.index'] });
		expect([viewer.page.mayEdit(), viewer.find('#att_lock')]).toEqual([false, null]);
		const loading = await attendance({ grid: null });
		expect(loading.find<HTMLButtonElement>('#att_lock')?.disabled).toBe(true);
	});

	it('opens a day with what it holds: a marked day’s times, a leave day’s type, a blank day as present', async () => {
		const { page, find, redraw } = await attendance();
		find<HTMLButtonElement>('#att_cell_emp_1_2026-11-02')?.click();
		await redraw();
		expect(page.form()).toEqual({
			person: ASHA,
			day: '2026-11-02',
			status: 'present',
			leaveKey: 'EL',
			inTime: '10:12',
			outTime: '19:05',
			reason: '',
			was: 'att_status_present',
		});
		expect(text(inModal('.modal-title'))).toBe('Asha Das · 2026-11-02 · att_status_present');
		expect([inModal('#att_day_in')?.value, inModal('#att_day_out')?.value]).toEqual(['10:12', '19:05']);
		expect(inModal('#att_day_leave')).toBeNull();
		find<HTMLButtonElement>('#att_cell_emp_1_2026-11-04')?.click();
		await redraw();
		expect(page.form()).toMatchObject({ status: 'leave', leaveKey: 'CL', inTime: '', outTime: '' });
		expect([...(inModal<HTMLSelectElement>('#att_day_leave')?.options ?? [])].map((o) => text(o))).toEqual([
			'Earned leave (EL)',
			'Casual leave (CL)',
		]);
		expect(inModal('#att_day_in')).toBeNull();
		expect(inModal('#att_day_status')?.parentElement?.className).toBe('col-6');
		find<HTMLButtonElement>('#att_cell_emp_1_2026-11-09')?.click();
		await redraw();
		expect(page.form()).toMatchObject({
			status: 'present',
			inTime: '10:12',
			outTime: '',
			was: 'att_status_incomplete',
		});
		// A blank day says what the grid shows: a holiday, a weekly off, or not marked.
		find<HTMLButtonElement>('#att_cell_emp_2_2026-11-14')?.click();
		await redraw();
		expect(page.form()).toMatchObject({ status: 'present', leaveKey: 'EL', was: 'att_status_holiday' });
		expect(inModal('#att_day_status')?.parentElement?.className).toBe('col-12');
		find<HTMLButtonElement>('#att_cell_emp_2_2026-11-08')?.click();
		await redraw();
		expect(page.form()?.was).toBe('att_status_weekly_off');
		find<HTMLButtonElement>('#att_cell_emp_2_2026-11-03')?.click();
		await redraw();
		expect(page.form()?.was).toBe('att_not_marked');
	});

	it('opens a day with no leave type where the store’s State has none', async () => {
		const { page, find, redraw } = await attendance({ grid: grid({ leaveTypes: [] }) });
		find<HTMLButtonElement>('#att_cell_emp_2_2026-11-03')?.click();
		await redraw();
		expect(page.form()?.leaveKey).toBe('');
	});

	it('opens a locked month’s day only for someone who may edit', async () => {
		const locked = grid({ lockedAt: '2026-12-01T06:00:00.000Z' });
		const manager = await attendance({ grid: locked, permissions: ['attendance.index'] });
		manager.find<HTMLButtonElement>('#att_cell_emp_1_2026-11-02')?.click();
		await manager.redraw();
		expect([manager.page.form(), manager.refs.length]).toEqual([null, 0]);
		const editor = await attendance({ grid: locked });
		editor.find<HTMLButtonElement>('#att_cell_emp_1_2026-11-02')?.click();
		await editor.redraw();
		expect([editor.page.form()?.day, editor.refs.length]).toEqual(['2026-11-02', 1]);
		// An open month opens for a manager too.
		const open = await attendance({ permissions: ['attendance.index'] });
		open.find<HTMLButtonElement>('#att_cell_emp_1_2026-11-02')?.click();
		await open.redraw();
		expect(open.refs.length).toBe(1);
	});

	it('saves a worked day’s times, a half day’s type with them, and a leave day’s type alone, for someone who may edit', async () => {
		const { page, find, redraw, gateway, notifier, refs } = await attendance();
		find<HTMLButtonElement>('#att_cell_emp_1_2026-11-02')?.click();
		await redraw();
		expect(text(inModal('.modal-body small.text-muted'))).toBe('att_edit_note');
		expect(inModal('.alert-warning')).toBeNull();
		const save = inModal<HTMLButtonElement>('#att_day_save') as HTMLButtonElement;
		expect([text(save), save.disabled]).toEqual(['save', true]);
		await enter(redraw, inModal('#att_day_in'), '10:00');
		await enter(redraw, inModal('#att_day_reason'), '  Phone was off  ');
		expect(save.disabled).toBe(false);
		save.click();
		await redraw();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(gateway.change).toHaveBeenLastCalledWith('emp_1', '2026-11-02', {
			status: 'present',
			leaveKey: null,
			inAt: '2026-11-02T04:30:00.000Z',
			outAt: OUT_AT,
			reason: 'Phone was off',
		});
		expect(notifier.showSuccess).toHaveBeenLastCalledWith('att_day_saved');
		expect(refs.at(-1)?.close).toHaveBeenCalled();
		await enter(redraw, inModal('#att_day_status'), 'half');
		expect(inModal<HTMLSelectElement>('#att_day_leave')).not.toBeNull();
		await enter(redraw, inModal('#att_day_leave'), 'CL');
		await enter(redraw, inModal('#att_day_out'), '');
		await page.saveDay();
		expect(gateway.change).toHaveBeenLastCalledWith('emp_1', '2026-11-02', {
			status: 'half',
			leaveKey: 'CL',
			inAt: '2026-11-02T04:30:00.000Z',
			outAt: null,
			reason: 'Phone was off',
		});
		page.setForm({ status: 'leave', leaveKey: '' });
		await page.saveDay();
		expect(gateway.change).toHaveBeenLastCalledWith('emp_1', '2026-11-02', {
			status: 'leave',
			leaveKey: null,
			inAt: null,
			outAt: null,
			reason: 'Phone was off',
		});
		page.setForm({ status: 'absent', leaveKey: 'CL' });
		await page.saveDay();
		expect(gateway.change).toHaveBeenLastCalledWith('emp_1', '2026-11-02', {
			status: 'absent',
			leaveKey: null,
			inAt: null,
			outAt: null,
			reason: 'Phone was off',
		});
		expect([page.needsLeave('weekly_off'), page.worked('holiday')]).toEqual([false, false]);
	});

	it('asks for the change, with its warning, for a manager; and names a refusal', async () => {
		const { page, find, redraw, gateway, notifier } = await attendance({
			permissions: ['attendance.index'],
			gateway: { change: vi.fn(() => of({})) },
		});
		find<HTMLButtonElement>('#att_cell_emp_1_2026-11-03')?.click();
		await redraw();
		expect(text(inModal('.alert-warning'))).toBe('att_ask_note');
		expect(text(inModal('#att_day_save'))).toBe('att_ask_change');
		page.setForm({ reason: 'Was at the bank for the shop' });
		await page.saveDay();
		expect(gateway.change).toHaveBeenCalledTimes(1);
		expect(notifier.showSuccess).toHaveBeenCalledWith('att_change_asked');
		gateway.change.mockReturnValueOnce(throwError(() => refusal('attendance_month_locked')));
		await page.saveDay();
		expect(notifier.showError).toHaveBeenCalledWith('payroll_problem_attendance_month_locked');
		expect(page.busy()).toBe(false);
	});

	it('saves nothing with no day open, and saves a day set without its pop-up', async () => {
		const { page, gateway, notifier } = await attendance();
		page.setForm({ reason: 'Nothing open' });
		await page.saveDay();
		expect([page.form(), gateway.change.mock.calls.length]).toEqual([null, 0]);
		page.form.set({
			person: RAFIQ,
			day: '2026-11-03',
			status: 'absent',
			leaveKey: '',
			inTime: '',
			outTime: '',
			reason: 'No call, no show',
			was: '',
		});
		await page.saveDay();
		expect([gateway.change.mock.calls.length, notifier.showSuccess.mock.calls.length]).toEqual([1, 1]);
	});
});
