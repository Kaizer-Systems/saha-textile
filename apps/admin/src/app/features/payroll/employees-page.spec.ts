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

import { EmployeesPage, STRUCTURE_HEADS, employeeWrite, structureCheck } from './employees-page';

/** Employees (accounts brief S3, S4): statutory details, salary structure and the half-the-pay wage rule. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const refusal = (code: string) => ({ error: { message: code } });
const structure = (basic: number, da = 0, hra = 0, special = 0, conveyance = 0, other = 0) => ({
	basic,
	da,
	hra,
	special,
	conveyance,
	other,
});

const at = '2026-04-01T00:00:00.000Z';
const employee = (id: string, over: Record<string, unknown> = {}) => ({
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
	taxRegime: 'new',
	dateOfBirth: null,
	taxDeclarations: [],
	bankAccount: 'XXXXXX7788',
	ifsc: 'HDFC0001234',
	pfOn: true,
	esiOn: false,
	structure: structure(16_000, 0, 6_400, 9_600),
	advanceDueINR: 5_000,
	advancePerMonthINR: 1_000,
	masked: true,
	createdAt: at,
	updatedAt: at,
	version: 3,
	...over,
});
const EMPLOYEES = [
	employee('e1'),
	employee('e2', { name: 'Rafiq Ali', code: '', pan: '', uan: '', leftOn: '2026-09-30', locationId: 'gone' }),
];
const LOCATIONS = [
	{ id: 'l0', name: 'Old shop', active: false },
	{ id: 'l1', name: 'Barasat', active: true },
];

interface Opened {
	close: ReturnType<typeof vi.fn>;
	dismiss: ReturnType<typeof vi.fn>;
	view: EmbeddedViewRef<unknown>;
}

function mount(gateway: Record<string, unknown> = {}, options: { permissions?: string[]; locations?: unknown[] } = {}) {
	TestBed.resetTestingModule();
	document.body.querySelectorAll('.emp-test-modal').forEach((node) => node.remove());
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const invalidate = vi.spyOn(queries, 'invalidateQueries');
	const opened: Opened[] = [];
	const calls = {
		employees: vi.fn(() => of(EMPLOYEES)),
		createEmployee: vi.fn(() => of(employee('e9'))),
		updateEmployee: vi.fn(() => of(employee('e1'))),
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
			provideTanStackQuery(queries),
			provideRouter([]),
			{ provide: PayrollGateway, useValue: calls },
			{ provide: LocationsGateway, useValue: { list: vi.fn(() => of(options.locations ?? LOCATIONS)) } },
			{ provide: NotificationService, useValue: notifier },
			{
				provide: AuthStore,
				useValue: { permissions: signal(options.permissions ?? ['accounts.index', 'accounts.edit']) },
			},
			{
				provide: NgbModal,
				useValue: {
					open: vi.fn((content: TemplateRef<unknown>) => {
						const ref = { close: vi.fn(), dismiss: vi.fn() };
						const view = content.createEmbeddedView({ $implicit: ref });
						TestBed.inject(ApplicationRef).attachView(view);
						view.detectChanges();
						const holder = document.createElement('div');
						holder.className = 'emp-test-modal';
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
	return { fixture, page: fixture.componentInstance, notifier, invalidate, opened, calls };
}

async function employees(gateway: Record<string, unknown> = {}, options: Parameters<typeof mount>[1] = {}) {
	const harness = mount(gateway, options);
	await settle(harness.fixture);
	return harness;
}

const el = (fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as HTMLElement | null;
const all = (fixture: { nativeElement: HTMLElement }, selector: string) =>
	[...fixture.nativeElement.querySelectorAll(selector)] as HTMLElement[];
const modal = (selector: string) => document.querySelector(`.emp-test-modal ${selector}`) as HTMLElement | null;
const enter = (control: Element | null | undefined, value: string) => {
	const box = control as HTMLInputElement;
	box.value = value;
	box.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
};

describe('the half-the-pay wage rule (S4)', () => {
	it('totals the six heads and works out basic and DA’s share to one decimal', () => {
		expect([...STRUCTURE_HEADS]).toEqual(['basic', 'da', 'hra', 'special', 'conveyance', 'other']);
		expect(structureCheck(structure(16_000, 0, 0, 16_000))).toEqual({
			total: 32_000,
			basicShare: 50,
			meetsHalf: true,
		});
		expect(structureCheck(structure(8_000, 0, 0, 16_000))).toEqual({
			total: 24_000,
			basicShare: 33.3,
			meetsHalf: false,
		});
		expect(structureCheck(structure(0))).toEqual({ total: 0, basicShare: 0, meetsHalf: true });
		expect(structureCheck({ basic: 10_000, da: 0 } as never)).toEqual({
			total: 10_000,
			basicShare: 100,
			meetsHalf: true,
		});
	});

	it('copies only the editable fields of an employee, with a structure of its own', () => {
		const source = employee('e1');
		const write = employeeWrite(source as never);
		expect(Object.keys(write)).not.toEqual(expect.arrayContaining(['id']));
		for (const key of ['id', 'createdAt', 'updatedAt', 'version', 'masked']) expect(write).not.toHaveProperty(key);
		expect(write).toMatchObject({ name: 'Asha Das', code: 'E-001', ifsc: 'HDFC0001234', advanceDueINR: 5_000 });
		expect(write.structure).toEqual(source.structure);
		expect(write.structure).not.toBe(source.structure);
	});
});

describe('the employees page (S3)', () => {
	it('lists each person with their location, PAN, UAN and monthly pay, those who left muted', async () => {
		const { fixture, page } = await employees();
		const rows = all(fixture, 'tbody tr');
		expect(rows).toHaveLength(2);
		expect(rows[0]?.textContent).toContain('E-001');
		expect(rows[0]?.textContent).toContain('Barasat');
		expect(rows[0]?.textContent).toContain('₹32,000');
		expect(rows[0]?.classList.contains('text-muted')).toBe(false);
		expect(rows[1]?.classList.contains('text-muted')).toBe(true);
		expect(rows[1]?.textContent).toContain('—');
		expect(page.locationName('gone')).toBe('');
		expect(page.day('2025-06-01')).toBeTruthy();
		expect(el(fixture, '#emp_add')).not.toBeNull();
		expect(all(fixture, 'button[title="edit"]')).toHaveLength(2);
	});

	it('says when there is no one, and offers no changes to someone who may not edit', async () => {
		const empty = await employees({ employees: vi.fn(() => of([])) });
		expect(el(empty.fixture, 'tbody td[colspan]')).not.toBeNull();
		const reader = await employees({}, { permissions: ['accounts.index'] });
		expect(el(reader.fixture, '#emp_add')).toBeNull();
		expect(all(reader.fixture, 'button[title="edit"]')).toHaveLength(0);
	});

	it('has no location name before the locations are read', () => {
		const { page } = mount({}, { locations: undefined });
		expect(page.locationName('l1')).toBe('');
	});
});

describe('adding and changing an employee', () => {
	it('opens a blank form at the first active location, checks the wage rule as the pay is typed, and adds them', async () => {
		const { fixture, page, opened, calls, notifier, invalidate } = await employees();
		(el(fixture, '#emp_add') as HTMLButtonElement).click();
		const popup = opened[0] as Opened;
		const redraw = () => popup.view.detectChanges();
		expect(page.editing()).toBeNull();
		expect(page.form()).toMatchObject({ name: '', locationId: 'l1', ptState: '19', taxRegime: 'new', pfOn: true });
		const save = modal('#emp_save') as HTMLButtonElement;
		expect(save.disabled).toBe(true);
		enter(modal('#emp_name'), 'Mitali Roy');
		enter(modal('#emp_code'), 'E-003');
		enter(modal('#emp_joined'), '2026-11-01');
		enter(modal('#emp_left'), '');
		enter(modal('#emp_pan'), 'PQRST6789K');
		enter(modal('#emp_aadhaar'), '123412341234');
		enter(modal('#emp_uan'), '100200300401');
		enter(modal('#emp_esi'), '3100123456');
		enter(modal('#emp_bank'), '50100123456789');
		enter(modal('#emp_ifsc'), 'SBIN0000001');
		enter(modal('#emp_regime'), 'old');
		(modal('#emp_pf') as HTMLInputElement).dispatchEvent(new Event('change'));
		(modal('#emp_esi_on') as HTMLInputElement).dispatchEvent(new Event('change'));
		enter(modal('#emp_adv'), '3000');
		enter(modal('#emp_adv_month'), '500');
		const pay = [...document.querySelectorAll('.emp-test-modal input[type="number"]')].filter(
			// The pay heads: not the advance, nor the income-tax figures (TX1).
			(input) =>
				!['emp_adv', 'emp_adv_month', 'emp_prev_salary', 'emp_prev_tds', 'emp_rent'].includes(input.id) &&
				!input.id.startsWith('emp_decl_'),
		);
		expect(pay).toHaveLength(6);
		enter(pay[0], '8000');
		enter(pay[3], '16000');
		redraw();
		expect(document.querySelector('.emp-test-modal')?.textContent).toContain('payroll_half_short');
		enter(pay[1], '8000');
		redraw();
		expect(document.querySelector('.emp-test-modal')?.textContent).toContain('payroll_half_ok');
		expect(save.disabled).toBe(false);
		save.click();
		await settle(fixture);
		expect(calls.createEmployee).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'Mitali Roy',
				code: 'E-003',
				locationId: 'l1',
				joinedOn: '2026-11-01',
				leftOn: null,
				taxRegime: 'old',
				pfOn: false,
				esiOn: false,
				structure: structure(8_000, 8_000, 0, 16_000),
				advanceDueINR: 3_000,
				advancePerMonthINR: 500,
			}),
		);
		expect(notifier.showSuccess).toHaveBeenCalledWith('payroll_employee_saved');
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['payroll'] });
		expect(popup.close).toHaveBeenCalled();
		(modal('.btn-close') as HTMLButtonElement).click();
		expect(popup.dismiss).toHaveBeenCalled();
		expect(page.busy()).toBe(false);
	});

	it('opens a blank form with no location when none is active', async () => {
		const { fixture, page } = await employees({}, { locations: [LOCATIONS[0]] });
		(el(fixture, '#emp_add') as HTMLButtonElement).click();
		expect(page.form().locationId).toBe('');
		page.patch({ name: 'Mitali Roy' });
		page.patchStructure('basic', 10_000);
		expect(page.form().structure.basic).toBe(10_000);
	});

	it('opens an employee with their details and saves the change with its version', async () => {
		const { fixture, page, opened, calls } = await employees();
		(all(fixture, 'button[title="edit"]')[0] as HTMLButtonElement).click();
		expect(page.editing()?.id).toBe('e1');
		expect(page.form()).toEqual(employeeWrite(EMPLOYEES[0] as never));
		opened[0]?.view.detectChanges();
		enter(modal('#emp_location'), 'l1');
		enter(modal('#emp_left'), '2026-12-31');
		await page.save();
		expect(calls.updateEmployee).toHaveBeenCalledWith(
			'e1',
			expect.objectContaining({ name: 'Asha Das', leftOn: '2026-12-31', version: 3 }),
		);
		expect(calls.createEmployee).not.toHaveBeenCalled();
	});

	it('names a refusal, says when it simply failed, and keeps the form open', async () => {
		const createEmployee = vi
			.fn()
			.mockReturnValueOnce(throwError(() => refusal('payroll_code_taken')))
			.mockReturnValueOnce(throwError(() => new Error('down')));
		const { fixture, page, opened, notifier } = await employees({ createEmployee });
		(el(fixture, '#emp_add') as HTMLButtonElement).click();
		await page.save();
		expect(notifier.showError).toHaveBeenLastCalledWith('payroll_problem_payroll_code_taken');
		await page.save();
		expect(notifier.showError).toHaveBeenLastCalledWith('payroll_problem_failed');
		expect(opened[0]?.close).not.toHaveBeenCalled();
		expect(page.busy()).toBe(false);
	});

	it('saves with no form open', async () => {
		const { page, notifier } = await employees();
		await page.save();
		expect(notifier.showSuccess).toHaveBeenCalledWith('payroll_employee_saved');
	});
});
