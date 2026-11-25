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

/** What a State's professional tax asks of a person (brief 26 PT3): gender, a disability, and a reason to exempt. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
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
		ptState: '27',
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
		version: 1,
		...over,
	}) as unknown as EmployeeView;

async function employees() {
	TestBed.resetTestingModule();
	document.body.querySelectorAll('.ept-test-modal').forEach((node) => node.remove());
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
			{
				provide: PayrollGateway,
				useValue: {
					employees: vi.fn(() =>
						of([person({ gender: 'woman', disability: true, ptExemptReason: 'Serving defence' })]),
					),
				},
			},
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
						const view = content.createEmbeddedView({ $implicit: { close: vi.fn(), dismiss: vi.fn() } });
						TestBed.inject(ApplicationRef).attachView(view);
						view.detectChanges();
						const holder = document.createElement('div');
						holder.className = 'ept-test-modal';
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
	return { fixture, page: fixture.componentInstance, redraw };
}

const field = <T extends HTMLElement = HTMLInputElement>(id: string) =>
	[...document.querySelectorAll('.ept-test-modal')].at(-1)?.querySelector(`#${id}`) as T | null;

describe('what a State’s professional tax asks of a person (PT3)', () => {
	it('copies the gender, disability and exemption reason into the form, or nothing for a person without them', () => {
		expect(
			employeeWrite(person({ gender: 'woman', disability: true, ptExemptReason: 'Serving defence' })),
		).toMatchObject({
			gender: 'woman',
			disability: true,
			ptExemptReason: 'Serving defence',
		});
		expect(employeeWrite(person())).toMatchObject({ gender: '', disability: false, ptExemptReason: '' });
	});

	it('starts a new person with none of them, and keeps what is picked and typed', async () => {
		const { fixture, page, redraw } = await employees();
		expect(page.genders).toEqual(['woman', 'man', 'other']);
		(fixture.nativeElement.querySelector('#emp_add') as HTMLButtonElement).click();
		await redraw();
		expect([page.form().gender, page.form().disability, page.form().ptExemptReason]).toEqual(['', false, '']);
		expect([...(field<HTMLSelectElement>('emp_gender')?.options ?? [])].map((o) => o.value)).toEqual([
			'',
			'woman',
			'man',
			'other',
		]);
		const gender = field<HTMLSelectElement>('emp_gender') as HTMLSelectElement;
		gender.value = 'woman';
		gender.dispatchEvent(new Event('change'));
		field('emp_disability')?.click();
		const reason = field('emp_pt_exempt') as HTMLInputElement;
		reason.value = 'Serving defence';
		reason.dispatchEvent(new Event('input'));
		expect([page.form().gender, page.form().disability, page.form().ptExemptReason]).toEqual([
			'woman',
			true,
			'Serving defence',
		]);
		await redraw();
		field('emp_disability')?.click();
		expect(page.form().disability).toBe(false);
	});

	it('shows a saved person’s answers when opened', async () => {
		const { fixture, redraw } = await employees();
		(fixture.nativeElement.querySelector('button[title="edit"]') as HTMLButtonElement).click();
		await redraw();
		expect([
			field<HTMLSelectElement>('emp_gender')?.value,
			field('emp_disability')?.checked,
			field('emp_pt_exempt')?.value,
		]).toEqual(['woman', true, 'Serving defence']);
	});
});
