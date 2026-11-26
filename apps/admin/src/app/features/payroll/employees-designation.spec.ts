import { ApplicationRef, TemplateRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { PayrollGateway } from '@core/accounts/payroll.gateway';
import { LocationsGateway } from '@core/locations/locations.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { EmployeesPage, employeeWrite } from './employees-page';

import type { EmployeeView } from '@saha-textile/contracts';

/** An employee's designation and department, printed on the payslip (brief 25 PS). */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const ASHA = {
	id: 'e1',
	name: 'Asha Das',
	code: 'E-001',
	designation: 'Sales associate',
	department: 'Shop floor',
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
	structure: { basic: 16_000, da: 0, hra: 6_400, special: 9_600, conveyance: 0, other: 0 },
	advanceDueINR: 0,
	advancePerMonthINR: 0,
	masked: true,
	createdAt: '2026-04-01T00:00:00.000Z',
	updatedAt: '2026-04-01T00:00:00.000Z',
	version: 3,
} as unknown as EmployeeView;

async function employees() {
	TestBed.resetTestingModule();
	document.body.querySelectorAll('.desg-test-modal').forEach((node) => node.remove());
	const views: { detectChanges: () => void }[] = [];
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
			{ provide: PayrollGateway, useValue: { employees: vi.fn(() => of([ASHA])) } },
			{
				provide: LocationsGateway,
				useValue: { list: vi.fn(() => of([{ id: 'l1', name: 'Barasat', active: true }])) },
			},
			{ provide: NotificationService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
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
						holder.className = 'desg-test-modal';
						holder.append(...(view.rootNodes as Node[]));
						document.body.append(holder);
						views.push(view);
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
		views.at(-1)?.detectChanges();
		await new Promise((resolve) => setTimeout(resolve, 0));
		views.at(-1)?.detectChanges();
	};
	return { fixture, page: fixture.componentInstance, redraw };
}

const field = (id: string) =>
	[...document.querySelectorAll('.desg-test-modal')].at(-1)?.querySelector(`#${id}`) as HTMLInputElement | null;
const enter = (box: HTMLInputElement | null, value: string) => {
	(box as HTMLInputElement).value = value;
	box?.dispatchEvent(new Event('input'));
};

describe('an employee’s designation and department (PS)', () => {
	it('copies them into the form from the saved person', () => {
		expect(employeeWrite(ASHA)).toMatchObject({ designation: 'Sales associate', department: 'Shop floor' });
	});

	it('starts a new person with both empty, at most 80 letters each, and keeps what is typed', async () => {
		const { fixture, page, redraw } = await employees();
		(fixture.nativeElement.querySelector('#emp_add') as HTMLButtonElement).click();
		await redraw();
		expect([page.form().designation, page.form().department]).toEqual(['', '']);
		expect([field('emp_designation')?.maxLength, field('emp_department')?.maxLength]).toEqual([80, 80]);
		enter(field('emp_designation'), 'Tailor');
		enter(field('emp_department'), 'Alterations');
		expect([page.form().designation, page.form().department]).toEqual(['Tailor', 'Alterations']);
	});

	it('shows a saved person’s designation and department when opened', async () => {
		const { fixture, redraw } = await employees();
		(fixture.nativeElement.querySelector('button[title="edit"]') as HTMLButtonElement).click();
		await redraw();
		expect([field('emp_designation')?.value, field('emp_department')?.value]).toEqual([
			'Sales associate',
			'Shop floor',
		]);
	});
});
