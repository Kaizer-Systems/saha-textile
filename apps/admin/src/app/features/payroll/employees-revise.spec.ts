import { ApplicationRef, TemplateRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

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
import { RevisePayPopup } from './revise-pay-popup';

import type { EmployeeView } from '@saha-textile/contracts';

/** Employees (brief 26 SR2, SR4): Revise pay beside Edit, and the skill level a State's minimum wages are set by. */

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

async function employees(permissions = ['accounts.index', 'accounts.edit'], route?: unknown, bare = false) {
	TestBed.resetTestingModule();
	document.body.querySelectorAll('.rev-test-modal').forEach((node) => node.remove());
	const views: { detectChanges: () => void }[] = [];
	const popups: { content: unknown; options: unknown; start: ReturnType<typeof vi.fn> }[] = [];
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
			...(route === undefined ? [] : [{ provide: ActivatedRoute, useValue: route }]),
			{
				provide: PayrollGateway,
				useValue: { employees: vi.fn(() => of([person()])), rules: vi.fn(() => of([])) },
			},
			{
				provide: LocationsGateway,
				useValue: { list: vi.fn(() => of([{ id: 'l1', name: 'Barasat', active: true }])) },
			},
			{ provide: NotificationService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
			{ provide: AuthStore, useValue: { permissions: signal(permissions) } },
			{
				provide: NgbModal,
				useValue: {
					open: vi.fn((content: unknown, options: unknown) => {
						const ref = { close: vi.fn(), dismiss: vi.fn() };
						if (!(content instanceof TemplateRef)) {
							const start = vi.fn();
							popups.push({ content, options, start });
							return { ...ref, componentInstance: { start } };
						}
						const view = content.createEmbeddedView({ $implicit: ref });
						TestBed.inject(ApplicationRef).attachView(view);
						view.detectChanges();
						const holder = document.createElement('div');
						holder.className = 'rev-test-modal';
						holder.append(...(view.rootNodes as Node[]));
						document.body.append(holder);
						views.push(view);
						return ref;
					}),
				},
			},
		],
	});
	if (bare) TestBed.overrideComponent(EmployeesPage, { set: { template: '' } });
	const fixture = TestBed.createComponent(EmployeesPage);
	fixture.detectChanges();
	await settle(fixture);
	const redraw = async () => {
		views.at(-1)?.detectChanges();
		await new Promise((resolve) => setTimeout(resolve, 0));
		views.at(-1)?.detectChanges();
	};
	return { fixture, page: fixture.componentInstance, redraw, popups };
}

const modal = <T extends HTMLElement = HTMLSelectElement>(selector: string) =>
	[...document.querySelectorAll('.rev-test-modal')].at(-1)?.querySelector(selector) as T | null;

describe('Revise pay and the skill level on Employees (SR2, SR4)', () => {
	it('opens Revise pay, large, for the person on the row beside Edit, named on hover', async () => {
		const { fixture, popups } = await employees();
		const revise = fixture.nativeElement.querySelector('#emp_revise_e1') as HTMLButtonElement;
		expect(revise.title).toBe('payroll_revise_pay');
		revise.click();
		expect(popups).toHaveLength(1);
		expect(popups[0]?.content).toBe(RevisePayPopup);
		expect(popups[0]?.options).toEqual({ centered: true, size: 'xl' });
		expect(popups[0]?.start).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1', name: 'Asha Das' }));
	});

	it('offers no Revise pay to someone who may not edit', async () => {
		const { fixture } = await employees(['accounts.index']);
		expect(fixture.nativeElement.querySelector('#emp_revise_e1')).toBeNull();
	});

	it('picks the skill level, or none, on the employee form', async () => {
		const { fixture, page, redraw } = await employees();
		(fixture.nativeElement.querySelector('#emp_add') as HTMLButtonElement).click();
		await redraw();
		const skill = modal('#emp_skill') as HTMLSelectElement;
		expect([...skill.options].map((o) => [o.value, o.textContent?.trim()])).toEqual([
			['', '—'],
			['unskilled', 'payroll_skill_unskilled'],
			['semi_skilled', 'payroll_skill_semi_skilled'],
			['skilled', 'payroll_skill_skilled'],
			['highly_skilled', 'payroll_skill_highly_skilled'],
		]);
		expect(skill.value).toBe('');
		skill.value = 'skilled';
		skill.dispatchEvent(new Event('change'));
		await redraw();
		expect(page.form().skillLevel).toBe('skilled');
		skill.value = '';
		skill.dispatchEvent(new Event('change'));
		expect(page.form().skillLevel).toBeNull();
	});

	it('keeps a person’s structure template, CTC and skill level on an edit, and leaves them out when unset', () => {
		expect(
			employeeWrite(person({ templateId: 'tpl_shop', ctcYearINR: 300_000, skillLevel: 'semi_skilled' })),
		).toMatchObject({ templateId: 'tpl_shop', ctcYearINR: 300_000, skillLevel: 'semi_skilled' });
		const plain = employeeWrite(person({ templateId: null, ctcYearINR: null, skillLevel: null }));
		expect(['templateId' in plain, 'ctcYearINR' in plain, 'skillLevel' in plain]).toEqual([false, false, false]);
	});

	it('lands from the worklist on the person asked for, their form opened once the staff are read', async () => {
		const { page, fixture } = await employees(undefined, {
			snapshot: { queryParamMap: convertToParamMap({ employeeId: 'e1' }) },
		});
		expect(page.editing()?.id).toBe('e1');
		expect(document.querySelectorAll('.rev-test-modal')).toHaveLength(1);
		fixture.detectChanges();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(document.querySelectorAll('.rev-test-modal')).toHaveLength(1);
	});

	it('opens no form for someone not on the staff, nothing asked, or no form to open', async () => {
		for (const route of [
			{ snapshot: { queryParamMap: convertToParamMap({ employeeId: 'e9' }) } },
			{ snapshot: { queryParamMap: convertToParamMap({}) } },
			{ snapshot: {} },
			{},
		]) {
			const { page } = await employees(undefined, route);
			expect([page.editing(), document.querySelectorAll('.rev-test-modal').length]).toEqual([null, 0]);
		}
		const bare = await employees(
			undefined,
			{ snapshot: { queryParamMap: convertToParamMap({ employeeId: 'e1' }) } },
			true,
		);
		expect(bare.page.editing()).toBeNull();
	});
});
