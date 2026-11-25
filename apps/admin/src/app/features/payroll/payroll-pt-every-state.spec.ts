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
	slabToForm,
	slabToWrite,
	startingForm,
	stateToForm,
	stateToWrite,
	yearMostOf,
	type StateForm,
} from './payroll-rules-page';

import type { PayrollRulesVersion, StatePayrollRules } from '@saha-textile/contracts';

/** Professional tax that fits every State (brief 26 PT1–PT4): women's slabs, a month of its own, exemptions, starts. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const rupees = (n: number) => n * 100;
const state = (stateCode: string, over: Partial<StatePayrollRules> = {}): StatePayrollRules => ({
	stateCode,
	ptFrequency: 'monthly',
	ptSlabs: [
		{ upToPaise: rupees(10_000), taxPaise: 0 },
		{ upToPaise: null, taxPaise: rupees(200) },
	],
	ptMonths: [],
	ptDueDay: 21,
	lwfEmployeePaise: 300,
	lwfEmployerPaise: 1_500,
	lwfMonths: [6, 12],
	lwfDueDay: 15,
	...over,
});
const form = (over: Partial<StateForm> = {}): StateForm => ({ ...stateToForm(state('19')), ...over });

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

interface Popup {
	view: EmbeddedViewRef<unknown>;
}

async function editing(states: StatePayrollRules[] = [state('19')]) {
	TestBed.resetTestingModule();
	document.body.querySelectorAll('.pt-test-modal').forEach((node) => node.remove());
	const popups: Popup[] = [];
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
			{ provide: PayrollGateway, useValue: { rules: vi.fn(() => of([version(states)])), addRules: vi.fn() } },
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
						holder.className = 'pt-test-modal';
						holder.append(...(view.rootNodes as Node[]));
						document.body.append(holder);
						popups.push({ view });
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
	const popup = popups[0] as Popup;
	const redraw = async () => {
		popup.view.detectChanges();
		await new Promise((resolve) => setTimeout(resolve, 0));
		popup.view.detectChanges();
	};
	await redraw();
	return { page: fixture.componentInstance, redraw };
}

const modal = <T extends HTMLElement = HTMLElement>(selector: string) =>
	document.querySelector(`.pt-test-modal ${selector}`) as T | null;
const modalAll = <T extends HTMLElement = HTMLElement>(selector: string) =>
	[...document.querySelectorAll(`.pt-test-modal ${selector}`)] as T[];
const enter = async (redraw: () => Promise<void>, box: Element | null | undefined, value: string) => {
	(box as HTMLInputElement).value = value;
	box?.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
	await redraw();
};
/** A slab table's rows, by its place: 0 everyone's, 1 the women's. */
const slabRows = (table = 0) => [...(modalAll('table')[table]?.querySelectorAll('tbody tr') ?? [])] as HTMLElement[];

describe('a slab with a month of its own, as a form and back (PT1)', () => {
	it('reads the month and its tax, or none, in rupees', () => {
		expect(
			slabToForm({ upToPaise: null, taxPaise: rupees(200), otherMonth: { month: 2, taxPaise: rupees(300) } }),
		).toEqual({
			upTo: null,
			tax: 200,
			otherMonth: 2,
			otherTax: 300,
		});
		expect(slabToForm({ upToPaise: rupees(7_500), taxPaise: 0 })).toEqual({
			upTo: 7_500,
			tax: 0,
			otherMonth: null,
			otherTax: 0,
		});
	});

	it('writes the month only when the slab has one, so a plain slab is written as before', () => {
		expect(slabToWrite({ upTo: null, tax: 200, otherMonth: 2, otherTax: 300 })).toEqual({
			upToPaise: null,
			taxPaise: rupees(200),
			otherMonth: { month: 2, taxPaise: rupees(300) },
		});
		expect(slabToWrite({ upTo: 7_500, tax: 175, otherMonth: null, otherTax: 0 })).toEqual({
			upToPaise: rupees(7_500),
			taxPaise: rupees(175),
		});
	});
});

describe('a State’s professional tax as a form and back (PT1, PT2)', () => {
	it('reads the women’s slabs, the basis and the exemptions, or their defaults when the State has none', () => {
		const full = stateToForm(
			state('27', {
				ptWomenSlabs: [{ upToPaise: null, taxPaise: rupees(200) }],
				ptBasis: 'actual',
				ptExemptFromAge: 65,
				ptExemptDisability: true,
			}),
		);
		expect(full).toMatchObject({ ptWomen: true, ptBasis: 'actual', ptExemptAge: 65, ptExemptDisability: true });
		expect(full.ptWomenSlabs).toEqual([{ upTo: null, tax: 200, otherMonth: null, otherTax: 0 }]);
		expect(stateToForm(state('19'))).toMatchObject({
			ptWomen: false,
			ptWomenSlabs: [],
			ptBasis: 'projected',
			ptExemptAge: null,
			ptExemptDisability: false,
		});
	});

	it('writes each only when it is set, so a State without them is saved as before', () => {
		expect(stateToWrite(form())).toEqual(state('19'));
		const women = [{ upTo: null, tax: 0, otherMonth: null, otherTax: 0 }];
		expect(
			stateToWrite(
				form({
					ptWomen: true,
					ptWomenSlabs: women,
					ptBasis: 'actual',
					ptExemptAge: 65,
					ptExemptDisability: true,
				}),
			),
		).toMatchObject({
			ptWomenSlabs: [{ upToPaise: null, taxPaise: 0 }],
			ptBasis: 'actual',
			ptExemptFromAge: 65,
			ptExemptDisability: true,
		});
		expect('ptWomenSlabs' in stateToWrite(form({ ptWomen: true, ptWomenSlabs: women, ptFrequency: 'none' }))).toBe(
			false,
		);
		expect('ptWomenSlabs' in stateToWrite(form({ ptWomen: false, ptWomenSlabs: women }))).toBe(false);
	});

	it('works out the most one person can pay in a year under the State as typed', () => {
		expect(yearMostOf(form())).toBe(rupees(2_400));
		const february = form({ ptSlabs: [{ upTo: null, tax: 200, otherMonth: 2, otherTax: 300 }] });
		expect(yearMostOf(february)).toBe(rupees(2_500));
		expect(
			yearMostOf(
				form({ ptWomen: true, ptWomenSlabs: [{ upTo: null, tax: 300, otherMonth: null, otherTax: 0 }] }),
			),
		).toBe(rupees(3_600));
	});
});

describe('a State’s starting set (PT4)', () => {
	it('starts Maharashtra with its women’s slabs, February’s ₹300, the age and disability exemptions', () => {
		const maharashtra = startingForm('27', {
			stateCode: '27',
			label: 'Maharashtra',
			from: '2025-04-01',
			check: '',
			rules: {
				ptFrequency: 'monthly',
				ptSlabs: [
					{ upToPaise: rupees(7_500), taxPaise: 0 },
					{ upToPaise: null, taxPaise: rupees(200), otherMonth: { month: 2, taxPaise: rupees(300) } },
				],
				ptWomenSlabs: [
					{ upToPaise: null, taxPaise: rupees(200), otherMonth: { month: 2, taxPaise: rupees(300) } },
				],
				ptMonths: [],
				ptDueDay: 31,
				ptExemptFromAge: 65,
				ptExemptDisability: true,
			},
		});
		expect(maharashtra).toMatchObject({
			stateCode: '27',
			ptWomen: true,
			ptExemptAge: 65,
			ptExemptDisability: true,
			ptDueDay: 31,
			ptBasis: 'projected',
		});
		expect(maharashtra.ptSlabs[1]).toEqual({ upTo: null, tax: 200, otherMonth: 2, otherTax: 300 });
	});

	it('starts Tamil Nadu half-yearly on actual pay, and a State with no set blank with no tax', () => {
		const tamilNadu = startingForm('33', {
			stateCode: '33',
			label: 'Tamil Nadu',
			from: '2025-04-01',
			check: '',
			rules: {
				ptFrequency: 'half_yearly',
				ptBasis: 'actual',
				ptSlabs: [{ upToPaise: null, taxPaise: 0 }],
				ptMonths: [9, 3],
				ptDueDay: 30,
			},
		});
		expect(tamilNadu).toMatchObject({
			ptFrequency: 'half_yearly',
			ptBasis: 'actual',
			ptMonths: '9, 3',
			ptWomen: false,
		});
		expect(startingForm('10', undefined)).toEqual({
			stateCode: '10',
			ptFrequency: 'monthly',
			ptSlabs: [{ upTo: null, tax: 0, otherMonth: null, otherTax: 0 }],
			ptWomen: false,
			ptWomenSlabs: [],
			ptBasis: 'projected',
			ptExemptAge: null,
			ptExemptDisability: false,
			ptMonths: '',
			ptDueDay: 21,
			lwfEmployee: 0,
			lwfEmployer: 0,
			lwfMonths: '',
			lwfDueDay: 15,
		});
	});
});

describe('the State tax section of the pop-up (PT1–PT4)', () => {
	it('offers a State’s starting sets when it has some, adds it from the set picked, and starts the next one afresh', async () => {
		const { page, redraw } = await editing();
		await enter(redraw, modal('#pr_state_pick'), '27');
		expect([page.stateToAdd(), page.startFrom()]).toEqual(['27', 'Maharashtra']);
		expect(
			[...(modal<HTMLSelectElement>('#pr_state_start')?.options ?? [])].map((o) => [
				o.value,
				o.textContent?.trim(),
			]),
		).toEqual([
			['Maharashtra', 'payroll_state_start_set'],
			['', 'payroll_state_start_blank'],
		]);
		(modal('#pr_state_add') as HTMLButtonElement).click();
		await redraw();
		expect(page.picked()).toMatchObject({ stateCode: '27', ptWomen: true, ptExemptAge: 65 });
		expect([page.stateToAdd(), page.startFrom()]).toEqual(['', '']);
		await enter(redraw, modal('#pr_state_pick'), '10');
		expect([page.startFrom(), modal('#pr_state_start')]).toEqual(['', null]);
		(modal('#pr_state_add') as HTMLButtonElement).click();
		await redraw();
		expect(page.picked()).toEqual(startingForm('10', undefined));
	});

	it('copies everyone’s slabs into separate women’s slabs, keeps them when switched back on, and edits that list', async () => {
		const { page, redraw } = await editing();
		expect([page.listsOf(page.picked() as StateForm), modal('#pr_slab_add_women')]).toEqual([['ptSlabs'], null]);
		(modal('#pr_pt_women') as HTMLButtonElement).click();
		await redraw();
		expect(page.picked()?.ptWomenSlabs).toEqual(page.picked()?.ptSlabs);
		expect(page.listsOf(page.picked() as StateForm)).toEqual(['ptSlabs', 'ptWomenSlabs']);
		expect(page.slabsOf(page.picked() as StateForm, 'ptWomenSlabs')).toHaveLength(2);
		expect(modalAll('h6').map((h) => h.textContent?.trim())).toContain('payroll_pt_list_ptWomenSlabs');
		await enter(redraw, slabRows(1)[0]?.querySelector('input[aria-label="payroll_f_pt_up_to"]'), '25000');
		(modal('#pr_slab_add_women') as HTMLButtonElement).click();
		await redraw();
		expect(page.picked()?.ptWomenSlabs.map((s) => s.upTo)).toEqual([25_000, 0, null]);
		(slabRows(1)[1]?.querySelector('button') as HTMLButtonElement).click();
		await redraw();
		expect(page.picked()?.ptWomenSlabs.map((s) => s.upTo)).toEqual([25_000, null]);
		expect(page.picked()?.ptSlabs.map((s) => s.upTo)).toEqual([10_000, null]);
		(modal('#pr_pt_same') as HTMLButtonElement).click();
		await redraw();
		expect([page.picked()?.ptWomen, modal('#pr_slab_add_women')]).toEqual([false, null]);
		page.setWomen(true);
		expect(page.picked()?.ptWomenSlabs.map((s) => s.upTo)).toEqual([25_000, null]);
	});

	it('asks what a half-yearly or yearly tax is worked on, and who is exempt', async () => {
		const { page, redraw } = await editing();
		expect(modal('#pr_pt_basis_actual')).toBeNull();
		await enter(redraw, modal('#pr_pt_freq'), 'half_yearly');
		modal<HTMLInputElement>('#pr_pt_basis_actual')?.click();
		await redraw();
		expect(page.picked()?.ptBasis).toBe('actual');
		await enter(redraw, modal('#pr_pt_exempt_age'), '65');
		expect(page.picked()?.ptExemptAge).toBe(65);
		await enter(redraw, modal('#pr_pt_exempt_age'), '');
		expect(page.picked()?.ptExemptAge).toBeNull();
		modal<HTMLInputElement>('#pr_pt_exempt_dis')?.click();
		await redraw();
		expect(page.picked()?.ptExemptDisability).toBe(true);
		modal<HTMLInputElement>('#pr_pt_exempt_dis')?.click();
		await redraw();
		expect(page.picked()?.ptExemptDisability).toBe(false);
	});

	it('takes a month with its own tax, and warns when a person would pay more than ₹2,500 in a year', async () => {
		const { page, redraw } = await editing();
		const year = () => modal('#pr_pt_year_most') as HTMLElement;
		expect([page.yearMost(), page.overYearCap(), page.yearMostText()]).toEqual([rupees(2_400), false, '2,400']);
		expect(year().classList.contains('text-muted')).toBe(true);
		const top = () => slabRows(0)[1] as HTMLElement;
		expect(top().querySelector('input[aria-label="payroll_pt_other_tax"]')).toBeNull();
		const month = top().querySelector('select') as HTMLSelectElement;
		month.selectedIndex = 2;
		month.dispatchEvent(new Event('change'));
		await redraw();
		expect(page.picked()?.ptSlabs[1]?.otherMonth).toBe(2);
		await enter(redraw, top().querySelector('input[aria-label="payroll_pt_other_tax"]'), '500');
		expect(page.yearMost()).toBe(rupees(2_700));
		expect(year().classList.contains('text-danger')).toBe(true);
		expect(year().textContent).toContain('payroll_pt_year_over');
		(top().querySelector('select') as HTMLSelectElement).selectedIndex = 0;
		top().querySelector('select')?.dispatchEvent(new Event('change'));
		await redraw();
		expect(page.picked()?.ptSlabs[1]?.otherMonth).toBeNull();
		expect(top().querySelector('input[aria-label="payroll_pt_other_tax"]')).toBeNull();
	});

	it('has nothing to work out, and no women’s slabs to switch, once no State is left', async () => {
		const { page } = await editing();
		page.removeState(0);
		page.setWomen(true);
		expect([page.picked(), page.yearMost(), page.form()?.states]).toEqual([null, 0, []]);
	});
});
