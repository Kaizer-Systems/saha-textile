import { ApplicationRef, TemplateRef, signal, type EmbeddedViewRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { WEST_BENGAL_LEAVE } from '@saha-textile/core-domain/payroll-rules';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PayrollGateway } from '@core/accounts/payroll.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { PayrollRulesPage, startingForm, stateToForm, stateToWrite, type StateForm } from './payroll-rules-page';

import type { PayrollRulesVersion, StatePayrollRules } from '@saha-textile/contracts';

/**
 * Leave per State in Payroll rules (brief 26 LV1, LV2): each State's leave types, West Bengal's starting set, each
 * type's rules with their conditions, and Try it.
 */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
type LeaveTypes = NonNullable<StatePayrollRules['leaveTypes']>;
const WB = WEST_BENGAL_LEAVE as unknown as LeaveTypes;
const EVERYONE = structuredClone((WB[1] as LeaveTypes[number]).rules[0]);
/** Maharashtra's own leave: one type kept for sales staff and managers, with the rule for everyone else last. */
const MH_TYPES = [
	{
		key: 'PL',
		name: 'Privilege leave',
		paid: 'full',
		active: true,
		rules: [
			{ ...EVERYONE, when: { department: 'Sales' } },
			{ ...EVERYONE, when: { designation: 'Manager' } },
			EVERYONE,
		],
	},
	{ key: 'T3', name: '', paid: 'unpaid', active: false, rules: [EVERYONE] },
] as unknown as LeaveTypes;

const state = (stateCode: string, over: Partial<StatePayrollRules> = {}): StatePayrollRules => ({
	stateCode,
	ptFrequency: 'monthly',
	ptSlabs: [{ upToPaise: null, taxPaise: 20_000 }],
	ptMonths: [],
	ptDueDay: 21,
	lwfEmployeePaise: 300,
	lwfEmployerPaise: 1_500,
	lwfMonths: [6, 12],
	lwfDueDay: 15,
	...over,
});
const version = (states: StatePayrollRules[]) =>
	({
		id: 'v5',
		from: '2026-04-01',
		note: '',
		builtIn: false,
		createdBy: null,
		createdAt: '2026-01-01T00:00:00.000Z',
		pfRatePct: 12,
		pfWageCapPaise: 1_500_000,
		epsRatePct: 8.33,
		epsCapPaise: 1_500_000,
		esiEmployeePct: 0.75,
		esiEmployerPct: 3.25,
		esiGrossLimitPaise: 2_100_000,
		ptSlabs: [{ upToPaise: null, taxPaise: 20_000 }],
		maxDeductionPct: 50,
		pfAdminPct: 0.5,
		pfAdminMinPaise: 50_000,
		edliPct: 0.5,
		pfHeadcount: 20,
		esiHeadcount: 10,
		bonusHeadcount: 20,
		bonusWarnAt: 18,
		gratuityHeadcount: 10,
		gratuityDaysPerYear: 15,
		gratuityMonthDays: 26,
		lwfEmployeePaise: 300,
		lwfEmployerPaise: 1_500,
		lwfMonths: [6, 12],
		pfDueDay: 15,
		esiDueDay: 15,
		ptDueDay: 21,
		lwfDueDay: 15,
		states,
	}) as unknown as PayrollRulesVersion;

/** The rules page with the pop-up open; `words` gives some keys their English, to read the figures in them. */
async function editing(words: Record<string, string> = {}) {
	TestBed.resetTestingModule();
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	document.body.querySelectorAll('.lv-test-modal').forEach((node) => node.remove());
	const views: EmbeddedViewRef<unknown>[] = [];
	TestBed.configureTestingModule({
		imports: [
			PayrollRulesPage,
			TranslocoTestingModule.forRoot({
				langs: { en: words },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			provideRouter([]),
			{
				provide: PayrollGateway,
				useValue: {
					rules: vi.fn(() => of([version([state('19'), state('27', { leaveTypes: MH_TYPES })])])),
					addRules: vi.fn(),
				},
			},
			{ provide: NotificationService, useValue: notifier },
			{ provide: AuthStore, useValue: { permissions: signal(['accounts.index', 'accounts.lock']) } },
			{
				provide: NgbModal,
				useValue: {
					open: vi.fn((content: TemplateRef<unknown>) => {
						const ref = { close: vi.fn(), dismiss: vi.fn() };
						const view = content.createEmbeddedView({ $implicit: ref });
						TestBed.inject(ApplicationRef).attachView(view);
						view.detectChanges();
						const holder = document.createElement('div');
						holder.className = 'lv-test-modal';
						holder.append(...(view.rootNodes as Node[]));
						document.body.append(holder);
						views.push(view);
						return ref;
					}),
				},
			},
		],
	});
	const fixture = TestBed.createComponent(PayrollRulesPage);
	fixture.detectChanges();
	await settle(fixture);
	(fixture.nativeElement.querySelector('#rules_add') as HTMLButtonElement).click();
	const redraw = async () => {
		views[0]?.detectChanges();
		await new Promise((resolve) => setTimeout(resolve, 0));
		views[0]?.detectChanges();
	};
	await redraw();
	return { page: fixture.componentInstance, redraw, notifier };
}

const modal = <T extends HTMLElement = HTMLElement>(selector: string) =>
	document.querySelector(`.lv-test-modal ${selector}`) as T | null;
const enter = async (redraw: () => Promise<void>, box: Element | null | undefined, value: string) => {
	(box as HTMLInputElement).value = value;
	box?.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
	await redraw();
};
const pickAt = async (redraw: () => Promise<void>, box: Element | null, index: number) => {
	(box as HTMLSelectElement).selectedIndex = index;
	box?.dispatchEvent(new Event('change'));
	await redraw();
};
const click = async (redraw: () => Promise<void>, target: Element | null | undefined) => {
	(target as HTMLElement).click();
	await redraw();
};
const typeRow = (key: string) => modal(`#pr_leave_rules_${key}`)?.closest('tr') as HTMLElement;
const leaveKeys = (page: PayrollRulesPage) => page.picked()?.leaveTypes.map((t) => t.key);

describe('a State’s leave types as a form and back (LV1)', () => {
	it('starts a State without any, copies the saved ones, and writes them only when there are some', () => {
		expect(startingForm('19', undefined).leaveTypes).toEqual([]);
		expect(stateToForm(state('19')).leaveTypes).toEqual([]);
		const copied = stateToForm(state('27', { leaveTypes: MH_TYPES }));
		expect(copied.leaveTypes).toEqual(MH_TYPES);
		expect(copied.leaveTypes[0]).not.toBe(MH_TYPES[0]);
		expect(stateToWrite(stateToForm(state('19')))).not.toHaveProperty('leaveTypes');
		expect(stateToWrite(copied).leaveTypes).toEqual(MH_TYPES);
	});
});

describe('leave in a State’s set (LV1, LV2)', () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-26T06:00:00.000Z'));
	});
	afterEach(() => vi.useRealTimers());

	it('shows the professional tax part first, and the leave part on its chip', async () => {
		const { page, redraw } = await editing();
		expect(page.stateSection()).toBe('pt');
		const pt = modal('#pr_section_pt') as HTMLButtonElement;
		const leave = modal('#pr_section_leave') as HTMLButtonElement;
		expect([pt.classList.contains('btn-theme'), leave.classList.contains('btn-outline')]).toEqual([true, true]);
		expect(modal('#pr_leave_add')).toBeNull();
		await click(redraw, leave);
		expect([pt.classList.contains('btn-outline'), leave.classList.contains('btn-theme')]).toEqual([true, true]);
		expect(modal('#pr_leave_add')).not.toBeNull();
		expect(modal('small.text-muted')?.textContent?.trim()).toBe('payroll_leave_sub');
		await click(redraw, pt);
		expect([page.stateSection(), modal('#pr_leave_add')]).toEqual(['pt', null]);
	});

	it('starts West Bengal from its starting set, offered only while it has no types', async () => {
		const { page, redraw } = await editing();
		page.stateSection.set('leave');
		await redraw();
		expect(page.hasLeaveStart(page.picked() as StateForm)).toBe(true);
		expect(modal('tbody td[colspan="5"]')?.textContent?.trim()).toBe('payroll_leave_none');
		await click(redraw, modal('#pr_leave_start'));
		expect(leaveKeys(page)).toEqual(['EL', 'CL', 'SL', 'ML', 'LOP']);
		expect(page.picked()?.leaveTypes[0]).toEqual(WB[0]);
		expect(page.picked()?.leaveTypes[0]).not.toBe(WB[0]);
		expect([modal('#pr_leave_start'), modal('tbody td[colspan="5"]')]).toEqual([null, null]);
		expect(page.hasLeaveStart(page.picked() as StateForm)).toBe(false);
		// Other States start empty, with no starting set offered.
		page.stateAt.set(1);
		await redraw();
		expect(page.hasLeaveStart({ ...(page.picked() as StateForm), leaveTypes: [] })).toBe(false);
		expect(modal('#pr_leave_start')).toBeNull();
	});

	it('adds a type under the next free code, credited nothing, with its rules open', async () => {
		const { page, redraw } = await editing();
		page.stateSection.set('leave');
		await redraw();
		await click(redraw, modal('#pr_leave_add'));
		expect(leaveKeys(page)).toEqual(['T1']);
		expect([page.leaveOpen(), page.leaveRuleAt()]).toEqual(['T1', 0]);
		expect(page.openType()).toMatchObject({ key: 'T1', name: '', paid: 'full', active: true });
		expect(page.openRule()).toEqual((WB.at(-1) as LeaveTypes[number]).rules[0]);
		expect(modal('#pr_leave_rules_T1')?.classList.contains('btn-theme')).toBe(true);
		await click(redraw, modal('#pr_leave_add'));
		expect(leaveKeys(page)).toEqual(['T1', 'T2']);
		// Maharashtra already holds T3: its third type skips to T4.
		page.stateAt.set(1);
		page.addLeaveType();
		expect(leaveKeys(page)).toEqual(['PL', 'T3', 'T4']);
	});

	it('names, codes, pays and switches off a type, the open one following its new code', async () => {
		const { page, redraw, notifier } = await editing();
		page.stateAt.set(1);
		page.stateSection.set('leave');
		await redraw();
		await enter(redraw, modal('#pr_leave_name_T3'), 'Festival leave');
		expect(page.picked()?.leaveTypes[1]?.name).toBe('Festival leave');
		await click(redraw, modal('#pr_leave_rules_T3'));
		await enter(redraw, modal('#pr_leave_key_T3'), 'fl');
		expect([leaveKeys(page), page.leaveOpen()]).toEqual([['PL', 'FL'], 'FL']);
		await enter(redraw, modal('#pr_leave_key_PL'), 'pl2');
		expect([leaveKeys(page), page.leaveOpen()]).toEqual([['PL2', 'FL'], 'FL']);
		page.setLeaveType('FL', { key: 'FL' });
		expect(page.leaveOpen()).toBe('FL');
		expect(notifier.showError).not.toHaveBeenCalled();
		// A code another type of the State has is refused, and nothing changes.
		await enter(redraw, modal('#pr_leave_key_FL'), 'pl2');
		expect(notifier.showError).toHaveBeenCalledWith('payroll_leave_key_taken');
		expect([leaveKeys(page), page.leaveOpen()]).toEqual([['PL2', 'FL'], 'FL']);
		await enter(redraw, typeRow('FL').querySelector('select'), 'half');
		const active = typeRow('FL').querySelector('input[type="checkbox"]') as HTMLInputElement;
		expect(active.checked).toBe(false);
		await click(redraw, active);
		expect(page.picked()?.leaveTypes[1]).toMatchObject({ paid: 'half', active: true });
	});

	it('takes a type out, closing its rules when they were open', async () => {
		const { page, redraw } = await editing();
		page.stateAt.set(1);
		page.stateSection.set('leave');
		await redraw();
		await click(redraw, modal('#pr_leave_rules_PL'));
		await click(redraw, typeRow('T3').querySelector('button[title="remove"]'));
		expect([leaveKeys(page), page.leaveOpen()]).toEqual([['PL'], 'PL']);
		await click(redraw, typeRow('PL').querySelector('button[title="remove"]'));
		expect([leaveKeys(page), page.leaveOpen()]).toEqual([[], '']);
	});

	it('opens and closes a type’s rules on its button, each time at its first rule', async () => {
		const { page, redraw } = await editing();
		page.stateAt.set(1);
		page.stateSection.set('leave');
		await redraw();
		expect([page.openType(), page.openRule(), page.tryCredit()]).toEqual([null, null, 0]);
		await click(redraw, modal('#pr_leave_rules_PL'));
		page.leaveRuleAt.set(2);
		await click(redraw, modal('#pr_leave_rules_PL'));
		expect([page.leaveOpen(), page.leaveRuleAt()]).toEqual(['', 0]);
		await click(redraw, modal('#pr_leave_rules_PL'));
		expect(modal('h6.mb-2')?.textContent?.trim()).toBe('payroll_leave_rules_for');
		// A rule place past the end shows no editor.
		page.leaveRuleAt.set(7);
		await redraw();
		expect([page.openRule(), modal('#pr_leave_year_start')]).toEqual([null, null]);
		page.addRuleCondition();
		expect(page.openType()?.rules).toHaveLength(3);
	});

	it('changes nothing without a State picked or a type open', async () => {
		const { page, notifier } = await editing();
		page.stateAt.set(9);
		page.startLeave();
		page.addLeaveType();
		page.setLeaveType('T3', { key: 'T9' });
		expect(notifier.showError).not.toHaveBeenCalled();
		page.setRule({ rounding: 'whole' });
		page.addRuleCondition();
		page.removeRule(0);
		expect([page.picked(), page.leaveOpen(), page.form()?.states.map((s) => s.leaveTypes.length)]).toEqual([
			null,
			'',
			[0, 2],
		]);
	});

	it('shows a type’s rules one at a time, its conditions first and the one for everyone last', async () => {
		const { page, redraw } = await editing();
		page.stateAt.set(1);
		page.stateSection.set('leave');
		await redraw();
		await click(redraw, modal('#pr_leave_rules_PL'));
		const chips = () =>
			[
				...(modal('#pr_leave_year_start')?.closest('.col-lg-8')?.querySelectorAll('.d-flex.mb-2 button') ?? []),
			] as HTMLButtonElement[];
		expect(chips().map((b) => b.textContent?.trim())).toEqual([
			'payroll_leave_rule_n',
			'payroll_leave_rule_n',
			'payroll_leave_rule_everyone',
		]);
		expect(chips()[0]?.classList.contains('btn-theme')).toBe(true);
		// The first rule is for Sales, with no designation; the second for managers, with no department.
		expect([
			(modal('#pr_leave_when_designation') as HTMLInputElement).value,
			(modal('#pr_leave_when_department') as HTMLInputElement).value,
		]).toEqual(['', 'Sales']);
		await enter(redraw, modal('#pr_leave_when_designation'), 'Cashier');
		expect(page.openRule()?.when).toEqual({ department: 'Sales', designation: 'Cashier' });
		await click(redraw, chips()[1]);
		expect((modal('#pr_leave_when_department') as HTMLInputElement).value).toBe('');
		await enter(redraw, modal('#pr_leave_when_department'), 'Accounts');
		expect(page.openType()?.rules[1]?.when).toEqual({ designation: 'Manager', department: 'Accounts' });
		await click(redraw, chips()[2]);
		expect([modal('#pr_leave_when_designation'), modal('#pr_leave_remove_rule')]).toEqual([null, null]);
		// A condition copies the rule shown, placed first.
		await click(redraw, modal('#pr_leave_add_condition'));
		expect(page.leaveRuleAt()).toBe(0);
		expect(page.openType()?.rules[0]).toEqual({ ...EVERYONE, when: { designation: '', department: '' } });
		expect(page.openType()?.rules).toHaveLength(4);
		await click(redraw, modal('#pr_leave_remove_rule'));
		await click(redraw, modal('#pr_leave_remove_rule'));
		await click(redraw, modal('#pr_leave_remove_rule'));
		expect(page.openType()?.rules).toEqual([EVERYONE]);
		expect(chips()).toEqual([]);
		page.removeRule(0);
		expect(page.openType()?.rules).toEqual([EVERYONE]);
	});

	it('sets a type’s own year: any start month and length, or each person’s joining day', async () => {
		const { page, redraw } = await editing();
		page.stateAt.set(1);
		page.stateSection.set('leave');
		await redraw();
		await click(redraw, modal('#pr_leave_rules_T3'));
		expect([page.yearStartOf(page.openRule()), page.yearMonthsOf(page.openRule())]).toEqual([4, 12]);
		await pickAt(redraw, modal('#pr_leave_year_start'), 0);
		expect(page.openRule()?.year).toEqual({ startMonth: 1, months: 12 });
		await enter(redraw, modal('#pr_leave_year_months'), '6');
		expect(page.openRule()?.year).toEqual({ startMonth: 1, months: 6 });
		await enter(redraw, modal('#pr_leave_year_months'), '20');
		expect(page.openRule()?.year).toEqual({ startMonth: 1, months: 12 });
		await enter(redraw, modal('#pr_leave_year_months'), '-3');
		expect(page.openRule()?.year).toEqual({ startMonth: 1, months: 1 });
		await enter(redraw, modal('#pr_leave_year_months'), '');
		expect(page.openRule()?.year).toEqual({ startMonth: 1, months: 12 });
		await pickAt(redraw, modal('#pr_leave_year_start'), 12);
		expect(page.openRule()?.year).toEqual({ fromJoining: true });
		expect([page.yearStartOf(page.openRule()), page.yearMonthsOf(page.openRule())]).toEqual([0, 12]);
		expect(modal('#pr_leave_year_months')).toBeNull();
		page.setYearMonths(page.openRule(), 9);
		expect(page.openRule()?.year).toEqual({ startMonth: 4, months: 9 });
		page.setYearStart({ ...page.openRule(), year: { fromJoining: true } }, 7);
		expect(page.openRule()?.year).toEqual({ startMonth: 7, months: 12 });
	});

	it('sets how long a credit stays valid, days and months starting at 90 and 12', async () => {
		const { page, redraw } = await editing();
		page.stateAt.set(1);
		page.stateSection.set('leave');
		await redraw();
		await click(redraw, modal('#pr_leave_rules_T3'));
		const number = () => modal('#pr_leave_valid')?.parentElement?.querySelector('input') as HTMLInputElement | null;
		expect(number()).toBeNull();
		await enter(redraw, modal('#pr_leave_valid'), 'days');
		expect(page.openRule()?.validity).toEqual({ kind: 'days', n: 90 });
		await enter(redraw, number(), '45');
		expect(page.openRule()?.validity).toEqual({ kind: 'days', n: 45 });
		page.setValidity('days', page.openRule());
		expect(page.openRule()?.validity).toEqual({ kind: 'days', n: 45 });
		// A count is kept only while its unit stays: days to months starts at 12, months to days at 90.
		await enter(redraw, modal('#pr_leave_valid'), 'months');
		expect(page.openRule()?.validity).toEqual({ kind: 'months', n: 12 });
		await enter(redraw, number(), '30');
		page.setValidity('months', page.openRule());
		expect(page.openRule()?.validity).toEqual({ kind: 'months', n: 30 });
		await enter(redraw, modal('#pr_leave_valid'), 'days');
		expect(page.openRule()?.validity).toEqual({ kind: 'days', n: 90 });
		await enter(redraw, modal('#pr_leave_valid'), 'never');
		expect([page.openRule()?.validity, number()]).toEqual([{ kind: 'never' }, null]);
		await enter(redraw, modal('#pr_leave_valid'), 'months');
		expect(page.openRule()?.validity).toEqual({ kind: 'months', n: 12 });
		expect(number()?.value).toBe('12');
		await enter(redraw, modal('#pr_leave_valid'), 'year_end');
		expect(page.openRule()?.validity).toEqual({ kind: 'year_end' });
	});

	it('sets how leave is credited, with its figures', async () => {
		const { page, redraw } = await editing();
		page.stateAt.set(1);
		page.stateSection.set('leave');
		await redraw();
		await click(redraw, modal('#pr_leave_rules_T3'));
		expect(page.openRule()?.credit).toEqual({ kind: 'year_start', days: 10 });
		expect((modal('#pr_leave_days') as HTMLInputElement).value).toBe('10');
		await enter(redraw, modal('#pr_leave_credit'), 'per_days_worked');
		expect([page.openRule()?.credit, modal('#pr_leave_days')]).toEqual([
			{ kind: 'per_days_worked', every: 20, give: 1 },
			null,
		]);
		await enter(redraw, modal('#pr_leave_every'), '25');
		await enter(redraw, modal('#pr_leave_give'), '1.5');
		expect(page.openRule()?.credit).toEqual({ kind: 'per_days_worked', every: 25, give: 1.5 });
		await enter(redraw, modal('#pr_leave_credit'), 'none');
		expect([page.openRule()?.credit, modal('#pr_leave_days'), modal('#pr_leave_every')]).toEqual([
			{ kind: 'none' },
			null,
			null,
		]);
		await enter(redraw, modal('#pr_leave_credit'), 'monthly');
		expect(page.openRule()?.credit).toEqual({ kind: 'monthly', days: 0 });
		await enter(redraw, modal('#pr_leave_days'), '1.5');
		expect(page.openRule()?.credit).toEqual({ kind: 'monthly', days: 1.5 });
	});

	it('sets the wait, joiners, rounding, the most carried, what happens above it, and a day’s pay', async () => {
		const { page, redraw } = await editing();
		page.stateAt.set(1);
		page.stateSection.set('leave');
		await redraw();
		await click(redraw, modal('#pr_leave_rules_T3'));
		await enter(redraw, modal('#pr_leave_wait'), '30');
		expect(page.openRule()?.waitDays).toBe(30);
		await enter(redraw, modal('#pr_leave_wait'), '');
		expect(page.openRule()?.waitDays).toBeNull();
		await enter(redraw, modal('#pr_leave_joiners'), 'days_left');
		await enter(redraw, modal('#pr_leave_rounding'), 'whole');
		await enter(redraw, modal('#pr_leave_carry'), '10');
		expect(page.openRule()?.carryMax).toBe(10);
		expect((modal('#pr_leave_carry') as HTMLInputElement).placeholder).toBe('payroll_leave_carry_all');
		await enter(redraw, modal('#pr_leave_carry'), '');
		expect(page.openRule()?.carryMax).toBeNull();
		page.setRule({ carryMax: 0 });
		await enter(redraw, modal('#pr_leave_above'), 'encash');
		await enter(redraw, modal('#pr_leave_day_pay'), '26');
		expect(page.openRule()).toMatchObject({
			joiners: 'days_left',
			rounding: 'whole',
			carryMax: 0,
			aboveCap: 'encash',
			encash: { onLeaving: false, onRequestMax: null, dayPay: '26' },
		});
	});

	it('ticks how leave is taken and encashment on leaving', async () => {
		const { page, redraw } = await editing();
		page.stateAt.set(1);
		page.stateSection.set('leave');
		await redraw();
		await click(redraw, modal('#pr_leave_rules_T3'));
		const ticks = () => page.takingFlags.map((f) => (modal(`#pr_leave_${f.key}`) as HTMLInputElement).checked);
		expect(ticks()).toEqual([true, false, false, false]);
		for (const flag of page.takingFlags) await click(redraw, modal(`#pr_leave_${flag.key}`));
		expect(ticks()).toEqual([false, true, true, true]);
		expect(page.openRule()).toMatchObject({
			taking: { halfDays: false, countOffsBetween: true, canGoNegative: true },
			encash: { onLeaving: true },
		});
		expect(page.flagOn(page.openRule(), 'onLeaving')).toBe(true);
		await click(redraw, modal('#pr_leave_onLeaving'));
		expect(page.flagOn(page.openRule(), 'onLeaving')).toBe(false);
	});

	it('tries the rule shown on a joiner: what it credits so far for the days worked', async () => {
		const { page, redraw } = await editing();
		page.stateSection.set('leave');
		page.startLeave();
		await redraw();
		await click(redraw, modal('#pr_leave_rules_EL'));
		expect((modal('#pr_leave_try_joined') as HTMLInputElement).value).toBe('2026-08-12');
		expect((modal('#pr_leave_try_worked') as HTMLInputElement).value).toBe('96');
		expect(modal('#pr_leave_try_result')?.textContent?.trim()).toBe('payroll_leave_try_result');
		// Earned leave waits for 180 days worked, then gives one day for every 20.
		expect(page.tryCredit()).toBe(0);
		await enter(redraw, modal('#pr_leave_try_worked'), '200');
		expect(page.tryCredit()).toBe(10);
		await enter(redraw, modal('#pr_leave_try_joined'), '2026-10-01');
		expect(page.tryJoined()).toBe('2026-10-01');
		page.tryJoined.set('');
		expect(page.tryCredit()).toBe(0);
	});

	it('says the rule shown in plain words, sentence by sentence, and nothing with no rule open', async () => {
		const words = {
			payroll_month_1: 'January',
			payroll_month_4: 'April',
			plain_year_joining: 'JOIN.',
			plain_year_from: 'FROM {{month}} {{months}}.',
			plain_credit_year_start: 'START {{days}}.',
			plain_credit_monthly: 'MONTHLY {{days}}.',
			plain_credit_on_request: 'ASKED {{days}}.',
			plain_credit_worked: 'WORKED {{give}}/{{every}}.',
			plain_credit_worked_one: 'WORKED ONE/{{every}}.',
			plain_credit_monthly_one: 'MONTHLY ONE.',
			plain_credit_none: 'NONE.',
			plain_wait: 'WAIT {{days}}.',
			plain_joiners_months_left: 'MONTHS LEFT.',
			plain_joiners_days_left: 'DAYS LEFT.',
			plain_never_lapses: 'NEVER.',
			plain_carry_all: 'ALL.',
			plain_carry_none: 'LAPSES.',
			plain_carry_max: 'UP TO {{days}}, {{above}}.',
			plain_above_encash: 'paid',
			plain_above_lapse: 'lost',
			plain_valid_days: 'VALID {{n}} DAYS.',
			plain_valid_months: 'VALID {{n}} MONTHS.',
			plain_encash_leaving: 'LEAVING.',
		};
		const { page, redraw } = await editing(words);
		page.stateAt.set(1);
		page.stateSection.set('leave');
		await redraw();
		expect(page.plainWords()).toBe('');
		await click(redraw, modal('#pr_leave_rules_T3'));
		// Casual leave: an April year, 10 days at its start, a share for joiners, nothing carried.
		expect(modal('#pr_leave_plain')?.textContent?.trim()).toBe('FROM April 12. START 10. MONTHS LEFT. LAPSES.');
		page.setRule({ year: { fromJoining: true }, credit: { kind: 'per_days_worked', every: 20, give: 1 } });
		page.setRule({ waitDays: 180, joiners: 'none', carryMax: null });
		// One day reads as one ("1 day is earned"), more as more.
		expect(page.plainWords()).toBe('JOIN. WORKED ONE/20. WAIT 180. ALL.');
		page.setRule({ credit: { kind: 'per_days_worked', every: 20, give: 1.5 } });
		expect(page.plainWords()).toBe('JOIN. WORKED 1.5/20. WAIT 180. ALL.');
		page.setRule({ year: { startMonth: 1, months: 12 }, credit: { kind: 'monthly', days: 1.5 }, waitDays: null });
		page.setRule({ joiners: 'days_left', carryMax: 30, aboveCap: 'encash' });
		expect(page.plainWords()).toBe('FROM January 12. MONTHLY 1.5. DAYS LEFT. UP TO 30, paid.');
		page.setRule({ credit: { kind: 'monthly', days: 1 } });
		expect(page.plainWords()).toBe('FROM January 12. MONTHLY ONE. DAYS LEFT. UP TO 30, paid.');
		page.setRule({ credit: { kind: 'none' }, aboveCap: 'lapse', validity: { kind: 'days', n: 90 } });
		expect(page.plainWords()).toBe('FROM January 12. NONE. DAYS LEFT. UP TO 30, lost. VALID 90 DAYS.');
		page.setRule({ credit: { kind: 'on_request', days: 182 }, validity: { kind: 'months', n: 12 } });
		page.setRule({ encash: { onLeaving: true, onRequestMax: null, dayPay: 'month_days' } });
		expect(page.plainWords()).toBe(
			'FROM January 12. ASKED 182. DAYS LEFT. UP TO 30, lost. VALID 12 MONTHS. LEAVING.',
		);
		// Leave that never lapses says so, whatever is carried.
		page.setRule({ validity: { kind: 'never' } });
		expect(page.plainWords()).toBe('FROM January 12. ASKED 182. DAYS LEFT. NEVER. LEAVING.');
	});
});
