import { ApplicationRef, TemplateRef, signal, type EmbeddedViewRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { PayrollGateway } from '@core/accounts/payroll.gateway';
import { LocationsGateway } from '@core/locations/locations.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { rupees } from '@features/accounts/ledger-helpers';

import { currentMonth } from './attendance-page';
import { EmployeesPage, TAX_ROWS, employeeWrite, newDeclaration, yearOf } from './employees-page';

import type { EmployeeView, TaxDeclaration } from '@saha-textile/contracts';

/** Income tax on the employee form (brief 25 TX1): the year's declarations, and the year worked both ways. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const refusal = (code: string) => ({ error: { message: code } });
const THIS_YEAR = yearOf(currentMonth());

const declaration = (year: string, over: Partial<TaxDeclaration> = {}): TaxDeclaration => ({
	...newDeclaration(year, 'old'),
	chosenOn: '2026-04-05',
	rentMonthlyINR: 12_000,
	metroCity: true,
	s80cINR: 1_50_000,
	s80dINR: 25_000,
	homeLoanInterestINR: 0,
	proof: { rent: true, s80c: false, s80d: true, homeLoan: false },
	...over,
});
const employee = (id: string, over: Partial<EmployeeView> = {}) =>
	({
		id,
		name: 'Asha Das',
		code: 'E-001',
		userId: null,
		locationId: 'l1',
		joinedOn: '2025-06-01',
		leftOn: null,
		pan: 'ABCDE1234F',
		aadhaar: 'XXXX XXXX 1234',
		uan: '100200300400',
		esiNumber: '',
		ptState: '19',
		taxRegime: 'old',
		dateOfBirth: '1990-05-01',
		taxDeclarations: [declaration('2025-26', { s80cINR: 1_00_000 }), declaration(THIS_YEAR)],
		bankAccount: 'XXXXXX7788',
		ifsc: 'HDFC0001234',
		pfOn: true,
		esiOn: false,
		structure: { basic: 16_000, da: 0, hra: 6_400, special: 9_600, conveyance: 0, other: 0 },
		advanceDueINR: 0,
		advancePerMonthINR: 0,
		masked: true,
		createdAt: '2026-04-01T00:00:00.000Z',
		updatedAt: '2026-04-01T00:00:00.000Z',
		version: 3,
		...over,
	}) as EmployeeView;
const ASHA = employee('e1');
const RAFIQ = employee('e2', { name: 'Rafiq Ali', taxRegime: 'new', taxDeclarations: [] });

const working = (regime: 'new' | 'old', taxPaise: number) => ({
	regime,
	salaryPaise: 38_40_000_00,
	hraExemptPaise: regime === 'old' ? 1_44_000_00 : 0,
	standardDeductionPaise: regime === 'old' ? 50_000_00 : 75_000_00,
	deductionsPaise: regime === 'old' ? 1_75_000_00 : 0,
	professionalTaxPaise: 2_400_00,
	taxablePaise: 30_00_000_00,
	slabTaxPaise: taxPaise,
	rebatePaise: 0,
	surchargePaise: 0,
	cessPaise: Math.round(taxPaise * 0.04),
	taxPaise: Math.round(taxPaise * 1.04),
	monthlyPaise: Math.round((taxPaise * 1.04) / 12),
});
const VIEW = {
	year: THIS_YEAR,
	regime: 'old',
	ageBand: 'below_60',
	declarationsCount: true,
	old: working('old', 3_12_500_00),
	new: working('new', 2_40_000_00),
	deductedPaise: 0,
	monthsLeft: 5,
};

interface Opened {
	close: ReturnType<typeof vi.fn>;
	dismiss: ReturnType<typeof vi.fn>;
	view: EmbeddedViewRef<unknown>;
}

async function employees(gateway: Record<string, unknown> = {}) {
	TestBed.resetTestingModule();
	document.body.querySelectorAll('.tax-test-modal').forEach((node) => node.remove());
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const opened: Opened[] = [];
	const calls = {
		employees: vi.fn(() => of([ASHA, RAFIQ])),
		incomeTax: vi.fn(() => of(VIEW)),
		...gateway,
	};
	TestBed.configureTestingModule({
		imports: [
			EmployeesPage,
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
			{
				provide: LocationsGateway,
				useValue: { list: vi.fn(() => of([{ id: 'l1', name: 'Barasat', active: true }])) },
			},
			{ provide: NotificationService, useValue: notifier },
			{ provide: AuthStore, useValue: { permissions: signal(['accounts.index', 'accounts.edit']) } },
			{
				provide: NgbModal,
				useValue: {
					open: vi.fn((content: TemplateRef<unknown>) => {
						const ref = { close: vi.fn(), dismiss: vi.fn() };
						const view = content.createEmbeddedView({ $implicit: ref });
						TestBed.inject(ApplicationRef).attachView(view);
						view.detectChanges();
						const holder = document.createElement('div');
						holder.className = 'tax-test-modal';
						holder.append(...(view.rootNodes as Node[]));
						document.body.append(holder);
						opened.push({ ...ref, view });
						return ref;
					}),
				},
			},
		],
	});
	const fixture = TestBed.createComponent(EmployeesPage);
	fixture.detectChanges();
	await settle(fixture);
	const redraw = async () => {
		for (const popup of opened) popup.view.detectChanges();
		await new Promise((resolve) => setTimeout(resolve, 0));
		for (const popup of opened) popup.view.detectChanges();
	};
	return { fixture, page: fixture.componentInstance, notifier, opened, calls, redraw };
}

const button = (fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as HTMLButtonElement;
const edit = (fixture: { nativeElement: HTMLElement }, at: number) =>
	[...fixture.nativeElement.querySelectorAll('button[title="edit"]')][at] as HTMLButtonElement;
/** The last pop-up opened: each open draws a fresh one. */
const modal = <T extends HTMLElement = HTMLElement>(selector: string) =>
	[...document.querySelectorAll(`.tax-test-modal`)].at(-1)?.querySelector(selector) as T | null;
const modalAll = <T extends HTMLElement = HTMLElement>(selector: string) =>
	[...([...document.querySelectorAll(`.tax-test-modal`)].at(-1)?.querySelectorAll(selector) ?? [])] as T[];
const enter = (control: Element | null | undefined, value: string) => {
	const box = control as HTMLInputElement;
	box.value = value;
	box.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
};
const declarationRows = () => modalAll('#emp_rent')[0]?.closest('tbody')?.querySelectorAll('tr') ?? [];

describe('the financial year and a declaration as it starts (TX1)', () => {
	it('puts a month in its April-to-March year', () => {
		expect([yearOf('2027-01'), yearOf('2026-04'), yearOf('2026-03'), yearOf('2099-12')]).toEqual([
			'2026-27',
			'2026-27',
			'2025-26',
			'2099-00',
		]);
	});

	it('starts a year with nothing declared, on the regime the person is on', () => {
		expect(newDeclaration('2026-27', 'old')).toEqual({
			year: '2026-27',
			regime: 'old',
			chosenOn: null,
			rentMonthlyINR: 0,
			metroCity: false,
			s80cINR: 0,
			s80dINR: 0,
			homeLoanInterestINR: 0,
			previousSalaryINR: 0,
			previousTdsINR: 0,
			proof: { rent: false, s80c: false, s80d: false, homeLoan: false },
		});
	});

	it('compares the working line by line, ending with the year’s tax and the month’s', () => {
		expect(TAX_ROWS).toHaveLength(12);
		expect([TAX_ROWS[0], TAX_ROWS.at(-2), TAX_ROWS.at(-1)]).toEqual(['salaryPaise', 'taxPaise', 'monthlyPaise']);
	});

	it('copies each year’s declaration and its proofs into the form, not the same objects', () => {
		const write = employeeWrite(ASHA);
		expect(write.taxDeclarations).toEqual(ASHA.taxDeclarations);
		expect(write.taxDeclarations?.[1]).not.toBe(ASHA.taxDeclarations[1]);
		expect(write.taxDeclarations?.[1]?.proof).not.toBe(ASHA.taxDeclarations[1]?.proof);
		expect([write.taxRegime, write.dateOfBirth]).toEqual(['old', '1990-05-01']);
	});
});

describe('a new employee’s tax for this year (TX1)', () => {
	it('starts on the new regime with the earlier-salary fields, and no comparison until the person is saved', async () => {
		const { fixture, page, redraw } = await employees();
		button(fixture, '#emp_add').click();
		await redraw();
		expect(page.taxYear).toBe(THIS_YEAR);
		expect(page.declaration()).toBeNull();
		expect(
			[...document.querySelectorAll('h6.mt-4.mb-2')].some((h) => h.textContent?.includes('payroll_tax_title')),
		).toBe(true);
		expect(modal<HTMLSelectElement>('#emp_regime')?.value).toBe('new');
		expect(modal('#emp_prev_salary')).not.toBeNull();
		expect(modal('#emp_rent')).toBeNull();
		expect(modal('#emp_tax_compare')).toBeNull();
		expect([page.amount('s80cINR'), page.proven('rent')]).toEqual([0, false]);
		await page.workOut();
		expect(page.taxView()).toBeNull();
	});

	it('keeps the date of birth and starts this year’s declaration from the regime with the first figure', async () => {
		const { fixture, page, redraw } = await employees();
		button(fixture, '#emp_add').click();
		await redraw();
		enter(modal('#emp_dob'), '1960-02-01');
		expect(page.form().dateOfBirth).toBe('1960-02-01');
		enter(modal('#emp_dob'), '');
		expect(page.form().dateOfBirth).toBeNull();
		enter(modal('#emp_prev_salary'), '120000');
		enter(modal('#emp_prev_tds'), '5000');
		expect(page.declaration()).toEqual({
			...newDeclaration(THIS_YEAR, 'new'),
			previousSalaryINR: 120_000,
			previousTdsINR: 5_000,
		});
		enter(modal('#emp_chosen_on'), '2026-04-10');
		expect(page.declaration()?.chosenOn).toBe('2026-04-10');
		enter(modal('#emp_chosen_on'), '');
		expect(page.declaration()?.chosenOn).toBeNull();
	});

	it('moves to the old regime through the declaration, keeping the person’s regime in step', async () => {
		const { fixture, page, redraw } = await employees();
		button(fixture, '#emp_add').click();
		await redraw();
		enter(modal('#emp_regime'), 'old');
		await redraw();
		expect([page.form().taxRegime, page.declaration()?.regime]).toEqual(['old', 'old']);
		expect(modal('#emp_rent')).not.toBeNull();
		expect(modal('#emp_prev_salary')).toBeNull();
	});

	it('starts a declaration with no list and no regime on the form as a new-regime one', async () => {
		const { page } = await employees();
		page.form.set({ ...page.form(), taxDeclarations: undefined, taxRegime: undefined } as never);
		page.setProof('s80c', true);
		expect(page.declaration()).toEqual({
			...newDeclaration(THIS_YEAR, 'new'),
			proof: { rent: false, s80c: true, s80d: false, s126Parents: false, homeLoan: false },
		});
		expect(page.form().taxRegime).toBe('new');
	});
});

describe('an employee on the old regime declares rent, 80C, 80D, a home loan and an earlier job (TX1)', () => {
	it('shows this year’s figures, metro rent, and a proof box only where there is one to give', async () => {
		const { fixture, page, redraw } = await employees();
		edit(fixture, 0).click();
		await redraw();
		expect(page.editing()?.id).toBe('e1');
		expect(modal<HTMLSelectElement>('#emp_regime')?.value).toBe('old');
		expect(modal<HTMLInputElement>('#emp_dob')?.value).toBe('1990-05-01');
		expect(modal<HTMLInputElement>('#emp_chosen_on')?.value).toBe('2026-04-05');
		// Brief 26 TX5: a declaration saved before cities shows its "metro" yes as the city picker's own choice.
		expect(modal<HTMLSelectElement>('#emp_rent_city')?.value).toBe('__metro_before');
		expect(modal<HTMLInputElement>('#emp_rent')?.value).toBe('12000');
		const rows = [...declarationRows()];
		// Rent, section 126's five rows (TX3), 80C, home loan, the earlier job's salary and TDS.
		expect(rows).toHaveLength(10);
		expect(rows.map((row) => row.querySelectorAll('input[type="checkbox"]').length)).toEqual([
			1, 2, 0, 2, 0, 0, 1, 1, 0, 0,
		]);
		expect(modal<HTMLInputElement>('#emp_decl_s80c')?.value).toBe('150000');
		expect([page.proven('rent'), page.proven('s80c'), page.proven('s80d'), page.proven('homeLoan')]).toEqual([
			true,
			false,
			true,
			false,
		]);
		expect(page.healthAmount('s80dINR')).toBe(25_000);
	});

	it('changes rent, metro, each amount and each proof, never below nothing, and keeps last year’s as it was', async () => {
		const { fixture, page, redraw } = await employees();
		edit(fixture, 0).click();
		await redraw();
		page.pickRentCity('Pune');
		enter(modal('#emp_rent'), '15000');
		(declarationRows()[0]?.querySelector('td:nth-child(4) input') as HTMLInputElement).click();
		enter(modal('#emp_decl_s80c'), '-5');
		enter(modal('#emp_decl_home_loan'), '200000');
		enter(modal('#emp_decl_previous_salary'), '90000');
		(modal('#emp_decl_s80c')?.closest('tr')?.querySelector('td:nth-child(4) input') as HTMLInputElement).click();
		page.setHealthAmount('s80dINR', 'lots');
		expect(page.declaration()).toMatchObject({
			rentCity: 'Pune',
			rentMonthlyINR: 15_000,
			s80cINR: 0,
			s80dINR: 0,
			homeLoanInterestINR: 2_00_000,
			previousSalaryINR: 90_000,
			proof: { rent: false, s80c: true, s80d: true, homeLoan: false },
		});
		expect(page.form().taxDeclarations?.find((d) => d.year === '2025-26')).toEqual(
			declaration('2025-26', { s80cINR: 1_00_000 }),
		);
		expect(page.form().taxDeclarations).toHaveLength(2);
	});
});

describe('the year worked under both regimes (TX1)', () => {
	it('works out the saved year for this month and shows it line by line, old beside new', async () => {
		const { fixture, page, calls, redraw } = await employees();
		edit(fixture, 0).click();
		await redraw();
		modal<HTMLButtonElement>('#emp_tax_compare')?.click();
		await settle(fixture);
		await redraw();
		expect(calls.incomeTax).toHaveBeenCalledWith('e1', currentMonth());
		expect(page.taxView()).toEqual(VIEW);
		const table = modalAll('table').at(-1) as HTMLTableElement;
		expect(table.querySelector('thead th')?.textContent).toContain('payroll_tax_compare_title');
		const rows = [...table.querySelectorAll('tbody tr')];
		expect(rows).toHaveLength(12);
		expect(rows.map((row) => row.classList.contains('fw-bold'))).toEqual([...Array(10).fill(false), true, true]);
		expect([...rows[10]!.querySelectorAll('td')].map((td) => td.textContent?.trim())).toEqual([
			'payroll_tax_row_taxPaise',
			rupees(VIEW.old.taxPaise),
			rupees(VIEW.new.taxPaise),
		]);
		expect(table.parentElement?.nextElementSibling?.textContent?.trim()).toBe('payroll_tax_note');
	});

	it('notes that declarations count only with proof, and clears the comparison when another person opens', async () => {
		const { fixture, page, redraw } = await employees({
			incomeTax: vi.fn(() => of({ ...VIEW, declarationsCount: false })),
		});
		edit(fixture, 0).click();
		await redraw();
		await page.workOut();
		await redraw();
		expect(modalAll('small.text-muted.d-block').map((s) => s.textContent?.trim())).toContain(
			'payroll_tax_note_proof',
		);
		edit(fixture, 1).click();
		await redraw();
		expect(page.taxView()).toBeNull();
		expect(modal<HTMLSelectElement>('#emp_regime')?.value).toBe('new');
		expect(modal('#emp_tax_compare')).not.toBeNull();
	});

	it('names a refusal, or says it simply failed', async () => {
		const incomeTax = vi
			.fn()
			.mockReturnValueOnce(throwError(() => refusal('payroll_no_structure')))
			.mockReturnValueOnce(throwError(() => new Error('down')));
		const { fixture, page, notifier, redraw } = await employees({ incomeTax });
		edit(fixture, 0).click();
		await redraw();
		await page.workOut();
		expect(notifier.showError).toHaveBeenLastCalledWith('payroll_problem_payroll_no_structure');
		await page.workOut();
		expect(notifier.showError).toHaveBeenLastCalledWith('payroll_problem_failed');
		expect(page.taxView()).toBeNull();
	});
});

describe('figures never below nothing on the tax declaration (TX1)', () => {
	it('stores no negative or unreadable rent, earlier salary or earlier TDS', async () => {
		const { fixture, page, redraw } = await employees();
		edit(fixture, 0).click();
		await redraw();
		enter(modal('#emp_rent'), '-500');
		expect(page.declaration()?.rentMonthlyINR).toBe(0);
		expect([
			page.atLeastNothing('12'),
			page.atLeastNothing(-3),
			page.atLeastNothing('x'),
			page.atLeastNothing(null),
		]).toEqual([12, 0, 0, 0]);
		edit(fixture, 1).click();
		await redraw();
		enter(modal('#emp_prev_salary'), '-90000');
		enter(modal('#emp_prev_tds'), '-1000');
		expect(page.declaration()).toMatchObject({ previousSalaryINR: 0, previousTdsINR: 0 });
	});
});
