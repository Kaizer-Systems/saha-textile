import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { PayrollGateway } from '@core/accounts/payroll.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { SalaryStructuresPage, starterComponents } from './salary-structures-page';

import type { SalaryTemplate } from '@saha-textile/contracts';

/**
 * Salary structures built from the yearly CTC (brief 26 SR1): the basis, an example CTC a year, "% of CTC" and "% of
 * Basic", the employer's share and the month's CTC, and the refusal when the heads take more than the CTC.
 */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const template = (over: Partial<SalaryTemplate> = {}) =>
	({
		id: 't1',
		name: 'Shop staff',
		examplePayINR: 18_000,
		components: [
			{ head: 'basic', how: 'percent', value: 50 },
			{ head: 'hra', how: 'percent_basic', value: 40 },
			{ head: 'special', how: 'rest', value: 0 },
		],
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		version: 2,
		...over,
	}) as SalaryTemplate;
const preview = (over: Record<string, unknown> = {}) => ({
	structure: { basic: 13_500, hra: 5_400, special: 6_100 },
	lines: [],
	totalINR: 25_000,
	basicSharePct: 54,
	shortfallINR: 0,
	...over,
});

async function structures(previewOf: () => unknown = () => preview()) {
	TestBed.resetTestingModule();
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const calls = {
		structures: vi.fn(() =>
			of([template(), template({ id: 't2', name: 'Managers', basis: 'ctc', exampleCtcYearINR: 600_000 })]),
		),
		previewStructure: vi.fn(() => of(previewOf())),
		createStructure: vi.fn(() => of(template({ id: 't9' }))),
		updateStructure: vi.fn(() => of(template({ version: 3 }))),
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
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			provideRouter([]),
			{ provide: PayrollGateway, useValue: calls },
			{ provide: NotificationService, useValue: notifier },
			{ provide: AuthStore, useValue: { permissions: signal(['accounts.index', 'accounts.edit']) } },
		],
	});
	const fixture = TestBed.createComponent(SalaryStructuresPage);
	fixture.detectChanges();
	await settle(fixture);
	const find = <T extends HTMLElement = HTMLInputElement>(selector: string) =>
		fixture.nativeElement.querySelector(selector) as T | null;
	const enter = async (box: Element | null, value: string) => {
		(box as HTMLInputElement).value = value;
		box?.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
		await settle(fixture);
	};
	return { fixture, page: fixture.componentInstance, calls, find, enter, settle: () => settle(fixture) };
}

const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim();

describe('salary structures built from the yearly CTC (SR1)', () => {
	it('builds from the monthly gross as before, and offers the yearly CTC instead', async () => {
		const { page, find, calls } = await structures();
		expect([page.basis(), page.example()]).toEqual(['gross', 20_000]);
		expect([...(find<HTMLSelectElement>('#sst_basis')?.options ?? [])].map((o) => [o.value, text(o)])).toEqual([
			['ctc', 'payroll_basis_ctc'],
			['gross', 'payroll_basis_gross'],
		]);
		expect([find('#sst_pay') === null, find('#sst_ctc')]).toEqual([false, null]);
		expect(text(find('h5 + small'))).toBe('payroll_example_pay_line');
		expect(calls.previewStructure).toHaveBeenLastCalledWith({
			components: starterComponents(),
			payINR: 20_000,
			ctc: false,
		});
		const hows = [...(find('tbody tr')?.querySelectorAll('select') ?? [])][1] as HTMLSelectElement;
		expect([...hows.options].map((o) => [o.value, text(o)])).toEqual([
			['percent', 'payroll_how_percent'],
			['percent_basic', 'payroll_how_percent_basic'],
			['fixed', 'payroll_how_fixed'],
			['rest', 'payroll_how_rest'],
		]);
	});

	it('previews a yearly CTC, its employer’s share and the month’s CTC, and “% of CTC”', async () => {
		const { page, find, enter, calls } = await structures(() =>
			preview({ employerINR: 2_475.5, ctcMonthINR: 30_000 }),
		);
		await enter(find('#sst_basis'), 'ctc');
		expect([page.basis(), page.example(), find('#sst_pay')]).toEqual(['ctc', 360_000, null]);
		expect(find('#sst_ctc')?.value).toBe('360000');
		expect(calls.previewStructure).toHaveBeenLastCalledWith({
			components: starterComponents(),
			payINR: 360_000,
			ctc: true,
		});
		await enter(find('#sst_ctc'), '480000');
		expect([page.exampleCtcYearINR(), page.example()]).toEqual([480_000, 480_000]);
		expect(calls.previewStructure).toHaveBeenLastCalledWith(
			expect.objectContaining({ payINR: 480_000, ctc: true }),
		);
		expect(text(find('h5 + small'))).toBe('payroll_example_ctc_line');
		const hows = [...(find('tbody tr')?.querySelectorAll('select') ?? [])][1] as HTMLSelectElement;
		expect(text(hows.options[0])).toBe('payroll_how_percent_ctc');
		expect(text(find('#sst_employer'))).toBe(page.money(2_475.5));
		expect(text(find('#sst_ctc_month'))).toBe(page.money(30_000));
		expect(text(find('#sst_employer')?.previousElementSibling)).toBe('payroll_structure_employer');
		expect(find('#sst_over')).toBeNull();
	});

	it('shows the employer’s share as nothing when the preview gives none, and no CTC rows from the gross', async () => {
		const gross = await structures();
		expect([gross.find('#sst_employer'), gross.find('#sst_ctc_month')]).toEqual([null, null]);
		const bare = await structures(() => preview({ ctcMonthINR: null }));
		expect(text(bare.find('#sst_employer'))).toBe(bare.page.money(0));
		expect(text(bare.find('#sst_ctc_month'))).toBe(bare.page.money(0));
	});

	it('refuses heads that take more than the CTC, and says nothing when they fit', async () => {
		const over = await structures(() => preview({ fits: false, ctcMonthINR: 30_000, employerINR: 2_000 }));
		expect(text(over.find('#sst_over'))).toBe('payroll_structure_over_ctc');
		const fits = await structures(() => preview({ fits: true, ctcMonthINR: 30_000, employerINR: 2_000 }));
		expect(fits.find('#sst_over')).toBeNull();
	});

	it('opens a template on its own basis and example CTC, and a new one from the gross', async () => {
		const { page } = await structures();
		page.pick(template({ basis: 'ctc', exampleCtcYearINR: 420_000 }));
		expect([page.basis(), page.exampleCtcYearINR(), page.example()]).toEqual(['ctc', 420_000, 420_000]);
		page.pick(template());
		expect([page.basis(), page.exampleCtcYearINR(), page.examplePayINR()]).toEqual(['gross', 360_000, 18_000]);
		page.basis.set('ctc');
		page.pick(null);
		expect([page.basis(), page.exampleCtcYearINR(), page.examplePayINR()]).toEqual(['gross', 360_000, 20_000]);
	});

	it('saves the basis and example CTC only for a structure from the CTC', async () => {
		const { page, calls } = await structures();
		page.name.set('Floor staff');
		await page.save();
		expect(calls.createStructure).toHaveBeenLastCalledWith({
			name: 'Floor staff',
			examplePayINR: 20_000,
			components: starterComponents(),
		});
		page.pick(template({ basis: 'ctc', exampleCtcYearINR: 420_000 }));
		await page.save();
		expect(calls.updateStructure).toHaveBeenLastCalledWith('t1', {
			name: 'Shop staff',
			examplePayINR: 18_000,
			components: template().components,
			basis: 'ctc',
			exampleCtcYearINR: 420_000,
			version: 2,
		});
	});
});
