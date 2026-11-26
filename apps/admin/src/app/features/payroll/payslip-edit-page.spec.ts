import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { NEVER, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PayrollGateway } from '@core/accounts/payroll.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import {
	DEDUCTION_KINDS,
	EARNING_KINDS,
	PAYSLIP_DEDUCTIONS,
	PAYSLIP_HEADS,
	PayslipEditPage,
	rulesOf,
} from './payslip-edit-page';

import type { PayrollRow } from '@saha-textile/contracts';

/**
 * Edit payslip (brief 26 PE1, PE2): every line of a draft payslip typed over or added to, worked out again as it is
 * typed by the run's own rules, "By the rules" beside each line with ↺ and its reason, and the checks.
 */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
/** ₹20,000 a month: basic 10,000, HRA 5,000, special 5,000; PF on basic, ESI under ₹21,000, PT ₹150, TDS ₹1,000. */
const row = (over: Record<string, unknown> = {}) =>
	({
		employeeId: 'e1',
		name: 'Asha Das',
		locationId: 'l1',
		paidDays: 30,
		grossPaise: 2_000_000,
		pfWagesPaise: 1_000_000,
		pfEmployeePaise: 120_000,
		pfEmployerPaise: 120_000,
		epsPaise: 83_300,
		esiEmployeePaise: 15_000,
		esiEmployerPaise: 65_000,
		ptPaise: 15_000,
		tdsPaise: 100_000,
		advancePaise: 50_000,
		netPaise: 1_700_000,
		stateCode: '19',
		headsPaise: { basic: 1_000_000, hra: 500_000, special: 500_000 },
		...over,
	}) as unknown as PayrollRow;
const WEST_BENGAL = {
	stateCode: '19',
	ptFrequency: 'monthly',
	ptSlabs: [
		{ upToPaise: 1_000_000, taxPaise: 0 },
		{ upToPaise: 2_500_000, taxPaise: 15_000 },
		{ upToPaise: null, taxPaise: 20_000 },
	],
	ptMonths: [],
	ptDueDay: 21,
	lwfEmployeePaise: 0,
	lwfEmployerPaise: 0,
	lwfMonths: [],
	lwfDueDay: 15,
	minimumWages: [{ from: '2026-04-01', levels: { skilled: 900_000 } }],
};
const version = (over: Record<string, unknown> = {}) => ({
	id: 'v5',
	from: '2026-04-01',
	pfRatePct: 12,
	pfWageCapPaise: 1_500_000,
	epsRatePct: 8.33,
	epsCapPaise: 125_000,
	esiEmployeePct: 0.75,
	esiEmployerPct: 3.25,
	esiGrossLimitPaise: 2_100_000,
	states: [WEST_BENGAL],
	...over,
});
const ASHA = { id: 'e1', name: 'Asha Das', pfOn: true, esiOn: true, gender: 'woman', skillLevel: 'skilled' };

interface Options {
	run?: unknown;
	employees?: unknown[];
	versions?: unknown[];
	params?: Record<string, string>;
	gateway?: Record<string, unknown>;
}

async function editing(options: Options = {}) {
	TestBed.resetTestingModule();
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const current = { value: options.run ?? { month: '2026-11', status: 'draft', rows: [row()] } };
	const gateway = {
		run: vi.fn(() => (current.value === null ? NEVER : of(current.value))),
		employees: vi.fn(() => of(options.employees ?? [ASHA])),
		rules: vi.fn(() => of(options.versions ?? [version()])),
		editPayslip: vi.fn(() => of({})),
		...options.gateway,
	};
	TestBed.configureTestingModule({
		imports: [
			PayslipEditPage,
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
				provide: ActivatedRoute,
				useValue: { paramMap: of(convertToParamMap(options.params ?? { month: '2026-11', employeeId: 'e1' })) },
			},
			{ provide: PayrollGateway, useValue: gateway },
			{ provide: NotificationService, useValue: notifier },
			{ provide: AuthStore, useValue: { permissions: signal(['accounts.index', 'accounts.edit']) } },
		],
	});
	const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
	const fixture = TestBed.createComponent(PayslipEditPage);
	fixture.detectChanges();
	await settle(fixture);
	const find = <T extends HTMLElement = HTMLInputElement>(selector: string) =>
		fixture.nativeElement.querySelector(selector) as T | null;
	const enter = async (box: Element | null, value: string) => {
		(box as HTMLInputElement).value = value;
		box?.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
		await settle(fixture);
	};
	return {
		fixture,
		page: fixture.componentInstance,
		gateway,
		notifier,
		navigate,
		current,
		find,
		enter,
		settle: () => settle(fixture),
	};
}

const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim();

describe('a payslip as the rules made it', () => {
	it('keeps the rules’ payslip saved on an edited row, and builds it from the row otherwise', () => {
		const byRules = { ...rulesOf(row()), netPaise: 1 };
		expect(rulesOf(row({ byRules }))).toBe(byRules);
		expect(rulesOf(row())).toEqual({
			headsPaise: { basic: 1_000_000, hra: 500_000, special: 500_000 },
			grossPaise: 2_000_000,
			pfEmployeePaise: 120_000,
			pfEmployerPaise: 120_000,
			esiEmployeePaise: 15_000,
			esiEmployerPaise: 65_000,
			ptPaise: 15_000,
			tdsPaise: 100_000,
			advancePaise: 50_000,
			netPaise: 1_700_000,
		});
		expect(rulesOf(row({ headsPaise: undefined })).headsPaise).toEqual({});
		expect([PAYSLIP_HEADS.length, PAYSLIP_DEDUCTIONS, EARNING_KINDS, DEDUCTION_KINDS]).toEqual([
			6,
			['pf', 'esi', 'pt', 'tds', 'advance'],
			['taxable', 'exempt', 'reimbursement', 'arrears'],
			['after_tax', 'before_tax', 'tax_adjustment'],
		]);
	});
});

describe('Edit payslip (PE1, PE2)', () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-26T06:00:00.000Z'));
	});
	afterEach(() => vi.useRealTimers());

	it('opens a draft payslip as the rules made it: its heads, every deduction, the totals and no checks', async () => {
		const { page, find } = await editing();
		expect(text(find('h5.mb-1'))).toBe('Asha Das · 2026-11');
		expect(text(find('h5.mb-1 + small'))).toBe('pe_sub');
		expect(page.edits()).toEqual({ heads: {}, added: [], deductions: {}, reasons: {} });
		expect(page.lines()).toEqual(page.byRules());
		expect(page.lines()).toMatchObject({
			grossPaise: 2_000_000,
			pfEmployeePaise: 120_000,
			esiEmployeePaise: 15_000,
			ptPaise: 15_000,
			tdsPaise: 100_000,
			advancePaise: 50_000,
			netPaise: 1_700_000,
		});
		// Only the heads the rules pay show; every deduction does.
		expect(PAYSLIP_HEADS.map((h) => !!find(`#pe_line_${h}`))).toEqual([true, false, true, false, true, false]);
		expect(PAYSLIP_DEDUCTIONS.map((d) => find(`#pe_line_${d}`)?.value)).toEqual([
			'1200',
			'150',
			'150',
			'1000',
			'500',
		]);
		expect(find('#pe_line_basic')?.value).toBe('10000');
		expect([find('#pe_reset_basic'), find('#pe_why_basic'), find('small.text-muted + small')]).toEqual([
			null,
			null,
			null,
		]);
		expect(text(find('#pe_gross'))).toBe(`${page.money(2_000_000)} → ${page.money(2_000_000)}`);
		expect(text(find('#pe_net'))).toBe(`${page.money(1_700_000)} → ${page.money(1_700_000)}`);
		expect(page.deductionsTotal(page.lines() as NonNullable<ReturnType<typeof page.lines>>)).toBe(300_000);
		expect(page.inWords()).toMatch(/seventeen thousand/i);
		expect([page.checks(), page.blocking(), text(find('.col-xl-4 p.text-muted'))]).toEqual([
			[],
			false,
			'pe_checks_none',
		]);
		expect(find<HTMLButtonElement>('#pe_save')?.disabled).toBe(false);
	});

	it('works a head typed over out again: PF, ESI and the State’s tax follow, and it asks why', async () => {
		const { page, find, enter } = await editing();
		await enter(find('#pe_line_basic'), '12000');
		expect([page.edits().heads, page.typed('basic'), page.rule('basic'), page.now('basic')]).toEqual([
			{ basic: 1_200_000 },
			true,
			1_000_000,
			1_200_000,
		]);
		// ₹22,000 is over ESI's ₹21,000; PF is 12% of the new basic; the State's slab still gives ₹150.
		expect(page.lines()).toMatchObject({
			grossPaise: 2_200_000,
			pfEmployeePaise: 144_000,
			esiEmployeePaise: 0,
			ptPaise: 15_000,
			netPaise: 2_200_000 - 144_000 - 15_000 - 100_000 - 50_000,
		});
		expect(page.now('pf')).toBe(144_000);
		// PF was not typed: its "why" cell says it follows the lines above.
		const pfWhy = find('#pe_line_pf')?.closest('td')?.nextElementSibling as HTMLElement;
		expect(text(pfWhy.querySelector('small'))).toBe('pe_follows');
		expect(find('#pe_reset_basic')?.title).toBe('pe_reset');
		const check = find('#pe_check_reason_needed_basic') as HTMLElement;
		expect([check.classList.contains('alert-warning'), text(check)]).toEqual([true, 'pe_check_reason_needed']);
		expect(page.lineWord('basic')).toBe('payroll_head_basic');
		await enter(find('#pe_why_basic'), 'Promoted to senior');
		expect([page.edits().reasons, find('#pe_check_reason_needed_basic')]).toEqual([
			{ basic: 'Promoted to senior' },
			null,
		]);
		find<HTMLButtonElement>('#pe_reset_basic')?.click();
		expect([page.edits().heads, page.edits().reasons, page.typed('basic')]).toEqual([{}, {}, false]);
	});

	it('takes a line in rupees never below nothing, and a cleared box back to the rules, heads and deductions alike', async () => {
		const { page, find, enter } = await editing();
		page.setLine('da', 'lots');
		page.setLine('hra', -5);
		page.setLine('advance', '12.345');
		expect([page.edits().heads, page.edits().deductions]).toEqual([{ da: 0, hra: 0 }, { advance: 1_235 }]);
		await enter(find('#pe_line_advance'), '');
		page.setLine('hra', undefined);
		page.setLine('da', null);
		expect([page.edits().heads, page.edits().deductions]).toEqual([{}, {}]);
		page.setReason('pf', '');
		expect(page.edits().reasons).toEqual({});
	});

	it('refuses PF below the law and a lower TDS without a reason, and warns of tax off the slab', async () => {
		const { page, find, enter } = await editing();
		await enter(find('#pe_line_pf'), '500');
		const pf = find('#pe_check_pf_below_law_pf') as HTMLElement;
		expect([pf.classList.contains('alert-danger'), page.blocking()]).toEqual([true, true]);
		expect(find<HTMLButtonElement>('#pe_save')?.disabled).toBe(false);
		await enter(find('#pe_line_tds'), '0');
		expect(find('#pe_check_tds_lowered_without_reason_tds')?.classList.contains('alert-danger')).toBe(true);
		// TDS asks for its reason only in its own check.
		expect(find('#pe_check_reason_needed_tds')).toBeNull();
		await enter(find('#pe_why_tds'), 'Declared rent after the run');
		expect(find('#pe_check_tds_lowered_without_reason_tds')).toBeNull();
		await enter(find('#pe_line_pt'), '200');
		expect(find('#pe_check_pt_off_slab_pt')?.classList.contains('alert-warning')).toBe(true);
		expect(page.lineWord('pt')).toBe('pe_deduction_pt');
		find<HTMLButtonElement>('#pe_reset_pf')?.click();
		await enter(find('#pe_line_esi'), '0');
		expect(find('#pe_check_esi_below_law_esi')).not.toBeNull();
	});

	it('refuses a payslip whose net goes below nothing or whose deductions pass half the wages', async () => {
		const { page, find, enter } = await editing();
		await enter(find('#pe_line_advance'), '30000');
		expect(page.checks().map((c) => c.code)).toEqual(['net_below_zero', 'deductions_over_half', 'reason_needed']);
		expect(text(find('#pe_check_net_below_zero'))).toBe('pe_check_net_below_zero');
	});

	it('warns when the heads fall under the State’s minimum wage for the person’s skill', async () => {
		const { page, find, enter } = await editing();
		await enter(find('#pe_line_basic'), '8000');
		expect(page.checks().map((c) => c.code)).toEqual(['reason_needed', 'below_minimum_wage']);
		expect(find('#pe_check_below_minimum_wage')?.classList.contains('alert-warning')).toBe(true);
	});

	it('adds earnings and deductions of any kind, named before saving, never below nothing, monthly or once', async () => {
		const { page, find, enter, settle } = await editing();
		await enter(find('#pe_add_earning_kind'), 'reimbursement');
		find<HTMLButtonElement>('#pe_add_earning')?.click();
		await settle();
		const earning = page.earningLines()[0];
		expect(earning).toEqual({
			id: `l${Date.now().toString(36)}0`,
			kind: 'reimbursement',
			name: '',
			paise: 0,
			oneOff: true,
		});
		const id = earning?.id ?? '';
		expect(find(`#pe_added_name_${id}`)?.classList.contains('is-invalid')).toBe(true);
		expect([page.unnamed(), find<HTMLButtonElement>('#pe_save')?.disabled]).toEqual([true, true]);
		expect(text(find(`#pe_added_name_${id} + small`))).toBe('pe_kind_reimbursement · pe_one_off');
		await enter(find(`#pe_added_name_${id}`), 'Travel to Sodepur');
		await enter(find(`#pe_added_amount_${id}`), '250.5');
		expect([page.unnamed(), page.edits().added[0]?.paise, page.lines()?.reimbursementsPaise]).toEqual([
			false,
			25_050,
			25_050,
		]);
		page.setAmount(id, -3);
		expect(page.edits().added[0]?.paise).toBe(0);
		page.setAmount(id, 'a lot');
		expect(page.edits().added[0]?.paise).toBe(0);
		find(`#pe_added_monthly_${id}`)?.click();
		await settle();
		expect([page.edits().added[0]?.oneOff, text(find(`#pe_added_name_${id} + small`))]).toEqual([
			false,
			'pe_kind_reimbursement · pe_monthly',
		]);
		await enter(find('#pe_add_deduction_kind'), 'before_tax');
		find<HTMLButtonElement>('#pe_add_deduction')?.click();
		await settle();
		const deduction = page.deductionLines()[0];
		expect([deduction?.kind, deduction?.id]).toEqual(['before_tax', `l${Date.now().toString(36)}1`]);
		await enter(find(`#pe_added_name_${deduction?.id}`), 'Canteen');
		await enter(find(`#pe_added_amount_${deduction?.id}`), '300');
		expect(text(find(`#pe_added_name_${deduction?.id} + small`))).toBe('pe_kind_before_tax');
		expect(page.lines()?.otherDeductionsPaise).toBe(30_000);
		find<HTMLButtonElement>(`#pe_added_remove_${deduction?.id}`)?.click();
		find<HTMLButtonElement>(`#pe_added_remove_${id}`)?.click();
		expect(page.edits().added).toEqual([]);
	});

	it('saves the edits to the draft run and goes back to it, or names a refusal', async () => {
		const { page, gateway, notifier, navigate, find, enter } = await editing();
		await enter(find('#pe_line_basic'), '11000');
		find<HTMLButtonElement>('#pe_save')?.click();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(gateway.editPayslip).toHaveBeenCalledWith('2026-11', 'e1', page.edits());
		expect(notifier.showSuccess).toHaveBeenCalledWith('pe_saved');
		expect(navigate).toHaveBeenCalledWith(['/payroll/runs'], { queryParams: { month: '2026-11' } });
		gateway.editPayslip.mockReturnValueOnce(throwError(() => ({ error: { message: 'run_not_draft' } })));
		await page.save();
		expect(notifier.showError).toHaveBeenCalledWith('payroll_problem_run_not_draft');
		expect(page.busy()).toBe(false);
	});

	it('opens the edits saved on the row, once, and keeps what is typed when the run is read again', async () => {
		const saved = {
			heads: { hra: 600_000 },
			added: [{ id: 'la', kind: 'taxable', name: 'Festival bonus', paise: 200_000, oneOff: true }],
			deductions: {},
			reasons: { hra: 'Moved to a metro' },
		};
		const { page, find, current } = await editing({
			run: { month: '2026-11', status: 'draft', rows: [row({ edits: saved })] },
		});
		expect(page.edits()).toEqual(saved);
		expect(page.edits()).not.toBe(saved);
		expect(find('#pe_why_hra')?.value).toBe('Moved to a metro');
		page.setLine('hra', 700);
		current.value = { month: '2026-11', status: 'draft', rows: [row({ edits: { ...saved, heads: {} } })] };
		await page.run.refetch();
		expect(page.edits().heads).toEqual({ hra: 70_000 });
	});

	it('shows an approved run’s payslip without Save', async () => {
		const { find } = await editing({ run: { month: '2026-11', status: 'approved', rows: [row()] } });
		expect(text(find('h5.mb-1 + small'))).toBe('pe_not_draft');
		expect(find<HTMLButtonElement>('#pe_save')?.disabled).toBe(true);
	});

	it('works nothing out without the person, the rules in force, or the row', async () => {
		const stranger = await editing({ employees: [] });
		expect([stranger.page.lines(), stranger.page.byRules(), stranger.page.checks()]).toEqual([null, null, []]);
		expect(text(stranger.find('h5.mb-1'))).toBe('e1 · 2026-11');
		expect([stranger.page.rule('basic'), stranger.page.now('pf'), stranger.page.inWords()]).toEqual([
			0,
			0,
			stranger.page.inWords(),
		]);
		expect([stranger.find('#pe_gross'), stranger.find<HTMLButtonElement>('#pe_save')?.disabled]).toEqual([
			null,
			true,
		]);
		const noRules = await editing({ versions: [] });
		expect(noRules.page.lines()).toBeNull();
		const noRow = await editing({ run: { month: '2026-11', status: 'draft', rows: [] } });
		expect([noRow.page.row(), noRow.page.base(), noRow.page.edits().heads]).toEqual([null, null, {}]);
		const noMonth = await editing({ params: {} });
		expect([noMonth.page.month(), noMonth.page.employeeId(), noMonth.gateway.run.mock.calls.length]).toEqual([
			'',
			'',
			0,
		]);
	});

	it('charges no State tax on a changed gross for a row with no State, or a version without States', async () => {
		const noState = await editing({
			run: { month: '2026-11', status: 'draft', rows: [row({ stateCode: undefined })] },
		});
		expect(noState.page.stateRules()).toBeNull();
		expect(noState.page.lines()?.ptPaise).toBe(15_000);
		noState.page.setLine('basic', 11_000);
		expect(noState.page.lines()?.ptPaise).toBe(0);
		const noStates = await editing({ versions: [version({ states: undefined })] });
		expect(noStates.page.stateRules()).toBeNull();
	});
});
