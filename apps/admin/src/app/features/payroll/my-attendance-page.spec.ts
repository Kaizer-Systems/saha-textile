import { ApplicationRef, TemplateRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { NEVER, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AttendanceGateway } from '@core/accounts/attendance.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { MyAttendancePage } from './my-attendance-page';

import type { AttendanceDay, MyAttendance } from '@saha-textile/contracts';

/**
 * My attendance (brief 26 AT1): on the person's own phone, Mark in and Mark out, the month so far, the leave left,
 * asking for leave, and the month's days.
 */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const WORDS = {
	att_present_n: '{{ n }} present',
	att_in_at: 'In at {{ time }}',
	att_in_out: 'In {{ in }}, out {{ out }}',
	att_shift: 'Shift {{ start }} to {{ end }}',
	att_late: '{{ n }} min late',
	att_notice: 'Ask {{ n }} days ahead',
	att_left_n: '{{ n }} left',
};
const IN_AT = '2026-11-26T04:42:00.000Z';
const OUT_AT = '2026-11-26T13:35:00.000Z';
const day = (over: Partial<AttendanceDay> = {}): AttendanceDay => ({
	id: 'att_1',
	employeeId: 'emp_1',
	day: '2026-11-26',
	locationId: 'loc_b',
	status: 'incomplete',
	leaveKey: null,
	inAt: null,
	outAt: null,
	lateMinutes: 0,
	markedBy: 'adm_9',
	changedBy: null,
	reason: null,
	pending: null,
	version: 1,
	...over,
});
const ME: MyAttendance = {
	employeeId: 'emp_1',
	name: 'Asha Das',
	locationId: 'loc_b',
	locationName: 'Barasat',
	today: '2026-11-26',
	shift: { start: '10:00', end: '19:00' },
	day: null,
	present: 2.5,
	leaveByType: { CL: 2 },
	leave: [
		{ key: 'EL', name: 'Earned leave', left: 0, halfDays: false, noticeDays: 15 },
		{ key: 'CL', name: 'Casual leave', left: 5.5, halfDays: true, noticeDays: null },
		{ key: 'ML', name: 'Maternity leave', left: null, halfDays: false, noticeDays: null },
	],
};

/** The server: the person's day as the last mark left it. */
function server(start: Partial<MyAttendance> = {}) {
	const now = { day: start.day ?? null };
	return {
		me: vi.fn(() => of({ ...ME, ...start, day: now.day })),
		markIn: vi.fn(() => {
			now.day = day({ inAt: IN_AT, lateMinutes: 12 });
			return of(now.day);
		}),
		markOut: vi.fn(() => {
			now.day = day({ inAt: IN_AT, outAt: OUT_AT, status: 'present', lateMinutes: 12 });
			return of(now.day);
		}),
		myMonth: vi.fn(() =>
			of([
				day({ id: 'd1', day: '2026-11-24', status: 'present', inAt: IN_AT, outAt: OUT_AT }),
				day({
					id: 'd2',
					day: '2026-11-25',
					status: 'leave',
					leaveKey: 'CL',
					pending: {
						status: 'present',
						leaveKey: null,
						inAt: null,
						outAt: null,
						reason: 'Came in after all',
						askedBy: 'adm_2',
						askedAt: '2026-11-25T12:00:00.000Z',
					},
				}),
			]),
		),
		askLeave: vi.fn(() => of([])),
	};
}

async function myAttendance(gateway: Record<string, unknown> = server()) {
	TestBed.resetTestingModule();
	document.body.querySelectorAll('.my-att-test-modal').forEach((node) => node.remove());
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const refs: { close: ReturnType<typeof vi.fn>; dismiss: ReturnType<typeof vi.fn> }[] = [];
	const views: { detectChanges: () => void }[] = [];
	TestBed.configureTestingModule({
		imports: [
			MyAttendancePage,
			TranslocoTestingModule.forRoot({
				langs: { en: WORDS },
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
				provide: NgbModal,
				useValue: {
					open: vi.fn((content: TemplateRef<unknown>) => {
						const ref = { close: vi.fn(), dismiss: vi.fn() };
						refs.push(ref);
						if (!(content instanceof TemplateRef)) return ref;
						const view = content.createEmbeddedView({ $implicit: ref });
						TestBed.inject(ApplicationRef).attachView(view);
						view.detectChanges();
						const holder = document.createElement('div');
						holder.className = 'my-att-test-modal';
						holder.append(...(view.rootNodes as Node[]));
						document.body.append(holder);
						views.push(view);
						return ref;
					}),
				},
			},
		],
	});
	const fixture = TestBed.createComponent(MyAttendancePage);
	fixture.detectChanges();
	await settle(fixture);
	const redraw = async () => {
		views.at(-1)?.detectChanges();
		await new Promise((resolve) => setTimeout(resolve, 0));
		views.at(-1)?.detectChanges();
	};
	const find = <T extends HTMLElement = HTMLElement>(selector: string) =>
		fixture.nativeElement.querySelector(selector) as T | null;
	return { fixture, page: fixture.componentInstance, redraw, find, notifier, refs, settle: () => settle(fixture) };
}

const inModal = <T extends HTMLElement = HTMLInputElement>(selector: string) =>
	[...document.querySelectorAll('.my-att-test-modal')].at(-1)?.querySelector(selector) as T | null;
const enter = async (redraw: () => Promise<void>, box: Element | null | undefined, value: string) => {
	(box as HTMLInputElement).value = value;
	box?.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
	await redraw();
};
const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim();

describe('My attendance (AT1)', () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-26T06:00:00.000Z'));
	});
	afterEach(() => vi.useRealTimers());

	it('names the person, their store and today, and the month and leave left so far', async () => {
		const { page, find } = await myAttendance();
		expect(text(find('#att_me_name'))).toBe('Asha Das · Barasat');
		expect(text(find('#att_me_name + small'))).toBe(page.dayName('2026-11-26'));
		expect(page.dayName('2026-11-26')).toMatch(/^Thu, 26 Nov,? 2026$/);
		expect([page.monthLine(), text(find('#att_month_line'))]).toEqual(['2.5 present · 2 CL', '2.5 present · 2 CL']);
		// Maternity is given on request: no balance to show.
		expect([page.leaveLine(), text(find('#att_leave_line'))]).toEqual(['EL 0 · CL 5.5', 'EL 0 · CL 5.5']);
		expect(text(find('#att_today'))).toBe('att_not_in');
		expect(text(find('#att_today + small'))).toBe('Shift 10:00 to 19:00');
	});

	it('shows a dash for leave left when no type keeps a balance, and asks for none without a type', async () => {
		const { find } = await myAttendance(server({ leave: [], leaveByType: {} }));
		expect(text(find('#att_month_line'))).toBe('2.5 present');
		expect(text(find('#att_leave_line'))).toBe('—');
		expect(find<HTMLButtonElement>('#att_ask')?.disabled).toBe(true);
	});

	it('marks in, then out, at the server’s time, and then shows the day’s status', async () => {
		const gateway = server();
		const { page, find, settle } = await myAttendance(gateway);
		expect(page.state()).toBe('out');
		expect(text(find('#att_mark'))).toBe('att_mark_in');
		find<HTMLButtonElement>('#att_mark')?.click();
		expect(page.busy()).toBe(true);
		await settle();
		expect(gateway.markIn).toHaveBeenCalledTimes(1);
		expect([page.state(), page.busy()]).toEqual(['in', false]);
		expect(text(find('#att_today'))).toBe('In at 10:12');
		expect(text(find('#att_today + small'))).toBe('Shift 10:00 to 19:00 · 12 min late');
		expect(text(find('#att_mark'))).toBe('att_mark_out');
		find<HTMLButtonElement>('#att_mark')?.click();
		await settle();
		expect([gateway.markOut.mock.calls.length, page.state()]).toEqual([1, 'done']);
		expect(text(find('#att_today'))).toBe('In 10:12, out 19:05');
		expect(find('#att_mark')).toBeNull();
		expect(text(find('.badge.bg-success'))).toBe('att_status_present');
		expect(page.time(OUT_AT)).toBe('19:05');
	});

	it('says why a mark was refused', async () => {
		const gateway = {
			...server(),
			markIn: vi.fn(() => throwError(() => ({ error: { message: 'attendance_already_in' } }))),
		};
		const { page, notifier } = await myAttendance(gateway);
		await page.mark();
		expect(notifier.showError).toHaveBeenCalledWith('payroll_problem_attendance_already_in');
		expect([page.state(), page.busy()]).toEqual(['out', false]);
	});

	it('says why the page can’t show, such as a login with no employee, and nothing while it loads', async () => {
		const refused = await myAttendance({
			...server(),
			me: vi.fn(() => throwError(() => ({ error: { message: 'attendance_no_employee' } }))),
		});
		expect(refused.page.problem()).toBe('attendance_no_employee');
		expect(text(refused.find('#att_problem'))).toBe('payroll_problem_attendance_no_employee');
		expect(refused.find('#att_me_name')).toBeNull();
		const loading = await myAttendance({ ...server(), me: vi.fn(() => NEVER) });
		expect([
			loading.page.problem(),
			loading.page.state(),
			loading.page.monthLine(),
			loading.page.leaveLine(),
		]).toEqual(['', 'out', '', '']);
		expect([loading.find('#att_problem'), loading.find('#att_me_name')]).toEqual([null, null]);
	});

	it('lists the month’s days on its button, each with its letter, times and a change waiting', async () => {
		const gateway = server();
		const { page, find, settle } = await myAttendance(gateway);
		expect(gateway.myMonth).not.toHaveBeenCalled();
		find<HTMLButtonElement>('#att_my_days')?.click();
		await settle();
		expect(gateway.myMonth).toHaveBeenCalledWith('2026-11');
		const rows = [...(find('thead')?.closest('table')?.querySelectorAll('tbody tr') ?? [])].slice(
			-2,
		) as HTMLElement[];
		expect(rows.map((r) => [...r.querySelectorAll('td')].map((td) => text(td)))).toEqual([
			[page.dayName('2026-11-24'), 'P', '10:12', '19:05'],
			[page.dayName('2026-11-25'), 'CL att_waiting', '—', '—'],
		]);
		expect(page.letter(day({ status: 'half' }))).toBe('½');
		find<HTMLButtonElement>('#att_my_days')?.click();
		await settle();
		expect(page.showDays()).toBe(false);
	});

	it('says so when the month has no days yet', async () => {
		const { find, settle } = await myAttendance({ ...server(), myMonth: vi.fn(() => of([])) });
		find<HTMLButtonElement>('#att_my_days')?.click();
		await settle();
		expect(text(find('td[colspan="4"]'))).toBe('att_no_days');
	});

	it('reads no month before the person is known', async () => {
		const gateway = { ...server(), me: vi.fn(() => NEVER) };
		const { page } = await myAttendance(gateway);
		await page.days.refetch();
		expect(gateway.myMonth).toHaveBeenCalledWith('');
	});

	it('asks for leave from today on the first type, with its balance and notice', async () => {
		const { find, redraw, page } = await myAttendance();
		find<HTMLButtonElement>('#att_ask')?.click();
		await redraw();
		expect(page.ask()).toEqual({ leaveKey: 'EL', from: '2026-11-26', to: '2026-11-26', half: false, reason: '' });
		const options = [...(inModal<HTMLSelectElement>('#att_ask_type')?.options ?? [])].map((o) => [
			o.value,
			text(o),
		]);
		expect(options).toEqual([
			['EL', 'Earned leave (EL) · 0 left'],
			['CL', 'Casual leave (CL) · 5.5 left'],
			['ML', 'Maternity leave (ML) · att_no_balance'],
		]);
		expect(text(inModal('#att_ask_type + small'))).toBe('Ask 15 days ahead');
		expect(inModal('#att_ask_half')).toBeNull();
		await enter(redraw, inModal('#att_ask_type'), 'CL');
		expect(page.askType()?.key).toBe('CL');
		expect(inModal('#att_ask_type + small')).toBeNull();
		expect(inModal('#att_ask_half')).not.toBeNull();
	});

	it('keeps the dates in order, and a half day to one day', async () => {
		const { find, redraw, page } = await myAttendance();
		find<HTMLButtonElement>('#att_ask')?.click();
		await redraw();
		await enter(redraw, inModal('#att_ask_type'), 'CL');
		await enter(redraw, inModal('#att_ask_to'), '2026-12-04');
		await enter(redraw, inModal('#att_ask_from'), '2026-12-02');
		expect([page.ask().from, page.ask().to]).toEqual(['2026-12-02', '2026-12-04']);
		// A later "from" moves "to" with it; an earlier "to" is taken as "from".
		await enter(redraw, inModal('#att_ask_from'), '2026-12-06');
		expect(page.ask().to).toBe('2026-12-06');
		await enter(redraw, inModal('#att_ask_to'), '2026-12-01');
		expect(page.ask().to).toBe('2026-12-06');
		await enter(redraw, inModal('#att_ask_to'), '2026-12-08');
		(inModal('#att_ask_half') as HTMLInputElement).click();
		await redraw();
		expect([page.ask().half, page.ask().to, inModal('#att_ask_to')?.disabled]).toEqual([true, '2026-12-06', true]);
		(inModal('#att_ask_half') as HTMLInputElement).click();
		await redraw();
		expect([page.ask().half, inModal('#att_ask_to')?.disabled]).toEqual([false, false]);
		await enter(redraw, inModal('#att_ask_reason'), 'Sister’s wedding');
		expect(page.ask().reason).toBe('Sister’s wedding');
	});

	it('sends the ask, says it went, and closes; or says why it was refused', async () => {
		const gateway = server();
		const { find, redraw, page, notifier, refs } = await myAttendance(gateway);
		find<HTMLButtonElement>('#att_ask')?.click();
		await redraw();
		await enter(redraw, inModal('#att_ask_type'), 'CL');
		inModal<HTMLButtonElement>('#att_ask_send')?.click();
		await redraw();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(gateway.askLeave).toHaveBeenCalledWith({
			leaveKey: 'CL',
			from: '2026-11-26',
			to: '2026-11-26',
			half: false,
			reason: '',
		});
		expect(notifier.showSuccess).toHaveBeenCalledWith('att_leave_asked');
		expect(refs.at(-1)?.close).toHaveBeenCalled();
		gateway.askLeave.mockReturnValueOnce(throwError(() => ({ error: { message: 'leave_not_enough' } })));
		await page.sendAsk();
		expect(notifier.showError).toHaveBeenCalledWith('payroll_problem_leave_not_enough');
		expect(page.busy()).toBe(false);
		// Send waits for a type.
		page.setAsk({ leaveKey: '' });
		await redraw();
		expect(inModal<HTMLButtonElement>('#att_ask_send')?.disabled).toBe(true);
	});

	it('starts an ask with no type while the person is not known or has no types, and sends with no pop-up open', async () => {
		const loading = await myAttendance({ ...server(), me: vi.fn(() => NEVER) });
		loading.page.openAsk({} as TemplateRef<unknown>);
		expect([loading.page.ask().leaveKey, loading.page.askType()]).toEqual(['', null]);
		const gateway = server({ leave: [] });
		const known = await myAttendance(gateway);
		await known.page.sendAsk();
		expect([gateway.askLeave.mock.calls.length, known.notifier.showSuccess.mock.calls.length]).toEqual([1, 1]);
		known.page.openAsk({} as TemplateRef<unknown>);
		expect(known.page.ask().leaveKey).toBe('');
	});
});
