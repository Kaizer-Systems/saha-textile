import { ApplicationRef, TemplateRef, signal } from '@angular/core';
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

import { currentMonth } from './attendance-page';
import { EmployeesPage } from './employees-page';

/** Employees (accounts brief S3, S4): which schemes apply, and filling a structure from a template. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const refusal = (code: string) => ({ error: { message: code } });

const SCHEMES = [
	{ scheme: 'pf', startsAt: 20, headcount: 12, eligible: 9, status: 'soon' },
	{ scheme: 'pt', startsAt: null, headcount: 12, eligible: null, status: 'applies' },
];
const TEMPLATE = {
	id: 't1',
	name: 'Shop staff',
	examplePayINR: 18_000,
	components: [
		{ head: 'basic', how: 'percent', value: 50 },
		{ head: 'special', how: 'rest', value: 0 },
	],
	version: 1,
};

function mount(gateway: Record<string, unknown> = {}) {
	TestBed.resetTestingModule();
	document.body.querySelectorAll('.es-test-modal').forEach((node) => node.remove());
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const calls = {
		employees: vi.fn(() => of([])),
		schemes: vi.fn(() => of(SCHEMES)),
		structures: vi.fn(() => of([TEMPLATE])),
		previewStructure: vi.fn(() => of({ structure: { basic: 12_500, special: 12_500 } })),
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
						holder.className = 'es-test-modal';
						holder.append(...(view.rootNodes as Node[]));
						document.body.append(holder);
						return { ...ref, view };
					}),
				},
			},
		],
	});
	const fixture = TestBed.createComponent(EmployeesPage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, notifier, calls };
}

const modal = (selector: string) => document.querySelector(`.es-test-modal ${selector}`) as HTMLElement | null;
const enter = (control: Element | null, value: string) => {
	const box = control as HTMLInputElement;
	box.value = value;
	box.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
};

describe('which schemes apply (S3)', () => {
	it('reads this month’s schemes and words when each starts and who is eligible', async () => {
		const { fixture, calls } = mount();
		await settle(fixture);
		expect(calls.schemes).toHaveBeenCalledWith(currentMonth());
		const text = fixture.nativeElement.textContent as string;
		expect(text).toContain('payroll_scheme_starts');
		expect(text).toContain('payroll_scheme_any_staff');
		expect(text).toContain('payroll_scheme_have_eligible');
		expect(text).toContain('payroll_scheme_next_pf_soon');
		expect(text).toContain('payroll_scheme_next_pt_applies');
	});
});

describe('filling a structure from a template (S4)', () => {
	it('fills the structure from the template on the pay typed, keeping the other heads', async () => {
		const { fixture, page, calls } = mount();
		await settle(fixture);
		(fixture.nativeElement.querySelector('#emp_add') as HTMLButtonElement).click();
		page.patchStructure('hra', 3_000);
		const apply = () =>
			[...document.querySelectorAll('.es-test-modal button')].find((b) =>
				b.textContent?.includes('payroll_apply_template'),
			) as HTMLButtonElement | undefined;
		enter(modal('#emp_template'), 't1');
		enter(modal('#emp_template_pay'), '25000');
		expect([page.templateId(), page.templatePay()]).toEqual(['t1', 25_000]);
		apply()?.click();
		await page.applyTemplate();
		expect(calls.previewStructure).toHaveBeenCalledWith({ components: TEMPLATE.components, payINR: 25_000 });
		expect(page.form().structure).toMatchObject({ basic: 12_500, special: 12_500, hra: 3_000 });
	});

	it('does nothing when no template is picked, and names a refusal', async () => {
		const previewStructure = vi.fn(() => throwError(() => refusal('payroll_structure_invalid')));
		const { fixture, page, notifier } = mount({ previewStructure });
		await settle(fixture);
		await page.applyTemplate();
		expect(previewStructure).not.toHaveBeenCalled();
		page.templateId.set('t1');
		page.templatePay.set(20_000);
		await page.applyTemplate();
		expect(notifier.showError).toHaveBeenCalledWith('payroll_problem_payroll_structure_invalid');
	});

	it('offers no template row when there are none', async () => {
		const { fixture, page } = mount({ structures: vi.fn(() => of([])) });
		await settle(fixture);
		(fixture.nativeElement.querySelector('#emp_add') as HTMLButtonElement).click();
		expect(modal('#emp_template')).toBeNull();
		page.templateId.set('t1');
		await page.applyTemplate();
		expect(page.form().structure.basic).toBe(0);
	});
});
