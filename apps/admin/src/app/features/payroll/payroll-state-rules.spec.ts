import { ApplicationRef, TemplateRef, signal, type EmbeddedViewRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { PayrollGateway } from '@core/accounts/payroll.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import {
	PayrollRulesPage,
	monthList,
	ruleRows,
	stateName,
	stateToForm,
	stateToWrite,
	statesOf,
	type StateForm,
} from './payroll-rules-page';

import type { PayrollRulesVersion, StatePayrollRules } from '@saha-textile/contracts';

/** Professional tax and the welfare fund per State (brief 25 ST1), on Settings › Payroll rules. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};

const state = (stateCode: string, over: Partial<StatePayrollRules> = {}): StatePayrollRules => ({
	stateCode,
	ptFrequency: 'monthly',
	ptSlabs: [
		{ upToPaise: 1_000_000, taxPaise: 0 },
		{ upToPaise: 1_500_000, taxPaise: 11_000 },
		{ upToPaise: null, taxPaise: 20_000 },
	],
	ptMonths: [],
	ptDueDay: 21,
	lwfEmployeePaise: 300,
	lwfEmployerPaise: 1_500,
	lwfMonths: [6, 12],
	lwfDueDay: 15,
	...over,
});
const WEST_BENGAL = state('19');
const KERALA = state('32', {
	ptFrequency: 'half_yearly',
	ptSlabs: [
		{ upToPaise: 1_200_000, taxPaise: 0 },
		{ upToPaise: null, taxPaise: 125_000 },
	],
	ptMonths: [9, 3],
	ptDueDay: 30,
	lwfEmployeePaise: 5_000,
	lwfEmployerPaise: 5_000,
	lwfMonths: [],
	lwfDueDay: 5,
});

const version = (id: string, from: string, over: Record<string, unknown> = {}) =>
	({
		id,
		from,
		note: 'Budget 2025',
		builtIn: false,
		createdBy: null,
		createdAt: '2025-01-01T00:00:00.000Z',
		pfRatePct: 12,
		pfWageCapPaise: 1_500_000,
		epsRatePct: 8.33,
		epsCapPaise: 1_500_000,
		esiEmployeePct: 0.75,
		esiEmployerPct: 3.25,
		esiGrossLimitPaise: 2_100_000,
		ptSlabs: [
			{ upToPaise: 1_000_000, taxPaise: 0 },
			{ upToPaise: null, taxPaise: 20_000 },
		],
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
		states: [WEST_BENGAL, KERALA],
		...over,
	}) as unknown as PayrollRulesVersion;
const TWO_STATES = version('v2', '2025-04-01');

interface Opened {
	close: ReturnType<typeof vi.fn>;
	dismiss: ReturnType<typeof vi.fn>;
	view: EmbeddedViewRef<unknown>;
}

function mount(current: PayrollRulesVersion = TWO_STATES) {
	TestBed.resetTestingModule();
	document.body.querySelectorAll('.st-test-modal').forEach((node) => node.remove());
	const opened: Opened[] = [];
	const calls = { rules: vi.fn(() => of([current])), addRules: vi.fn(() => of(current)) };
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
			{ provide: PayrollGateway, useValue: calls },
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
						holder.className = 'st-test-modal';
						holder.append(...(view.rootNodes as Node[]));
						document.body.append(holder);
						opened.push({ ...ref, view });
						return ref;
					}),
				},
			},
		],
	});
	const fixture = TestBed.createComponent(PayrollRulesPage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, opened, calls };
}

/** The page with the add-a-version pop-up open on the version in force. */
async function editing(current?: PayrollRulesVersion) {
	const harness = mount(current);
	await settle(harness.fixture);
	(harness.fixture.nativeElement.querySelector('#rules_add') as HTMLButtonElement).click();
	const popup = harness.opened[0] as Opened;
	const redraw = () => popup.view.detectChanges();
	// ngModel writes a field's value a moment after the view is drawn.
	const redrawn = async () => {
		redraw();
		await new Promise((resolve) => setTimeout(resolve, 0));
		redraw();
	};
	return { ...harness, popup, redraw, redrawn };
}

const modal = <T extends HTMLElement = HTMLElement>(selector: string) =>
	document.querySelector(`.st-test-modal ${selector}`) as T | null;
const modalAll = <T extends HTMLElement = HTMLElement>(selector: string) =>
	[...document.querySelectorAll(`.st-test-modal ${selector}`)] as T[];
const enter = (control: Element | null | undefined, value: string) => {
	const box = control as HTMLInputElement;
	box.value = value;
	box.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
};
/** The State chips: the buttons before the picker, by their words. */
const chips = () =>
	modalAll<HTMLButtonElement>('button.btn-sm').filter(
		(b) => !b.id && !b.classList.contains('text-danger') && b.closest('.d-flex.flex-wrap') !== null,
	);
const slabRows = () => modalAll('tbody tr');

describe('a State’s professional tax and welfare fund, as a form and back (ST1)', () => {
	it('keeps only months 1 to 12 from what is typed', () => {
		expect(monthList('6, 12, 13, x, 0, 3')).toEqual([6, 12, 3]);
		expect(monthList('')).toEqual([]);
	});

	it('reads a version’s own States, or an older version’s company-wide figures as West Bengal’s', () => {
		expect(statesOf(TWO_STATES)).toEqual([WEST_BENGAL, KERALA]);
		const older = version('v1', '2017-04-01', { states: [] });
		expect(statesOf(older)).toEqual([
			{
				stateCode: '19',
				ptFrequency: 'monthly',
				ptSlabs: older.ptSlabs,
				ptMonths: [],
				ptDueDay: 21,
				lwfEmployeePaise: 300,
				lwfEmployerPaise: 1_500,
				lwfMonths: [6, 12],
				lwfDueDay: 15,
			},
		]);
		expect(statesOf(version('v0', '2017-04-01', { states: undefined }))[0]?.stateCode).toBe('19');
	});

	it('shows money in rupees and months as words, and writes them back in paise', () => {
		const form = stateToForm(KERALA);
		expect(form).toMatchObject({
			stateCode: '32',
			ptFrequency: 'half_yearly',
			ptSlabs: [
				{ upTo: 12_000, tax: 0 },
				{ upTo: null, tax: 1_250 },
			],
			ptMonths: '9, 3',
			ptDueDay: 30,
			lwfEmployee: 50,
			lwfEmployer: 50,
			lwfMonths: '',
			lwfDueDay: 5,
		});
		expect(stateToWrite(form)).toEqual(KERALA);
		expect(stateToWrite({ ...form, ptFrequency: 'yearly', ptMonths: '4' }).ptMonths).toEqual([4]);
	});

	it('writes no months for a monthly tax, and no slabs or months when the State has none', () => {
		const monthly: StateForm = { ...stateToForm(WEST_BENGAL), ptMonths: '9' };
		expect(stateToWrite(monthly)).toEqual(WEST_BENGAL);
		const none = stateToWrite({ ...stateToForm(KERALA), ptFrequency: 'none' });
		expect([none.ptSlabs, none.ptMonths]).toEqual([[], []]);
	});

	it('names a State from its GST code, or gives the code when it is not one', () => {
		expect([stateName('19'), stateName('32'), stateName('99')]).toEqual(['West Bengal', 'Kerala', '99']);
	});

	it('words each State’s tax by how often it is paid, with its welfare fund beside it', () => {
		const rows = ruleRows(
			version('v3', '2026-04-01', {
				states: [
					WEST_BENGAL,
					KERALA,
					state('29', {
						ptFrequency: 'yearly',
						ptMonths: [4],
						ptSlabs: [{ upToPaise: null, taxPaise: 250_000 }],
					}),
					state('27', { ptFrequency: 'none', ptSlabs: [], lwfMonths: [] }),
				],
			}),
		);
		const byState = rows.filter((r) => 'state' in r.values);
		expect(byState.map((r) => [r.key, r.values['state']])).toEqual([
			['pt', 'West Bengal'],
			['lwf', 'West Bengal'],
			['pt_period', 'Kerala'],
			['lwf', 'Kerala'],
			['pt_period', 'Karnataka'],
			['lwf', 'Karnataka'],
			['pt_none', 'Maharashtra'],
			['lwf', 'Maharashtra'],
		]);
		expect(byState[2]?.values).toEqual({
			state: 'Kerala',
			taxes: '₹1,250',
			over: '12,000',
			months: '9, 3',
			day: '30',
		});
		expect(byState[3]?.values).toEqual({ state: 'Kerala', ee: '50', er: '50', months: '', day: '5' });
		expect(byState[4]?.values).toMatchObject({ taxes: '₹2,500', over: '0', months: '4' });
		expect(byState[6]?.values).toMatchObject({ taxes: '', over: '0' });
		expect(byState.every((r) => r.from === '2026-04-01')).toBe(true);
	});
});

describe('the States in the add-a-version pop-up (ST1)', () => {
	it('opens on the first State with a chip for each, a picker of the States not yet added, and its slabs', async () => {
		const { page } = await editing();
		expect(page.stateAt()).toBe(0);
		expect(chips().map((b) => [b.textContent?.trim(), b.classList.contains('btn-theme')])).toEqual([
			['West Bengal', true],
			['Kerala', false],
		]);
		const picker = modal<HTMLSelectElement>('#pr_state_pick') as HTMLSelectElement;
		const codes = [...picker.options].map((o) => o.value);
		expect(codes[0]).toBe('');
		expect(codes).not.toContain('19');
		expect(codes).not.toContain('32');
		expect(codes).toContain('29');
		expect(codes).not.toContain('25');
		expect(modal<HTMLButtonElement>('#pr_state_add')?.disabled).toBe(true);
		expect(modal('.text-danger.d-block')).toBeNull();
		expect(modal<HTMLSelectElement>('#pr_pt_freq')?.value).toBe('monthly');
		expect(modal('#pr_pt_months')).toBeNull();
		expect(slabRows()).toHaveLength(3);
		expect(slabRows()[2]?.textContent).toContain('payroll_f_pt_above');
		expect(slabRows().map((row) => row.querySelectorAll('button').length)).toEqual([1, 1, 0]);
		expect(modal<HTMLInputElement>('#pr_lwf_m')?.value).toBe('6, 12');
		expect(modal('#pr_state_remove')).not.toBeNull();
		expect(page.hasState('19')).toBe(true);
		expect(page.hasState('29')).toBe(false);
	});

	it('shows another State when its chip is pressed, with the months it is paid in', async () => {
		const { page, redraw, redrawn } = await editing();
		chips()[1]?.click();
		await redrawn();
		expect(page.stateAt()).toBe(1);
		expect(page.picked()?.stateCode).toBe('32');
		expect(chips().map((b) => b.classList.contains('btn-outline'))).toEqual([true, false]);
		expect(modal<HTMLSelectElement>('#pr_pt_freq')?.value).toBe('half_yearly');
		expect(modal<HTMLInputElement>('#pr_pt_months')?.value).toBe('9, 3');
		enter(modal('#pr_pt_months'), '10, 4');
		redraw();
		expect(page.form()?.states[1]?.ptMonths).toBe('10, 4');
		expect(page.form()?.states[0]?.ptMonths).toBe('');
	});

	it('changes how often the tax is paid: months for half-yearly and yearly, no slabs for none', async () => {
		const { page, redraw } = await editing();
		enter(modal('#pr_pt_freq'), 'yearly');
		redraw();
		expect(page.picked()?.ptFrequency).toBe('yearly');
		expect(modal('#pr_pt_months')).not.toBeNull();
		enter(modal('#pr_pt_freq'), 'none');
		redraw();
		expect(modal('#pr_pt_months')).toBeNull();
		expect(slabRows()).toHaveLength(0);
		expect(modal('#pr_slab_add')).toBeNull();
		expect(document.querySelector('.st-test-modal')?.textContent).toContain('payroll_pt_slabs_none');
		enter(modal('#pr_pt_freq'), 'monthly');
		redraw();
		expect(slabRows()).toHaveLength(3);
	});

	it('edits a slab, adds one below the open top slab, and removes one', async () => {
		const { page, redraw } = await editing();
		enter(slabRows()[1]?.querySelector('input[aria-label="payroll_f_pt_up_to"]'), '16000');
		enter(slabRows()[1]?.querySelector('input[aria-label="payroll_f_pt_tax"]'), '130');
		redraw();
		expect(page.picked()?.ptSlabs[1]).toMatchObject({ upTo: 16_000, tax: 130 });
		modal<HTMLButtonElement>('#pr_slab_add')?.click();
		redraw();
		expect(page.picked()?.ptSlabs).toMatchObject([
			{ upTo: 10_000, tax: 0 },
			{ upTo: 16_000, tax: 130 },
			{ upTo: 0, tax: 0 },
			{ upTo: null, tax: 200 },
		]);
		(slabRows()[0]?.querySelector('button') as HTMLButtonElement).click();
		redraw();
		expect(page.picked()?.ptSlabs.map((s) => s.upTo)).toEqual([16_000, 0, null]);
		expect(page.form()?.states[1]?.ptSlabs).toHaveLength(2);
	});

	it('sets the due day and the welfare fund for the State shown', async () => {
		const { page, redraw } = await editing();
		enter(modal('#pr_pt_day'), '20');
		enter(modal('#pr_lwf_ee'), '5');
		enter(modal('#pr_lwf_er'), '15');
		enter(modal('#pr_lwf_m'), '1, 7');
		enter(modal('#pr_lwf_day'), '10');
		redraw();
		expect(page.picked()).toMatchObject({
			ptDueDay: 20,
			lwfEmployee: 5,
			lwfEmployer: 15,
			lwfMonths: '1, 7',
			lwfDueDay: 10,
		});
	});

	it('adds a picked State with no starting set and no tax yet, shows it at once, and leaves it out of the picker', async () => {
		const { page, redraw } = await editing();
		enter(modal('#pr_state_pick'), '10');
		redraw();
		expect(modal<HTMLButtonElement>('#pr_state_add')?.disabled).toBe(false);
		modal<HTMLButtonElement>('#pr_state_add')?.click();
		redraw();
		expect(page.form()?.states.map((s) => s.stateCode)).toEqual(['19', '32', '10']);
		expect(page.picked()).toMatchObject({
			stateCode: '10',
			ptFrequency: 'monthly',
			ptSlabs: [{ upTo: null, tax: 0 }],
			ptMonths: '',
			ptDueDay: 21,
			lwfEmployee: 0,
			lwfEmployer: 0,
			lwfMonths: '',
			lwfDueDay: 15,
		});
		expect(page.stateAt()).toBe(2);
		expect(page.stateToAdd()).toBe('');
		expect([...(modal<HTMLSelectElement>('#pr_state_pick')?.options ?? [])].map((o) => o.value)).not.toContain(
			'10',
		);
		expect(chips().map((b) => b.textContent?.trim())).toEqual(['West Bengal', 'Kerala', 'Bihar']);
	});

	it('adds nothing with no State picked, a State already there, or no pop-up open', async () => {
		const closed = mount();
		await settle(closed.fixture);
		closed.page.stateToAdd.set('29');
		closed.page.addState();
		expect(closed.page.form()).toBeNull();
		expect(closed.page.hasState('19')).toBe(false);
		const { page } = await editing();
		page.addState();
		page.stateToAdd.set('32');
		page.addState();
		expect(page.form()?.states.map((s) => s.stateCode)).toEqual(['19', '32']);
		expect(page.stateAt()).toBe(0);
	});

	it('removes the State shown and goes back to the first; the last one cannot be removed from the pop-up', async () => {
		const { page, redraw } = await editing();
		chips()[1]?.click();
		redraw();
		expect(modal('#pr_state_remove')?.textContent).toContain('payroll_state_remove');
		modal<HTMLButtonElement>('#pr_state_remove')?.click();
		redraw();
		expect(page.form()?.states.map((s) => s.stateCode)).toEqual(['19']);
		expect(page.stateAt()).toBe(0);
		expect(modal('#pr_state_remove')).toBeNull();
	});

	it('asks for at least one State when none is left, and edits nothing then', async () => {
		const { page, redraw } = await editing();
		page.removeState(1);
		page.removeState(0);
		redraw();
		expect(modal('.text-danger.d-block')?.textContent).toContain('payroll_states_none');
		expect(page.picked()).toBeNull();
		expect(modal('#pr_pt_freq')).toBeNull();
		page.setSlab(0, { tax: 5 });
		page.addSlab();
		page.removeSlab(0);
		expect(page.form()?.states).toEqual([]);
	});

	it('changes nothing in the States before the pop-up opens, and opens on the first State again', async () => {
		const { page, fixture } = mount();
		page.patchState({ ptDueDay: 1 });
		page.removeState(0);
		expect(page.form()).toBeNull();
		await settle(fixture);
		(fixture.nativeElement.querySelector('#rules_add') as HTMLButtonElement).click();
		page.stateAt.set(1);
		(fixture.nativeElement.querySelector('#rules_add') as HTMLButtonElement).click();
		expect(page.stateAt()).toBe(0);
	});

	it('saves each State’s set in paise, the new one included', async () => {
		const { page, calls, redraw } = await editing();
		enter(modal('#pr_state_pick'), '10');
		redraw();
		modal<HTMLButtonElement>('#pr_state_add')?.click();
		redraw();
		enter(slabRows()[0]?.querySelector('input[aria-label="payroll_f_pt_tax"]'), '200');
		redraw();
		await page.save();
		const sent = calls.addRules.mock.lastCall as unknown as [{ states: StatePayrollRules[] }];
		expect(sent[0].states).toEqual([
			WEST_BENGAL,
			KERALA,
			{
				stateCode: '10',
				ptFrequency: 'monthly',
				ptSlabs: [{ upToPaise: null, taxPaise: 20_000 }],
				ptMonths: [],
				ptDueDay: 21,
				lwfEmployeePaise: 0,
				lwfEmployerPaise: 0,
				lwfMonths: [],
				lwfDueDay: 15,
			},
		]);
	});
});

describe('a State saved with no professional tax getting slabs again (ST1)', () => {
	it('gives the State its open top slab first, then adds capped slabs below it', async () => {
		const { page } = await editing(
			version('v4', '2026-04-01', { states: [state('19', { ptFrequency: 'none', ptSlabs: [] })] }),
		);
		expect(page.picked()?.ptSlabs).toEqual([]);
		page.patchState({ ptFrequency: 'monthly' });
		page.addSlab();
		expect(page.picked()?.ptSlabs).toMatchObject([{ upTo: null, tax: 0 }]);
		page.addSlab();
		expect(page.picked()?.ptSlabs).toMatchObject([
			{ upTo: 0, tax: 0 },
			{ upTo: null, tax: 0 },
		]);
	});
});
