import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { PayrollGateway } from '@core/accounts/payroll.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { SALARY_HEADS, SalaryStructuresPage, freeHeads, starterComponents } from './salary-structures-page';

/** Salary structures (accounts brief S4): templates set each head as a %, a fixed amount or the rest. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const refusal = (code: string) => ({ error: { message: code } });

const TEMPLATE = {
	id: 't1',
	name: 'Shop staff',
	examplePayINR: 18_000,
	components: [
		{ head: 'basic', how: 'percent', value: 50 },
		{ head: 'special', how: 'rest', value: 0 },
	],
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
	version: 2,
};
const preview = (shortfallINR: number) => ({
	structure: { basic: 9_000, special: 9_000 },
	lines: [],
	totalINR: 18_000,
	basicSharePct: 50,
	shortfallINR,
});

function mount(gateway: Record<string, unknown> = {}, permissions = ['accounts.index', 'accounts.edit']) {
	TestBed.resetTestingModule();
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const invalidate = vi.spyOn(queries, 'invalidateQueries');
	const calls = {
		structures: vi.fn(() => of([TEMPLATE])),
		previewStructure: vi.fn(() => of(preview(0))),
		createStructure: vi.fn(() => of({ ...TEMPLATE, id: 't9', name: 'New' })),
		updateStructure: vi.fn(() => of({ ...TEMPLATE, version: 3 })),
		...gateway,
	};
	TestBed.configureTestingModule({
		imports: [
			SalaryStructuresPage,
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
		],
	});
	const fixture = TestBed.createComponent(SalaryStructuresPage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, notifier, invalidate, calls };
}

async function structures(gateway: Record<string, unknown> = {}, permissions?: string[]) {
	const harness = mount(gateway, permissions);
	await settle(harness.fixture);
	return harness;
}

const el = (fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as HTMLElement | null;
const enter = (control: Element | null | undefined, value: string) => {
	const box = control as HTMLInputElement;
	box.value = value;
	box.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
};
const lineRows = (fixture: { nativeElement: HTMLElement }) =>
	([...fixture.nativeElement.querySelectorAll('tbody tr')] as HTMLElement[]).filter((tr) =>
		tr.querySelector('select'),
	);

describe('the starting template and the heads left', () => {
	it('starts basic 40%, DA 5%, HRA 20%, conveyance ₹1,600 and special the rest, leaving “other” free', () => {
		expect([...SALARY_HEADS]).toEqual(['basic', 'da', 'hra', 'conveyance', 'special', 'other']);
		expect(starterComponents().map((c) => [c.head, c.how, c.value])).toEqual([
			['basic', 'percent', 40],
			['da', 'percent', 5],
			['hra', 'percent', 20],
			['conveyance', 'fixed', 1_600],
			['special', 'rest', 0],
		]);
		expect(freeHeads(starterComponents())).toEqual(['other']);
		expect(freeHeads([])).toEqual([...SALARY_HEADS]);
	});
});

describe('the salary structures page (S4)', () => {
	it('previews the starter on ₹20,000, warns only when basic and DA fall short of half, and saves a new one', async () => {
		const previewStructure = vi.fn(() => of(preview(1_000)));
		const { fixture, page, calls, notifier, invalidate } = await structures({ previewStructure });
		expect(previewStructure).toHaveBeenCalledWith({ components: starterComponents(), payINR: 20_000, ctc: false });
		expect(fixture.nativeElement.querySelector('.alert-warning')).not.toBeNull();
		expect(page.money(1_234.5)).toBe('₹1,234.50');
		const save = el(fixture, '#sst_save') as HTMLButtonElement;
		expect(save.disabled).toBe(true);
		enter(el(fixture, '#sst_name'), 'Counter staff');
		enter(el(fixture, '#sst_pay'), '25000');
		await settle(fixture);
		expect(previewStructure).toHaveBeenLastCalledWith(expect.objectContaining({ payINR: 25_000 }));
		expect(save.disabled).toBe(false);
		save.click();
		await settle(fixture);
		expect(calls.createStructure).toHaveBeenCalledWith({
			name: 'Counter staff',
			examplePayINR: 25_000,
			components: starterComponents(),
		});
		expect(page.editing()?.id).toBe('t9');
		expect(notifier.showSuccess).toHaveBeenCalledWith('payroll_structure_saved');
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['payroll', 'structures'] });
	});

	it('opens a template as a copy of its lines and saves the change with its version', async () => {
		const { fixture, page, calls } = await structures();
		expect(fixture.nativeElement.querySelector('.alert-warning')).toBeNull();
		const open = [...fixture.nativeElement.querySelectorAll('button')].find((b) =>
			(b as HTMLElement).textContent?.includes('Shop staff'),
		) as HTMLButtonElement;
		open.click();
		await settle(fixture);
		expect([page.name(), page.examplePayINR()]).toEqual(['Shop staff', 18_000]);
		expect(page.components()).toEqual(TEMPLATE.components);
		expect(page.components()[0]).not.toBe(TEMPLATE.components[0]);
		await page.save();
		expect(calls.updateStructure).toHaveBeenCalledWith('t1', {
			name: 'Shop staff',
			examplePayINR: 18_000,
			components: TEMPLATE.components,
			version: 2,
		});
		page.pick(null);
		expect([page.editing(), page.name(), page.examplePayINR(), page.components()]).toEqual([
			null,
			'',
			20_000,
			starterComponents(),
		]);
	});

	it('changes, adds and removes lines, offering only free heads, and previews nothing with no lines', async () => {
		const { fixture, page, calls } = await structures();
		const first = lineRows(fixture)[0] as HTMLElement;
		const [head, how] = [...first.querySelectorAll('select')];
		expect([...(head as HTMLSelectElement).options].filter((o) => o.disabled).map((o) => o.value)).toEqual([
			'da',
			'hra',
			'conveyance',
			'special',
		]);
		enter(how, 'fixed');
		enter(first.querySelector('input'), '9000');
		expect(page.components()[0]).toEqual({ head: 'basic', how: 'fixed', value: 9_000 });
		await settle(fixture);
		expect(lineRows(fixture)[4]?.querySelector('input')).toBeNull();
		([...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[])
			.find((b) => !b.closest('table') && b.textContent?.includes('payroll_add_line'))
			?.click();
		page.addLine();
		expect(page.components().map((c) => c.head)).toEqual(['basic', 'da', 'hra', 'conveyance', 'special', 'other']);
		expect(page.free()).toEqual([]);
		page.addLine();
		expect(page.components()).toHaveLength(6);
		const calls0 = calls.previewStructure.mock.calls.length;
		for (let i = 0; i < 6; i++) page.removeLine(0);
		await settle(fixture);
		expect(page.components()).toEqual([]);
		expect(calls.previewStructure).toHaveBeenCalledTimes(calls0);
		page.setLine(0, { value: 1 });
		expect(page.components()).toEqual([]);
	});

	it('names a refusal, and offers no save to someone who may not edit', async () => {
		const createStructure = vi
			.fn()
			.mockReturnValueOnce(throwError(() => refusal('payroll_structure_name_taken')))
			.mockReturnValueOnce(throwError(() => new Error('down')));
		const { page, notifier } = await structures({ createStructure });
		await page.save();
		expect(notifier.showError).toHaveBeenLastCalledWith('payroll_problem_payroll_structure_name_taken');
		await page.save();
		expect(notifier.showError).toHaveBeenLastCalledWith('payroll_problem_failed');
		expect(page.busy()).toBe(false);
		const reader = await structures({}, ['accounts.index']);
		expect(el(reader.fixture, '#sst_save')).toBeNull();
	});

	it('says when there are no templates yet', async () => {
		const { fixture } = await structures({ structures: vi.fn(() => of([])) });
		expect(fixture.nativeElement.textContent).toContain('payroll_structures_none');
	});
});
