import { ApplicationRef, TemplateRef, signal, type EmbeddedViewRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { NEVER, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PayrollGateway } from '@core/accounts/payroll.gateway';
import { LocationsGateway } from '@core/locations/locations.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { PayrollRulesPage, startingForm, stateToForm, stateToWrite, toForm, toWrite } from './payroll-rules-page';

import type { PayrollRulesVersion, StatePayrollRules, StoreShift } from '@saha-textile/contracts';

/**
 * Holidays per State and each store's shift in Payroll rules (brief 26 LV1, AT1, AT2): a holiday for every store in
 * the State or one, and a store's hours, full day, grace and weekly offs.
 */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const LOCATIONS = [
	{ id: 'loc_b', name: 'Barasat', active: true, stateCode: '19' },
	{ id: 'loc_s', name: 'Sodepur', active: true, stateCode: '19' },
	{ id: 'loc_p', name: 'Pune', active: true, stateCode: '27' },
	{ id: 'loc_w', name: 'Warehouse', active: true },
];
const PUJA = { day: '2026-10-20', name: 'Durga Puja', locationId: null };
const SHIFT: StoreShift = {
	locationId: 'loc_s',
	start: '11:00',
	end: '20:00',
	fullDayHours: 8,
	graceMinutes: 15,
	weeklyOff: [2],
};

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
const version = (states: StatePayrollRules[], over: Record<string, unknown> = {}) =>
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
		...over,
	}) as unknown as PayrollRulesVersion;

async function editing(options: { version?: PayrollRulesVersion; locations?: unknown } = {}) {
	TestBed.resetTestingModule();
	document.body.querySelectorAll('.hs-test-modal').forEach((node) => node.remove());
	const views: EmbeddedViewRef<unknown>[] = [];
	TestBed.configureTestingModule({
		imports: [
			PayrollRulesPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
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
					rules: vi.fn(() => of([options.version ?? version([state('19'), state('27')])])),
					addRules: vi.fn(),
				},
			},
			{
				provide: LocationsGateway,
				useValue: {
					list: vi.fn(() => (options.locations === null ? NEVER : of(options.locations ?? LOCATIONS))),
				},
			},
			{ provide: NotificationService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
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
						holder.className = 'hs-test-modal';
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
	return { page: fixture.componentInstance, redraw };
}

const modal = <T extends HTMLElement = HTMLInputElement>(selector: string) =>
	document.querySelector(`.hs-test-modal ${selector}`) as T | null;
const enter = async (redraw: () => Promise<void>, box: Element | null | undefined, value: string) => {
	(box as HTMLInputElement).value = value;
	box?.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
	await redraw();
};
const click = async (redraw: () => Promise<void>, target: Element | null | undefined) => {
	(target as HTMLElement).click();
	await redraw();
};
const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim();
const optionsOf = (id: string) => [...(modal<HTMLSelectElement>(id)?.options ?? [])].map((o) => [o.value, text(o)]);

describe('holidays and shifts as a form and back', () => {
	it('copies a State’s holidays, starts a State without any, and writes them only when there are some', () => {
		const saved = state('19', { holidays: [PUJA] });
		const form = stateToForm(saved);
		expect(form.holidays).toEqual([PUJA]);
		expect(form.holidays[0]).not.toBe(PUJA);
		expect(stateToForm(state('19')).holidays).toEqual([]);
		expect(startingForm('27', undefined).holidays).toEqual([]);
		expect(stateToWrite(form).holidays).toEqual([PUJA]);
		expect(stateToWrite(stateToForm(state('19')))).not.toHaveProperty('holidays');
	});

	it('copies a version’s shifts with their own weekly offs, and writes them only when there are some', () => {
		const form = toForm(version([state('19')], { shifts: [SHIFT] }), '2027-04-01');
		expect(form.shifts).toEqual([SHIFT]);
		expect(form.shifts[0]?.weeklyOff).not.toBe(SHIFT.weeklyOff);
		expect(toWrite(form).shifts).toEqual([SHIFT]);
		const none = toForm(version([state('19')]), '2027-04-01');
		expect(none.shifts).toEqual([]);
		expect(toWrite(none)).not.toHaveProperty('shifts');
	});
});

describe('holidays and shifts in the add-a-version pop-up (LV1, AT1, AT2)', () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-26T06:00:00.000Z'));
	});
	afterEach(() => vi.useRealTimers());

	it('shows a State’s holidays on their own chip, in place of professional tax', async () => {
		const { page, redraw } = await editing();
		expect(modal('#pr_pt_freq')).not.toBeNull();
		const chip = modal<HTMLButtonElement>('#pr_section_holidays') as HTMLButtonElement;
		expect(chip.classList.contains('btn-outline')).toBe(true);
		await click(redraw, chip);
		expect([page.stateSection(), chip.classList.contains('btn-theme')]).toEqual(['holidays', true]);
		expect([modal('#pr_pt_freq'), modal('#pr_leave_add')]).toEqual([null, null]);
		expect(modal('#pr_holiday_add')).not.toBeNull();
		expect(text(modal('td[colspan="4"]'))).toBe('payroll_holidays_none');
		await click(redraw, modal('#pr_section_pt'));
		expect([modal('#pr_holiday_add'), modal('#pr_pt_freq') === null]).toEqual([null, false]);
	});

	it('adds a holiday on today’s date for every store, then dates, names and keeps it to one store', async () => {
		const { page, redraw } = await editing();
		page.stateSection.set('holidays');
		await redraw();
		expect(page.today).toBe('2026-11-26');
		await click(redraw, modal('#pr_holiday_add'));
		expect(page.picked()?.holidays).toEqual([{ day: '2026-11-26', name: '', locationId: null }]);
		expect(modal('td[colspan="4"]')).toBeNull();
		// Only the State's own stores, after "every store".
		expect(optionsOf('#pr_holiday_store_0')).toEqual([
			['', 'payroll_holiday_every_store'],
			['loc_b', 'Barasat'],
			['loc_s', 'Sodepur'],
		]);
		expect(modal<HTMLSelectElement>('#pr_holiday_store_0')?.value).toBe('');
		await enter(redraw, modal('#pr_holiday_day_0'), '2026-12-25');
		await enter(redraw, modal('#pr_holiday_name_0'), 'Christmas');
		await enter(redraw, modal('#pr_holiday_store_0'), 'loc_s');
		expect(page.picked()?.holidays[0]).toEqual({ day: '2026-12-25', name: 'Christmas', locationId: 'loc_s' });
		await click(redraw, modal('#pr_holiday_add'));
		await enter(redraw, modal('#pr_holiday_store_0'), '');
		expect(page.picked()?.holidays.map((h) => h.locationId)).toEqual([null, null]);
		await click(redraw, modal('#pr_holiday_remove_0'));
		expect(page.picked()?.holidays).toEqual([{ day: '2026-11-26', name: '', locationId: null }]);
		expect(modal<HTMLInputElement>('#pr_holiday_day_0')?.value).toBe('2026-11-26');
		expect(modal('#pr_holiday_remove_0')?.title).toBe('remove');
	});

	it('reads the holidays saved with the version, each State its own stores', async () => {
		const { page, redraw } = await editing({
			version: version([state('19'), state('27', { holidays: [{ ...PUJA, name: 'Ganesh Chaturthi' }] })]),
		});
		page.stateAt.set(1);
		page.stateSection.set('holidays');
		await redraw();
		expect(modal<HTMLInputElement>('#pr_holiday_name_0')?.value).toBe('Ganesh Chaturthi');
		expect(optionsOf('#pr_holiday_store_0')).toEqual([
			['', 'payroll_holiday_every_store'],
			['loc_p', 'Pune'],
		]);
	});

	it('changes no holiday without a State picked, and lists no stores before they are read', async () => {
		const { page } = await editing({ locations: null });
		expect(page.storesOf('19')).toEqual([]);
		page.stateAt.set(9);
		page.addHoliday();
		page.setHoliday(0, { name: 'Diwali' });
		page.removeHoliday(0);
		expect(page.form()?.states.map((s) => s.holidays)).toEqual([[], []]);
	});

	it('adds a store’s shift from the default, each time for the next store without one, until every store has one', async () => {
		const { page, redraw } = await editing();
		expect(text(modal('td[colspan="7"]'))).toBe('payroll_shifts_none');
		const add = modal<HTMLButtonElement>('#pr_shift_add') as HTMLButtonElement;
		expect(add.disabled).toBe(false);
		await click(redraw, add);
		expect(page.form()?.shifts).toEqual([
			{ locationId: 'loc_b', start: '10:00', end: '19:00', fullDayHours: 8, graceMinutes: 0, weeklyOff: [0] },
		]);
		expect(modal('td[colspan="7"]')).toBeNull();
		expect(optionsOf('#pr_shift_store_0').map(([id]) => id)).toEqual(['loc_b', 'loc_s', 'loc_p', 'loc_w']);
		for (let i = 0; i < 3; i++) await click(redraw, add);
		expect(page.form()?.shifts.map((sh) => sh.locationId)).toEqual(['loc_b', 'loc_s', 'loc_p', 'loc_w']);
		// A change to one shift leaves the others as they were.
		await enter(redraw, modal('#pr_shift_start_1'), '09:00');
		expect(page.form()?.shifts.map((sh) => sh.start)).toEqual(['10:00', '09:00', '10:00', '10:00']);
		expect(add.disabled).toBe(true);
		page.addShift();
		expect(page.form()?.shifts).toHaveLength(4);
	});

	it('sets a shift’s store, hours, full day and grace, its weekly offs in order, and takes it out', async () => {
		const { page, redraw } = await editing({ version: version([state('19')], { shifts: [SHIFT] }) });
		expect(modal<HTMLSelectElement>('#pr_shift_store_0')?.value).toBe('loc_s');
		await enter(redraw, modal('#pr_shift_store_0'), 'loc_b');
		await enter(redraw, modal('#pr_shift_start_0'), '09:30');
		await enter(redraw, modal('#pr_shift_end_0'), '18:30');
		await enter(redraw, modal('#pr_shift_hours_0'), '7.5');
		await enter(redraw, modal('#pr_shift_grace_0'), '10');
		expect(page.form()?.shifts[0]).toEqual({
			locationId: 'loc_b',
			start: '09:30',
			end: '18:30',
			fullDayHours: 7.5,
			graceMinutes: 10,
			weeklyOff: [2],
		});
		const chip = (w: number) => modal<HTMLButtonElement>(`#pr_shift_off_0_${w}`) as HTMLButtonElement;
		expect([chip(2).classList.contains('btn-theme'), chip(2).getAttribute('aria-pressed')]).toEqual([true, 'true']);
		expect([chip(0).classList.contains('btn-outline'), text(chip(0))]).toEqual([true, 'payroll_weekday_0']);
		await click(redraw, chip(6));
		await click(redraw, chip(0));
		expect(page.form()?.shifts[0]?.weeklyOff).toEqual([0, 2, 6]);
		await click(redraw, chip(2));
		expect(page.form()?.shifts[0]?.weeklyOff).toEqual([0, 6]);
		page.toggleOff(5, 1);
		expect(page.form()?.shifts).toHaveLength(1);
		await click(redraw, modal('#pr_shift_remove_0'));
		expect(page.form()?.shifts).toEqual([]);
	});

	it('offers no shift before the stores are read, and changes none with no version open', async () => {
		const loading = await editing({ locations: null });
		expect(loading.page.locations.data()).toBeUndefined();
		expect(modal<HTMLButtonElement>('#pr_shift_add')?.disabled).toBe(true);
		loading.page.addShift();
		expect(loading.page.form()?.shifts).toEqual([]);
		const { page } = await editing();
		page.form.set(null);
		page.addShift();
		page.setShift(0, { start: '08:00' });
		page.removeShift(0);
		page.toggleOff(0, 1);
		expect(page.form()).toBeNull();
	});
});
