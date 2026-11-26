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

import { PayrollRulesPage, SKILL_LEVELS, startingForm, stateToForm, stateToWrite } from './payroll-rules-page';

import type { PayrollRulesVersion, StatePayrollRules } from '@saha-textile/contracts';

/**
 * Each State's minimum wages by skill level in Payroll rules (brief 26 SR4): sets dated by their notification, a
 * month's rupees per level (blank for none), saved in paise only when set.
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
	document.body.querySelectorAll('.mw-test-modal').forEach((node) => node.remove());
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
						holder.className = 'mw-test-modal';
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
	document.querySelector(`.mw-test-modal ${selector}`) as T | null;
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

const NOVEMBER = {
	from: '2026-10-01',
	levels: { unskilled: 1_050_000, semi_skilled: 1_155_000, skilled: 1_270_500 },
};

describe('minimum wages as a form and back', () => {
	it('reads each level’s paise as rupees, a level not set as none, and a State without any as none', () => {
		expect(stateToForm(state('19', { minimumWages: [NOVEMBER] })).minimumWages).toEqual([
			{
				from: '2026-10-01',
				levels: { unskilled: 10_500, semi_skilled: 11_550, skilled: 12_705, highly_skilled: null },
			},
		]);
		expect(stateToForm(state('19')).minimumWages).toEqual([]);
		expect(startingForm('27', undefined).minimumWages).toEqual([]);
		expect([...SKILL_LEVELS]).toEqual(['unskilled', 'semi_skilled', 'skilled', 'highly_skilled']);
	});

	it('writes each set in paise with only the levels set, and nothing for a State without any', () => {
		const form = stateToForm(state('19', { minimumWages: [NOVEMBER] }));
		expect(stateToWrite(form).minimumWages).toEqual([NOVEMBER]);
		expect(stateToWrite(stateToForm(state('19')))).not.toHaveProperty('minimumWages');
	});
});

describe('minimum wages in the add-a-version pop-up (SR4)', () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-26T06:00:00.000Z'));
	});
	afterEach(() => vi.useRealTimers());

	it('shows the State’s minimum wages on their own chip, a column for each skill level', async () => {
		const { page, redraw } = await editing();
		const chip = modal<HTMLButtonElement>('#pr_section_wages') as HTMLButtonElement;
		expect(chip.classList.contains('btn-outline')).toBe(true);
		await click(redraw, chip);
		expect([page.stateSection(), chip.classList.contains('btn-theme')]).toEqual(['wages', true]);
		expect([modal('#pr_pt_freq'), modal('#pr_holiday_add')]).toEqual([null, null]);
		const heads = [...(modal('#pr_wages_add')?.closest('div')?.nextElementSibling?.querySelectorAll('th') ?? [])];
		expect(heads.map((th) => text(th))).toEqual([
			'payroll_wages_from',
			'payroll_skill_unskilled',
			'payroll_skill_semi_skilled',
			'payroll_skill_skilled',
			'payroll_skill_highly_skilled',
			'',
		]);
		expect(text(modal('td[colspan="6"]'))).toBe('payroll_wages_none');
	});

	it('adds a set from today with no level set, dates it, sets each level never below nothing, and removes it', async () => {
		const { page, redraw } = await editing();
		page.stateSection.set('wages');
		await redraw();
		await click(redraw, modal('#pr_wages_add'));
		expect(page.picked()?.minimumWages).toEqual([
			{
				from: '2026-11-26',
				levels: { unskilled: null, semi_skilled: null, skilled: null, highly_skilled: null },
			},
		]);
		expect(modal('td[colspan="6"]')).toBeNull();
		await click(redraw, modal('#pr_wages_add'));
		await enter(redraw, modal('#pr_wages_from_0'), '2026-10-01');
		await enter(redraw, modal('#pr_wages_unskilled_0'), '10500');
		await enter(redraw, modal('#pr_wages_skilled_0'), '-20');
		page.setWageSet(0, null, 'semi_skilled', 'eleven');
		page.setWageSet(0, null, 'highly_skilled', '');
		page.setWageSet(0, null, null, 999);
		expect(page.picked()?.minimumWages[0]).toEqual({
			from: '2026-10-01',
			levels: { unskilled: 10_500, semi_skilled: 0, skilled: 0, highly_skilled: null },
		});
		await redraw();
		// A cleared date keeps the one before.
		await enter(redraw, modal('#pr_wages_from_0'), '');
		expect(page.picked()?.minimumWages[0]?.from).toBe('2026-10-01');
		await enter(redraw, modal('#pr_wages_unskilled_0'), '');
		expect(page.picked()?.minimumWages[0]?.levels.unskilled).toBeNull();
		// The other set is left as it was.
		expect(page.picked()?.minimumWages[1]?.from).toBe('2026-11-26');
		expect(modal('#pr_wages_remove_0')?.title).toBe('remove');
		await click(redraw, modal('#pr_wages_remove_0'));
		expect(page.picked()?.minimumWages.map((w) => w.from)).toEqual(['2026-11-26']);
	});

	it('reads the sets saved with the version', async () => {
		const { page, redraw } = await editing({
			version: version([state('19', { minimumWages: [NOVEMBER] }), state('27')]),
		});
		page.stateSection.set('wages');
		await redraw();
		expect([
			modal<HTMLInputElement>('#pr_wages_from_0')?.value,
			modal<HTMLInputElement>('#pr_wages_skilled_0')?.value,
			modal<HTMLInputElement>('#pr_wages_highly_skilled_0')?.value,
		]).toEqual(['2026-10-01', '12705', '']);
	});

	it('changes no minimum wages without a State picked', async () => {
		const { page } = await editing();
		page.stateAt.set(9);
		page.addWageSet();
		page.setWageSet(0, '2026-12-01', 'skilled', 100);
		page.removeWageSet(0);
		expect(page.form()?.states.map((s) => s.minimumWages)).toEqual([[], []]);
	});
});
