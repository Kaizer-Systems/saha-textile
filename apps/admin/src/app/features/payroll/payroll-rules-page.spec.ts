import { ApplicationRef, TemplateRef, signal, type EmbeddedViewRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { PayrollGateway } from '@core/accounts/payroll.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { PayrollRulesPage, inForce, ruleRows, statesOf, toForm, toWrite } from './payroll-rules-page';

/** Settings › Payroll rules (accounts brief S1): each rule as a dated version. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const refusal = (code: string) => ({ error: { message: code } });

const version = (id: string, from: string, over: Record<string, unknown> = {}) => ({
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
		{ upToPaise: 1_500_000, taxPaise: 11_000 },
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
	...over,
});
const OLD = version('v1', '2017-04-01', { builtIn: true, note: '' });
const NEW = version('v2', '2025-04-01');

interface Opened {
	close: ReturnType<typeof vi.fn>;
	dismiss: ReturnType<typeof vi.fn>;
	view: EmbeddedViewRef<unknown>;
}

function mount(gateway: Record<string, unknown> = {}, permissions = ['accounts.index', 'accounts.lock']) {
	TestBed.resetTestingModule();
	document.body.querySelectorAll('.pr-test-modal').forEach((node) => node.remove());
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const invalidate = vi.spyOn(queries, 'invalidateQueries');
	const opened: Opened[] = [];
	const calls = { rules: vi.fn(() => of([OLD, NEW])), addRules: vi.fn(() => of(NEW)), ...gateway };
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
			provideTanStackQuery(queries),
			provideRouter([]),
			{ provide: PayrollGateway, useValue: calls },
			{ provide: NotificationService, useValue: notifier },
			{ provide: AuthStore, useValue: { permissions: signal(permissions) } },
			{
				provide: NgbModal,
				useValue: {
					open: vi.fn((content: TemplateRef<unknown>) => {
						const ref = { close: vi.fn(), dismiss: vi.fn() };
						const view = content.createEmbeddedView({ $implicit: ref });
						TestBed.inject(ApplicationRef).attachView(view);
						view.detectChanges();
						const holder = document.createElement('div');
						holder.className = 'pr-test-modal';
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
	return { fixture, page: fixture.componentInstance, notifier, invalidate, opened, calls };
}

async function rules(gateway: Record<string, unknown> = {}, permissions?: string[]) {
	const harness = mount(gateway, permissions);
	await settle(harness.fixture);
	return harness;
}

const modal = (selector: string) => document.querySelector(`.pr-test-modal ${selector}`) as HTMLElement | null;
const enter = (control: Element | null | undefined, value: string) => {
	const box = control as HTMLInputElement;
	box.value = value;
	box.dispatchEvent(new Event('input'));
};

describe('a rules version as a form, and back', () => {
	it('shows money in rupees and the open top slab as empty, and writes it back in paise', () => {
		const form = toForm(NEW as never, '2026-04-01');
		expect(form).toMatchObject({
			from: '2026-04-01',
			note: '',
			pfWageCap: 15_000,
			esiGrossLimit: 21_000,
			pfAdminMin: 500,
			lwfEmployee: 3,
			lwfMonths: '6, 12',
		});
		expect(form.ptSlabs).toEqual([
			{ upTo: 10_000, tax: 0 },
			{ upTo: 15_000, tax: 110 },
			{ upTo: null, tax: 200 },
		]);
		const { id, builtIn, createdBy, createdAt, ...write } = NEW;
		expect([id, builtIn, createdBy, createdAt]).toBeTruthy();
		// ST1: a version saved before States reads its company-wide figures as West Bengal's set.
		expect(toWrite({ ...form, from: NEW.from, note: NEW.note })).toEqual({
			...write,
			states: statesOf(NEW as never),
		});
		expect(form.states.map((s) => s.stateCode)).toEqual(['19']);
	});

	it('keeps only months 1 to 12 from what is typed', () => {
		const form = toForm(NEW as never, '2026-04-01');
		expect(toWrite({ ...form, lwfMonths: ' 6, 12 ,x, 13, 0, 2.5,' }).lwfMonths).toEqual([6, 12]);
	});
});

describe('the version in force, and its rules in words', () => {
	it('takes the last version starting on or before the day, else the first, else none', () => {
		expect(inForce([OLD, NEW] as never, '2026-11-01')?.id).toBe('v2');
		expect(inForce([OLD, NEW] as never, '2020-01-01')?.id).toBe('v1');
		expect(inForce([NEW] as never, '2000-01-01')?.id).toBe('v2');
		expect(inForce([], '2026-11-01')).toBeNull();
	});

	it('lists the ten rules with their figures, the taxed PT slabs joined and the free slab’s top as “over”', () => {
		const rows = ruleRows(NEW as never);
		expect(rows.map((r) => r.key)).toEqual([
			'wages',
			'pf',
			'esi',
			'pt',
			'lwf',
			'deductions',
			'bonus',
			'gratuity',
			'tds',
			'min_wages',
		]);
		expect(rows[1]?.values).toMatchObject({ rate: '12', cap: '15,000', adminMin: '500', n: '20', day: '15' });
		expect(rows[3]?.values).toEqual({
			state: 'West Bengal',
			taxes: '₹110 / ₹200',
			over: '10,000',
			months: '',
			day: '21',
		});
		expect(rows[4]?.values).toMatchObject({ ee: '3', er: '15', months: '6, 12' });
		expect(rows[0]?.from).toBeNull();
		expect(rows[1]?.from).toBe('2025-04-01');
		const allTaxed = ruleRows(
			version('v3', '2026-04-01', { ptSlabs: [{ upToPaise: null, taxPaise: 20_000 }] }) as never,
		);
		expect(allTaxed[3]?.values).toMatchObject({ taxes: '₹200', over: '0' });
	});
});

describe('the payroll rules page (S1)', () => {
	it('shows the rules in force today and every version, the built-in one named so', async () => {
		const { fixture, page } = await rules();
		expect(page.current()?.id).toBe('v2');
		const text = fixture.nativeElement.textContent as string;
		expect(text).toContain('payroll_rule_pf_applies');
		expect(text).toContain('payroll_rule_wages_from');
		expect(text).toContain('payroll_rules_built_in');
		expect(text).toContain('Budget 2025');
		expect(text).toContain('payroll_rules_in_force');
		expect(page.day('2025-04-01')).toBeTruthy();
	});

	it('adds a version from today on the current figures, with its changes, and closes', async () => {
		const { fixture, page, opened, calls, notifier, invalidate } = await rules();
		(fixture.nativeElement.querySelector('#rules_add') as HTMLButtonElement).click();
		const popup = opened[0] as Opened;
		const form = page.form();
		expect(form?.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(form?.pfRatePct).toBe(12);
		enter(modal('#pr_from'), '2026-12-01');
		enter(modal('#pr_note'), 'Notification 12/2026');
		enter(modal('#pr_pf'), '10');
		enter(modal('#pr_pf_cap'), '18000');
		const slabs = [...document.querySelectorAll('.pr-test-modal tbody input')] as HTMLInputElement[];
		enter(slabs[0], '12000');
		page.setSlab(1, { tax: 150 });
		popup.view.detectChanges();
		const inputs = [...document.querySelectorAll('.pr-test-modal input')] as HTMLInputElement[];
		expect(inputs.length).toBeGreaterThan(25);
		for (const input of inputs.filter((i) => !i.id.startsWith('pr_from') && i.type === 'number' && i.id)) {
			enter(input, input.value || '1');
		}
		popup.view.detectChanges();
		await page.save();
		const sent = (calls.addRules.mock.lastCall as unknown as [Record<string, unknown>])[0];
		expect(sent).toMatchObject({
			from: '2026-12-01',
			note: 'Notification 12/2026',
			pfRatePct: 10,
			pfWageCapPaise: 1_800_000,
		});
		const westBengal = (sent['states'] as { ptSlabs: unknown[] }[])[0] as { ptSlabs: unknown[] };
		expect(westBengal.ptSlabs[0]).toEqual({ upToPaise: 1_200_000, taxPaise: 0 });
		expect(westBengal.ptSlabs[1]).toEqual({ upToPaise: 1_500_000, taxPaise: 15_000 });
		expect(notifier.showSuccess).toHaveBeenCalledWith('payroll_rules_added');
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['payroll', 'rules'] });
		expect(popup.close).toHaveBeenCalled();
		(modal('.btn-close') as HTMLButtonElement).click();
		expect(popup.dismiss).toHaveBeenCalled();
	});

	it('does nothing without a version to start from or a form open, and names a refusal', async () => {
		const empty = await rules({ rules: vi.fn(() => of([])) });
		expect(empty.page.rows()).toEqual([]);
		empty.page.open({} as never);
		expect(empty.opened).toHaveLength(0);
		empty.page.patch({ note: 'x' });
		empty.page.setSlab(0, { tax: 1 });
		expect(empty.page.form()).toBeNull();
		await empty.page.save();
		expect(empty.calls.addRules).not.toHaveBeenCalled();

		const addRules = vi
			.fn()
			.mockReturnValueOnce(throwError(() => refusal('payroll_rules_from_taken')))
			.mockReturnValueOnce(throwError(() => new Error('down')))
			.mockReturnValueOnce(of(NEW));
		const refused = await rules({ addRules });
		refused.page.form.set(toForm(NEW as never, '2026-12-01'));
		await refused.page.save();
		expect(refused.notifier.showError).toHaveBeenLastCalledWith('payroll_problem_payroll_rules_from_taken');
		await refused.page.save();
		expect(refused.notifier.showError).toHaveBeenLastCalledWith('payroll_problem_failed');
		await refused.page.save();
		expect(refused.notifier.showSuccess).toHaveBeenCalledWith('payroll_rules_added');
		expect(refused.page.busy()).toBe(false);
	});

	it('lets only someone who may lock the books add a version', async () => {
		const { fixture } = await rules({}, ['accounts.index', 'accounts.edit']);
		expect(fixture.nativeElement.querySelector('#rules_add')).toBeNull();
	});
});
