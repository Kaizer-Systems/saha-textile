import { ApplicationRef, TemplateRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { WEST_BENGAL_LEAVE } from '@saha-textile/core-domain/payroll-rules';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { NEVER, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PayrollGateway } from '@core/accounts/payroll.gateway';
import { LocationsGateway } from '@core/locations/locations.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { EmployeesPage, asCoreLeaveType, employeeWrite } from './employees-page';

import type { EmployeeView } from '@saha-textile/contracts';

/**
 * Leave on the day a person is added (brief 26 OB1, OB2): per active leave type of the work location's State, what is
 * carried from before the type's year, credited so far as its rules give it, and taken, each typed over at will.
 */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};

const [WB_EARNED, CASUAL] = WEST_BENGAL_LEAVE as unknown as [Record<string, unknown>, Record<string, unknown>];
/** West Bengal's earned leave kept on an April-March year here, so the figures below follow the form, not the set. */
const EARNED = {
	...WB_EARNED,
	rules: [{ ...(WB_EARNED['rules'] as Record<string, unknown>[])[0], year: { startMonth: 4, months: 12 } }],
};
const CASUAL_RULE = (CASUAL['rules'] as Record<string, unknown>[])[0];
/** West Bengal's earned and casual leave, one switched off, and one only for managers. */
const LEAVE_TYPES = [
	EARNED,
	CASUAL,
	{ ...CASUAL, key: 'OLD', name: 'Old leave', active: false },
	{ ...CASUAL, key: 'MGR', name: 'Managers’ leave', rules: [{ ...CASUAL_RULE, when: { designation: 'Manager' } }] },
];
const VERSION = {
	id: 'v1',
	from: '2026-04-01',
	states: [
		{ stateCode: '19', ptSlabs: [], leaveTypes: LEAVE_TYPES },
		{ stateCode: '27', ptSlabs: [] },
	],
};
const LOCATIONS = [
	{ id: 'l1', name: 'Barasat', active: true, stateCode: '19' },
	{ id: 'l2', name: 'Pune', active: true, stateCode: '27' },
	{ id: 'l3', name: 'Store room', active: true },
];

const person = (over: Record<string, unknown> = {}) =>
	({
		id: 'e1',
		name: 'Asha Das',
		code: 'E-001',
		designation: '',
		department: '',
		userId: null,
		locationId: 'l1',
		joinedOn: '2025-06-01',
		leftOn: null,
		pan: 'ABCDE1234F',
		aadhaar: 'XXXX XXXX 1234',
		uan: '',
		esiNumber: '',
		ptState: '19',
		taxRegime: 'new',
		dateOfBirth: null,
		taxDeclarations: [],
		bankAccount: '',
		ifsc: '',
		pfOn: true,
		esiOn: false,
		structure: { basic: 16_000, da: 0, hra: 0, special: 0, conveyance: 0, other: 0 },
		advanceDueINR: 0,
		advancePerMonthINR: 0,
		masked: true,
		createdAt: '2026-04-01T00:00:00.000Z',
		updatedAt: '2026-04-01T00:00:00.000Z',
		version: 3,
		...over,
	}) as unknown as EmployeeView;

async function employees(options: { rules?: unknown; locations?: unknown; staff?: EmployeeView[] } = {}) {
	TestBed.resetTestingModule();
	document.body.querySelectorAll('.eol-test-modal').forEach((node) => node.remove());
	const views: { detectChanges: () => void }[] = [];
	const gateway = {
		employees: vi.fn(() => of(options.staff ?? [person()])),
		rules: vi.fn(() => (options.rules === null ? NEVER : of(options.rules ?? [VERSION]))),
		createEmployee: vi.fn(() => of({})),
		updateEmployee: vi.fn(() => of({})),
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
			{ provide: PayrollGateway, useValue: gateway },
			{
				provide: LocationsGateway,
				useValue: {
					list: vi.fn(() => (options.locations === null ? NEVER : of(options.locations ?? LOCATIONS))),
				},
			},
			{ provide: NotificationService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
			{ provide: AuthStore, useValue: { permissions: signal(['accounts.index', 'accounts.edit']) } },
			{
				provide: NgbModal,
				useValue: {
					open: vi.fn((content: TemplateRef<unknown>) => {
						const view = content.createEmbeddedView({ $implicit: { close: vi.fn(), dismiss: vi.fn() } });
						TestBed.inject(ApplicationRef).attachView(view);
						view.detectChanges();
						const holder = document.createElement('div');
						holder.className = 'eol-test-modal';
						holder.append(...(view.rootNodes as Node[]));
						document.body.append(holder);
						views.push(view);
						return { close: vi.fn(), dismiss: vi.fn() };
					}),
				},
			},
		],
	});
	const fixture = TestBed.createComponent(EmployeesPage);
	fixture.detectChanges();
	await settle(fixture);
	const redraw = async () => {
		views.at(-1)?.detectChanges();
		await new Promise((resolve) => setTimeout(resolve, 0));
		views.at(-1)?.detectChanges();
	};
	return { fixture, page: fixture.componentInstance, redraw, gateway };
}

const modal = <T extends HTMLElement = HTMLInputElement>(selector: string) =>
	[...document.querySelectorAll('.eol-test-modal')].at(-1)?.querySelector(selector) as T | null;
const enter = (box: HTMLInputElement | null, value: string) => {
	(box as HTMLInputElement).value = value;
	(box as HTMLInputElement).dispatchEvent(new Event('input'));
};
const edit = (fixture: { nativeElement: HTMLElement }) =>
	fixture.nativeElement.querySelector('button[title="edit"]') as HTMLButtonElement;

describe('leave on the day a person is added (OB1, OB2)', () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-26T06:00:00.000Z'));
	});
	afterEach(() => vi.useRealTimers());

	it('reads a rules version’s leave type as the core’s own', () => {
		expect(asCoreLeaveType(EARNED as never)).toBe(EARNED);
	});

	it('works out each active type for someone who joined before its year: carried at nothing, credited, none taken', async () => {
		const { page } = await employees();
		page.form.set({ ...page.form(), locationId: 'l1', joinedOn: '2025-06-01' });
		expect(page.openingRows()).toEqual([
			{
				key: 'EL',
				name: 'Earned leave',
				asOf: '2026-11-26',
				yearStart: '2026-04-01',
				carriedOpen: true,
				lapses: false,
				carried: 0,
				credited: 10.5,
				workedOut: 10.5,
				changed: false,
				taken: 0,
				balance: 10.5,
			},
			{
				key: 'CL',
				name: 'Casual leave',
				asOf: '2026-11-26',
				yearStart: '2026-04-01',
				carriedOpen: false,
				lapses: true,
				carried: null,
				credited: 10,
				workedOut: 10,
				changed: false,
				taken: 0,
				balance: 10,
			},
		]);
		// A type kept for managers shows only for one.
		page.form.set({ ...page.form(), designation: 'manager ' });
		expect(page.openingRows().map((r) => r.key)).toEqual(['EL', 'CL', 'MGR']);
	});

	it('follows each type’s own year: the West Bengal set’s earned leave on the calendar year', async () => {
		const calendar = { ...VERSION, states: [{ stateCode: '19', ptSlabs: [], leaveTypes: [WB_EARNED] }] };
		const { page } = await employees({ rules: [calendar] });
		page.form.set({ ...page.form(), locationId: 'l1', joinedOn: '2025-06-01' });
		expect(page.openingRows()[0]).toMatchObject({
			key: 'EL',
			yearStart: '2026-01-01',
			carriedOpen: true,
			credited: 14,
		});
		// Joined in March: before an April year, but inside this calendar year, so nothing is carried.
		page.patch({ joinedOn: '2026-03-01' });
		expect(page.openingRows()[0]).toMatchObject({ yearStart: '2026-01-01', carriedOpen: false, carried: null });
	});

	it('shuts carried forward for someone who joined in the type’s year, and credits only the part year', async () => {
		const { page } = await employees();
		page.form.set({ ...page.form(), locationId: 'l1', joinedOn: '2026-08-12' });
		expect(page.openingRows().map((r) => [r.key, r.carriedOpen, r.lapses, r.carried, r.credited])).toEqual([
			['EL', false, false, null, 0],
			['CL', false, true, null, 6.5],
		]);
	});

	it('shows nothing without a joining date, a State with leave, its rules, or the rules and locations read', async () => {
		const { page } = await employees();
		const rowsFor = (fields: Record<string, unknown>) => {
			page.form.set({ ...page.form(), locationId: 'l1', joinedOn: '2025-06-01', ...fields });
			return page.openingRows();
		};
		expect(rowsFor({ joinedOn: '' })).toEqual([]);
		expect(rowsFor({ locationId: 'l2' })).toEqual([]);
		expect(rowsFor({ locationId: 'l3' })).toEqual([]);
		expect(rowsFor({ locationId: 'gone' })).toEqual([]);
		const noStates = await employees({ rules: [{ id: 'v0', from: '2026-04-01' }] });
		noStates.page.form.set({ ...noStates.page.form(), locationId: 'l1', joinedOn: '2025-06-01' });
		expect(noStates.page.openingRows()).toEqual([]);
		const noVersions = await employees({ rules: [] });
		noVersions.page.form.set({ ...noVersions.page.form(), locationId: 'l1', joinedOn: '2025-06-01' });
		expect(noVersions.page.openingRows()).toEqual([]);
		const unread = await employees({ rules: null, locations: null });
		unread.page.form.set({ ...unread.page.form(), locationId: 'l1', joinedOn: '2025-06-01' });
		expect(unread.page.openingRows()).toEqual([]);
	});

	it('types over each figure, never below nothing, and keeps a shut carried forward shut', async () => {
		const { page } = await employees();
		page.form.set({ ...page.form(), locationId: 'l1', joinedOn: '2025-06-01' });
		page.setOpening('EL', 'carried', '12');
		page.setOpening('EL', 'taken', 3);
		page.setOpening('EL', 'credited', -4);
		expect(page.form().openingLeave).toEqual([
			{ typeKey: 'EL', asOf: '2026-11-26', carried: 12, credited: 0, creditedWorkedOut: 10.5, taken: 3 },
		]);
		expect(page.openingRows()[0]).toMatchObject({ carried: 12, credited: 0, changed: true, taken: 3, balance: 9 });
		page.setOpening('CL', 'carried', 5);
		page.setOpening('CL', 'taken', '');
		expect(page.form().openingLeave?.at(-1)).toEqual({
			typeKey: 'CL',
			asOf: '2026-11-26',
			carried: null,
			credited: 10,
			creditedWorkedOut: 10,
			taken: 0,
		});
		page.setOpening('GONE', 'taken', 2);
		page.resetCredited('GONE');
		expect(page.form().openingLeave?.map((o) => o.typeKey)).toEqual(['EL', 'CL']);
		page.resetCredited('EL');
		expect(page.openingRows()[0]).toMatchObject({ credited: 10.5, changed: false, balance: 19.5 });
	});

	it('reads a carried forward kept as none as nothing once the joining date moves before the type’s year', async () => {
		const { page } = await employees();
		page.form.set({ ...page.form(), locationId: 'l1', joinedOn: '2026-08-12' });
		page.setOpening('EL', 'taken', 1);
		expect(page.form().openingLeave?.[0]).toMatchObject({ carried: null, credited: 0, creditedWorkedOut: 0 });
		page.patch({ joinedOn: '2025-06-01' });
		// The credit left as worked out follows the new joining date.
		expect(page.openingRows()[0]).toMatchObject({
			carriedOpen: true,
			carried: 0,
			credited: 10.5,
			workedOut: 10.5,
			changed: false,
			taken: 1,
			balance: 9.5,
		});
	});

	it('keeps a typed credit when the joining date moves, shown against the new worked-out one', async () => {
		const { page } = await employees();
		page.form.set({ ...page.form(), locationId: 'l1', joinedOn: '2026-08-12' });
		page.setOpening('CL', 'credited', 3);
		page.patch({ joinedOn: '2025-06-01' });
		expect(page.openingRows()[1]).toMatchObject({ credited: 3, workedOut: 10, changed: true, balance: 3 });
	});

	it('copies the approximate joining mark and the saved opening leave into the form, and leaves them out when unset', () => {
		const saved = [{ typeKey: 'EL', asOf: '2026-05-10', carried: 4, credited: 6, creditedWorkedOut: 0, taken: 1 }];
		const written = employeeWrite(person({ joinedOnApproximate: true, openingLeave: saved }));
		expect([written.joinedOnApproximate, written.openingLeave]).toEqual([true, saved]);
		expect(written.openingLeave?.[0]).not.toBe(saved[0]);
		for (const plain of [person(), person({ joinedOnApproximate: false, openingLeave: [] })]) {
			const form = employeeWrite(plain);
			expect(['joinedOnApproximate' in form, 'openingLeave' in form]).toEqual([false, false]);
		}
	});

	it('edits a person’s opening leave as on the day they were added, and saves it as on that day', async () => {
		const saved = [
			{ typeKey: 'CL', asOf: '2026-05-10', carried: null, credited: 10, creditedWorkedOut: 10, taken: 2 },
			{ typeKey: 'EL', asOf: '2026-05-10', carried: 4, credited: 6, creditedWorkedOut: 0, taken: 1 },
		];
		const { fixture, page, redraw, gateway } = await employees({
			staff: [person({ joinedOnApproximate: true, openingLeave: saved })],
		});
		edit(fixture).click();
		await redraw();
		expect(modal('#emp_joined_approx')?.checked).toBe(true);
		expect(
			page.openingRows().map((r) => [r.key, r.asOf, r.carried, r.credited, r.workedOut, r.taken, r.balance]),
		).toEqual([
			['EL', '2026-05-10', 4, 6, 0, 1, 9],
			['CL', '2026-05-10', null, 10, 10, 2, 8],
		]);
		page.setOpening('CL', 'taken', 3);
		expect(page.form().openingLeave?.at(-1)?.asOf).toBe('2026-05-10');
		await page.save();
		const updated = gateway.updateEmployee.mock.lastCall as unknown as [string, Record<string, unknown>];
		expect(updated[1]).toMatchObject({ joinedOnApproximate: true, version: 3 });
		expect(updated[1]['openingLeave']).toEqual([
			{ typeKey: 'EL', asOf: '2026-05-10', carried: 4, credited: 6, creditedWorkedOut: 0, taken: 1 },
			{ typeKey: 'CL', asOf: '2026-05-10', carried: null, credited: 10, creditedWorkedOut: 10, taken: 3 },
		]);
	});

	it('draws the table: carried forward boxes or why there are none, the changed credit and its way back', async () => {
		const { fixture, page, redraw } = await employees();
		(fixture.nativeElement.querySelector('#emp_add') as HTMLButtonElement).click();
		await redraw();
		// A new person joins today: nothing to carry, and casual leave for the months left in its year.
		expect([page.form().locationId, page.form().joinedOn]).toEqual(['l1', '2026-11-26']);
		expect(modal('#emp_open_carried_EL')).toBeNull();
		expect(modal<HTMLElement>('#emp_open_balance_CL')?.textContent?.trim()).toBe('4');
		page.patch({ locationId: 'l2' });
		await redraw();
		expect([modal('#emp_open_credited_EL'), modal('table')]).toEqual([null, null]);
		page.patch({ locationId: 'l1', joinedOn: '2025-06-01' });
		await redraw();
		expect(modal<HTMLElement>('h6.mt-4.mb-2')?.textContent?.trim()).toBe('payroll_opening_title');
		const heads = [...(modal<HTMLElement>('table')?.querySelectorAll('thead th') ?? [])] as HTMLElement[];
		expect(heads.map((th) => [th.textContent?.trim(), th.title])).toEqual([
			['payroll_opening_balance', ''],
			['EL', 'Earned leave'],
			['CL', 'Casual leave'],
		]);
		expect(modal('#emp_open_carried_CL')).toBeNull();
		const carriedRow = modal<HTMLElement>('tbody tr') as HTMLElement;
		expect(carriedRow.querySelector('small')?.textContent?.trim()).toBe('payroll_opening_lapses');
		enter(modal('#emp_open_carried_EL'), '4');
		enter(modal('#emp_open_taken_EL'), '1.5');
		enter(modal('#emp_open_credited_EL'), '8');
		await redraw();
		expect(modal<HTMLElement>('#emp_open_balance_EL')?.textContent?.trim()).toBe('10.5');
		expect(modal('#emp_open_reset_CL')).toBeNull();
		const reset = modal<HTMLAnchorElement>('#emp_open_reset_EL') as HTMLAnchorElement;
		expect([reset.title, reset.parentElement?.textContent?.replace('↺', '').trim()]).toEqual([
			'payroll_opening_reset',
			'payroll_opening_changed_from',
		]);
		reset.click();
		await redraw();
		expect(modal('#emp_open_reset_EL')).toBeNull();
		expect(modal<HTMLElement>('#emp_open_balance_EL')?.textContent?.trim()).toBe('13');
		expect(modal<HTMLElement>('#emp_open_balance_CL')?.textContent?.trim()).toBe('10');
		enter(modal('#emp_open_taken_CL'), '');
		page.patch({ joinedOn: '2026-08-12' });
		await redraw();
		expect(modal('#emp_open_carried_EL')).toBeNull();
		expect((modal<HTMLElement>('tbody tr') as HTMLElement).querySelector('small')?.textContent?.trim()).toBe(
			'payroll_opening_joined_this_year',
		);
	});

	it('marks a joining date as approximate, and takes the mark off again', async () => {
		const { fixture, page, redraw } = await employees();
		(fixture.nativeElement.querySelector('#emp_add') as HTMLButtonElement).click();
		await redraw();
		const approx = modal('#emp_joined_approx') as HTMLInputElement;
		expect(approx.checked).toBe(false);
		approx.click();
		await redraw();
		expect([page.form().joinedOnApproximate, approx.checked]).toEqual([true, true]);
		approx.click();
		await redraw();
		expect([page.form().joinedOnApproximate, approx.checked]).toEqual([false, false]);
	});

	it('saves every type’s figures, the untouched ones at what was worked out, on a new person and an edit', async () => {
		const { fixture, page, redraw, gateway } = await employees();
		(fixture.nativeElement.querySelector('#emp_add') as HTMLButtonElement).click();
		await redraw();
		page.patch({ name: 'Rina Das', joinedOn: '2025-06-01' });
		page.setOpening('EL', 'taken', 2);
		await page.save();
		const created = gateway.createEmployee.mock.lastCall as unknown as [Record<string, unknown>];
		expect(created[0]['openingLeave']).toEqual([
			{ typeKey: 'EL', asOf: '2026-11-26', carried: 0, credited: 10.5, creditedWorkedOut: 10.5, taken: 2 },
			{ typeKey: 'CL', asOf: '2026-11-26', carried: null, credited: 10, creditedWorkedOut: 10, taken: 0 },
		]);
		edit(fixture).click();
		await redraw();
		await page.save();
		const updated = gateway.updateEmployee.mock.lastCall as unknown as [string, Record<string, unknown>];
		expect(updated[0]).toBe('e1');
		expect(updated[1]).toMatchObject({ version: 3, joinedOn: '2025-06-01' });
		expect((updated[1]['openingLeave'] as { typeKey: string }[]).map((o) => o.typeKey)).toEqual(['EL', 'CL']);
	});

	it('saves the form as it is where the State has no leave types', async () => {
		const { fixture, page, redraw, gateway } = await employees();
		(fixture.nativeElement.querySelector('#emp_add') as HTMLButtonElement).click();
		await redraw();
		page.patch({ name: 'Imran Khan', locationId: 'l2', joinedOn: '2025-06-01' });
		await page.save();
		const created = gateway.createEmployee.mock.lastCall as unknown as [Record<string, unknown>];
		expect(created[0]).toEqual(page.form());
		expect(created[0]['openingLeave']).toBeUndefined();
	});
});
