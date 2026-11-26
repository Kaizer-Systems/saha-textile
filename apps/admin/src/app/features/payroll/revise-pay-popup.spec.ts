import { TestBed } from '@angular/core/testing';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { NEVER, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PayrollGateway } from '@core/accounts/payroll.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { RevisePayPopup, nextMonthStart } from './revise-pay-popup';

import type { EmployeeView, SalaryRevisionInputValue, SalaryRevisionPreview } from '@saha-textile/contracts';

/**
 * Revise pay (brief 26 SR2): four ways in, the breakup the API works out as it is typed, heads typed over, the
 * arrears and checks, a decrease's agreement, and Accept.
 */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const ASHA = {
	id: 'e1',
	name: 'Asha Das',
	structure: { basic: 16_000, da: 0, hra: 4_000, special: 2_000, conveyance: 0, other: 0 },
	ctcYearINR: 300_000,
} as unknown as EmployeeView;
const side = (gross: number) => ({
	structure: { basic: 0, da: 0, hra: 0, special: 0, conveyance: 0, other: 0 },
	grossINR: gross,
	employerINR: 2_000,
	ctcMonthINR: gross + 2_000,
	takeHomeINR: gross - 1_000,
});
const preview = (over: Partial<SalaryRevisionPreview> = {}): SalaryRevisionPreview => ({
	now: side(22_000),
	next: side(23_760),
	lines: [
		{ head: 'basic', nowINR: 16_000, nextINR: 17_280, changeINR: 1_280 },
		{ head: 'hra', nowINR: 4_000, nextINR: 4_320, changeINR: 320 },
	],
	changePct: 8,
	decrease: false,
	arrears: null,
	checks: [],
	...over,
});

function mount(gateway: Record<string, unknown> = {}) {
	TestBed.resetTestingModule();
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const active = { close: vi.fn(), dismiss: vi.fn() };
	const calls = {
		revisionPreview: vi.fn(() => of(preview())),
		reviseSalary: vi.fn(() => of({})),
		...gateway,
	};
	TestBed.configureTestingModule({
		imports: [
			RevisePayPopup,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: PayrollGateway, useValue: calls },
			{ provide: NotificationService, useValue: notifier },
			{ provide: NgbActiveModal, useValue: active },
		],
	});
	const fixture = TestBed.createComponent(RevisePayPopup);
	fixture.detectChanges();
	const find = <T extends HTMLElement = HTMLInputElement>(selector: string) =>
		fixture.nativeElement.querySelector(selector) as T | null;
	const enter = async (box: Element | null, value: string) => {
		(box as HTMLInputElement).value = value;
		box?.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
		await settle(fixture);
	};
	const pick = async (id: string) => {
		find(id)?.dispatchEvent(new Event('change'));
		await settle(fixture);
	};
	return { fixture, popup: fixture.componentInstance, gateway: calls, notifier, active, find, enter, pick };
}

const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim();
const lastInput = (gateway: { revisionPreview: ReturnType<typeof vi.fn> }) =>
	(gateway.revisionPreview.mock.lastCall as unknown as [string, SalaryRevisionInputValue])[1];

describe('the first day of next month in India', () => {
	it('is next month’s 1st, across the year’s end and already in India’s new day', () => {
		expect(nextMonthStart(new Date('2026-11-26T06:00:00.000Z'))).toBe('2026-12-01');
		expect(nextMonthStart(new Date('2026-12-10T06:00:00.000Z'))).toBe('2027-01-01');
		// 31 Dec, 19:00 UTC is already 1 January in India.
		expect(nextMonthStart(new Date('2026-12-31T19:00:00.000Z'))).toBe('2027-02-01');
	});
});

describe('Revise pay (SR2)', () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-26T06:00:00.000Z'));
	});
	afterEach(() => vi.useRealTimers());

	it('works nothing out, and accepts nothing, before it is given a person', async () => {
		const { fixture, popup, gateway } = mount();
		await settle(fixture);
		expect([popup.ready(), popup.blocking(), gateway.revisionPreview.mock.calls.length]).toEqual([false, false, 0]);
		await popup.accept();
		expect(gateway.reviseSalary).not.toHaveBeenCalled();
		expect(popup.preview.data()).toBeUndefined();
		// Read without a person, it asks for no one.
		await popup.preview.refetch();
		expect(gateway.revisionPreview).toHaveBeenCalledWith('', popup.input());
	});

	it('starts from the person’s CTC and heads, 8% from next month, and shows the breakup worked out', async () => {
		const { fixture, popup, gateway, find } = mount();
		popup.start(ASHA);
		await settle(fixture);
		expect([popup.ctcYear(), popup.heads()]).toEqual([300_000, ASHA.structure]);
		expect(popup.heads()).not.toBe(ASHA.structure);
		expect(gateway.revisionPreview).toHaveBeenCalledWith('e1', {
			way: { kind: 'percent', pct: 8 },
			from: '2026-12-01',
			typed: {},
			lockCtc: true,
			reason: 'Revision',
			agreed: false,
		});
		expect(text(find('#rev_title'))).toBe('rev_title');
		expect((find('#rev_new_basic') as HTMLInputElement).value).toBe('17280');
		const rows = [...(find('tbody')?.querySelectorAll('tr') ?? [])].map((tr) =>
			[...tr.querySelectorAll('td')].map((td) => text(td)),
		);
		expect(rows).toEqual([
			['payroll_head_basic', '16,000', '', '1,280'],
			['payroll_head_hra', '4,000', '', '320'],
			['rev_gross', '22,000', '23,760', '1,760'],
			['rev_employer', '2,000', '2,000', '0'],
			['rev_ctc', '24,000', '25,760', '1,760 (8%)'],
			['rev_take_home', '21,000', '22,760', '1,760'],
		]);
		expect(text(find('#rev_ctc_new'))).toBe('25,760');
		expect([find('#rev_arrears'), find('#rev_agreed'), find('.alert')]).toEqual([null, null, null]);
		expect(find('#rev_kind_percent')?.checked).toBe(true);
		expect([find('#rev_pct')?.disabled, find('#rev_amount')?.disabled, find('#rev_ctc')?.disabled]).toEqual([
			false,
			true,
			true,
		]);
	});

	it('takes a %, an amount a month or a year, a new CTC above nothing, or the heads themselves', async () => {
		const { fixture, popup, gateway, find, enter, pick } = mount();
		popup.start({ ...ASHA, ctcYearINR: undefined } as unknown as EmployeeView);
		await settle(fixture);
		expect(popup.ctcYear()).toBe(0);
		await enter(find('#rev_pct'), '10');
		expect(lastInput(gateway).way).toEqual({ kind: 'percent', pct: 10 });
		await pick('#rev_kind_amount');
		expect([popup.kind(), find('#rev_pct')?.disabled, find('#rev_amount')?.disabled]).toEqual([
			'amount',
			true,
			false,
		]);
		await enter(find('#rev_amount'), '1500');
		expect(lastInput(gateway).way).toEqual({ kind: 'amount', monthINR: 1_500 });
		await enter(find('#rev_per'), 'year');
		expect(lastInput(gateway).way).toEqual({ kind: 'amount', monthINR: 125 });
		await pick('#rev_kind_ctc');
		// A new CTC of nothing can't be worked out.
		expect(popup.ready()).toBe(false);
		await enter(find('#rev_ctc'), '360000');
		expect([popup.ready(), lastInput(gateway).way]).toEqual([true, { kind: 'ctc', yearINR: 360_000 }]);
		await pick('#rev_kind_heads');
		expect(lastInput(gateway)).toMatchObject({ way: { kind: 'heads', structure: ASHA.structure }, typed: {} });
		expect(find('#rev_lock')).toBeNull();
	});

	it('takes a head typed over the worked-out one, never below nothing, or sets the head itself head by head', async () => {
		const { fixture, popup, gateway, find, enter, pick } = mount();
		popup.start(ASHA);
		await settle(fixture);
		await enter(find('#rev_new_basic'), '18000');
		popup.setHead('hra', -50);
		popup.setHead('special', 'many');
		expect(popup.typed()).toEqual({ basic: 18_000, hra: 0, special: 0 });
		await settle(fixture);
		expect(lastInput(gateway).typed).toEqual({ basic: 18_000, hra: 0, special: 0 });
		const lock = find('#rev_lock') as HTMLInputElement;
		expect(lock.checked).toBe(true);
		lock.click();
		await settle(fixture);
		expect([popup.lockCtc(), lastInput(gateway).lockCtc]).toEqual([false, false]);
		// A new way starts with nothing typed over.
		await pick('#rev_kind_heads');
		expect(popup.typed()).toEqual({});
		popup.setHead('basic', '17500');
		expect([popup.heads().basic, popup.typed()]).toEqual([17_500, {}]);
		popup.typed.set({ basic: 1 });
		await settle(fixture);
		expect(lastInput(gateway).typed).toEqual({});
	});

	it('works nothing out for a day not yet whole', async () => {
		const { fixture, popup, find, enter } = mount();
		popup.start(ASHA);
		await settle(fixture);
		await enter(find('#rev_from'), '');
		expect(popup.ready()).toBe(false);
		await enter(find('#rev_from'), '2026-10-01');
		expect([popup.ready(), popup.input().from]).toEqual([true, '2026-10-01']);
	});

	it('shows the arrears and each check, a blocking one in red that stops Accept', async () => {
		const { fixture, popup, find } = mount({
			revisionPreview: vi.fn(() =>
				of(
					preview({
						arrears: { inr: 3_520, months: ['2026-10', '2026-11'], paidIn: '2026-12' },
						checks: [
							{ code: 'below_minimum_wage', blocking: true, inr: 450 },
							{ code: 'wages_under_half', blocking: false, inr: 0 },
						],
					}),
				),
			),
		});
		popup.start(ASHA);
		popup.reason.set('Annual increment');
		await settle(fixture);
		expect(text(find('#rev_arrears'))).toBe('3,520');
		expect(text(find('#rev_arrears')?.previousElementSibling)).toBe('rev_arrears');
		expect(find('#rev_check_below_minimum_wage')?.classList.contains('alert-danger')).toBe(true);
		expect(text(find('#rev_check_below_minimum_wage'))).toBe('rev_check_below_minimum_wage');
		expect(find('#rev_check_wages_under_half')?.classList.contains('alert-warning')).toBe(true);
		expect(find('#rev_check_wages_under_half')?.classList.contains('alert-danger')).toBe(false);
		expect([popup.blocking(), find<HTMLButtonElement>('#rev_accept')?.disabled]).toEqual([true, true]);
	});

	it('asks for the person’s agreement to a decrease, and sends it', async () => {
		const { fixture, popup, gateway, find } = mount({
			revisionPreview: vi.fn(() => of(preview({ decrease: true, changePct: -5 }))),
		});
		popup.start(ASHA);
		await settle(fixture);
		const agreed = find('#rev_agreed') as HTMLInputElement;
		expect(agreed.checked).toBe(false);
		agreed.click();
		await settle(fixture);
		expect([popup.agreed(), lastInput(gateway).agreed]).toEqual([true, true]);
		agreed.click();
		expect(popup.agreed()).toBe(false);
	});

	it('accepts only with a breakup read, nothing blocking and a reason of three letters or more', async () => {
		const { fixture, popup, gateway, notifier, active, find, enter } = mount();
		popup.start(ASHA);
		await settle(fixture);
		const accept = find<HTMLButtonElement>('#rev_accept') as HTMLButtonElement;
		expect(accept.disabled).toBe(true);
		await enter(find('#rev_why'), '  ok  ');
		expect(accept.disabled).toBe(true);
		await enter(find('#rev_why'), '  Annual increment  ');
		expect(accept.disabled).toBe(false);
		popup.busy.set(true);
		fixture.detectChanges();
		expect(accept.disabled).toBe(true);
		popup.busy.set(false);
		fixture.detectChanges();
		accept.click();
		await settle(fixture);
		expect(gateway.reviseSalary).toHaveBeenCalledWith('e1', {
			...popup.input(),
			reason: 'Annual increment',
		});
		expect(notifier.showSuccess).toHaveBeenCalledWith('rev_accepted');
		expect([active.close.mock.calls, popup.busy()]).toEqual([[[true]], false]);
	});

	it('names a refusal and stays open', async () => {
		const { fixture, popup, notifier, active } = mount({
			reviseSalary: vi.fn(() => throwError(() => ({ error: { message: 'revision_before_last' } }))),
		});
		popup.start(ASHA);
		popup.reason.set('Annual increment');
		await settle(fixture);
		await popup.accept();
		expect(notifier.showError).toHaveBeenCalledWith('payroll_problem_revision_before_last');
		expect([active.close.mock.calls.length, popup.busy()]).toEqual([0, false]);
	});

	it('holds Accept while the breakup is being worked out, and closes on the cross or Cancel', async () => {
		const { fixture, popup, active, find } = mount({ revisionPreview: vi.fn(() => NEVER) });
		popup.start(ASHA);
		popup.reason.set('Annual increment');
		await new Promise((resolve) => setTimeout(resolve, 0));
		fixture.detectChanges();
		expect([popup.preview.isFetching(), find<HTMLButtonElement>('#rev_accept')?.disabled]).toEqual([true, true]);
		expect(text(find('tbody'))).toBe('');
		find<HTMLButtonElement>('.btn-close')?.click();
		find<HTMLButtonElement>('.modal-footer .btn-outline')?.click();
		expect(active.dismiss).toHaveBeenCalledTimes(2);
	});

	it('holds Accept and dims the breakup while what is typed can’t be worked out, or only the last one shows', async () => {
		const { fixture, popup, gateway, find, enter, pick } = mount();
		popup.start({ ...ASHA, ctcYearINR: undefined } as unknown as EmployeeView);
		popup.reason.set('Annual increment');
		await settle(fixture);
		const accept = find<HTMLButtonElement>('#rev_accept') as HTMLButtonElement;
		const breakup = () => find<HTMLElement>('.table-responsive')?.classList.contains('opacity-50');
		expect([accept.disabled, breakup()]).toEqual([false, false]);
		// "To a CTC" with no figure: the % breakup stays, dimmed, and Accept waits.
		await pick('#rev_kind_ctc');
		expect([popup.ready(), popup.preview.data() !== undefined, accept.disabled, breakup()]).toEqual([
			false,
			true,
			true,
			true,
		]);
		await enter(find('#rev_ctc'), '360000');
		expect([accept.disabled, breakup()]).toEqual([false, false]);
		await enter(find('#rev_from'), '');
		expect([popup.ready(), accept.disabled, breakup()]).toEqual([false, true, true]);
		await enter(find('#rev_from'), '2026-12-01');
		expect([accept.disabled, breakup()]).toEqual([false, false]);
		// While a new figure is worked out, the last breakup shows dimmed.
		gateway.revisionPreview.mockReturnValue(NEVER);
		(find('#rev_ctc') as HTMLInputElement).value = '420000';
		find('#rev_ctc')?.dispatchEvent(new Event('input'));
		await new Promise((resolve) => setTimeout(resolve, 0));
		fixture.detectChanges();
		expect([popup.preview.isPlaceholderData(), accept.disabled, breakup()]).toEqual([true, true, true]);
	});
});
