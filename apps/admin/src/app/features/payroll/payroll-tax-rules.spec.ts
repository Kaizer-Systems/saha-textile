import { ApplicationRef, TemplateRef, signal, type EmbeddedViewRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { PayrollGateway } from '@core/accounts/payroll.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import {
	PayrollRulesPage,
	SLAB_GROUPS,
	TIER_GROUPS,
	ruleRows,
	taxToForm,
	taxToWrite,
	toForm,
	toWrite,
	type SlabGroup,
	type TierGroup,
} from './payroll-rules-page';

import type { IncomeTaxRules, PayrollRulesVersion } from '@saha-textile/contracts';

/** Income tax under both regimes on Settings › Payroll rules (brief 25 TX2): slabs, surcharge, rebates, limits. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};

const lakh = (n: number) => n * 1_00_000_00;
const TAX: IncomeTaxRules = {
	newSlabs: [
		{ upToPaise: lakh(4), ratePct: 0 },
		{ upToPaise: lakh(8), ratePct: 5 },
		{ upToPaise: null, ratePct: 30 },
	],
	newStandardDeductionPaise: 75_000_00,
	newRebateUpToPaise: lakh(12),
	newSurcharge: [
		{ overPaise: lakh(50), ratePct: 10 },
		{ overPaise: lakh(100), ratePct: 15 },
	],
	oldSlabsBelow60: [
		{ upToPaise: lakh(2.5), ratePct: 0 },
		{ upToPaise: null, ratePct: 30 },
	],
	oldSlabs60To79: [
		{ upToPaise: lakh(3), ratePct: 0 },
		{ upToPaise: null, ratePct: 30 },
	],
	oldSlabs80Plus: [{ upToPaise: null, ratePct: 30 }],
	oldStandardDeductionPaise: 50_000_00,
	oldRebateUpToPaise: lakh(5),
	oldRebateMaxPaise: 12_500_00,
	oldSurcharge: [{ overPaise: lakh(50), ratePct: 10 }],
	cessPct: 4,
	limit80cPaise: lakh(1.5),
	limit80dPaise: 25_000_00,
	limitHomeLoanPaise: lakh(2),
	proofFromMonth: 1,
};

const version = (id: string, over: Record<string, unknown> = {}) =>
	({
		id,
		from: '2025-04-01',
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
		ptSlabs: [{ upToPaise: null, taxPaise: 20_000 }],
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
		states: [],
		incomeTax: TAX,
		...over,
	}) as unknown as PayrollRulesVersion;
const WITH_TAX = version('v3');
const WITHOUT_TAX = version('v2', { incomeTax: undefined });

interface Opened {
	close: ReturnType<typeof vi.fn>;
	dismiss: ReturnType<typeof vi.fn>;
	view: EmbeddedViewRef<unknown>;
}

function mount(current: PayrollRulesVersion) {
	TestBed.resetTestingModule();
	document.body.querySelectorAll('.tx-test-modal').forEach((node) => node.remove());
	const opened: Opened[] = [];
	const calls = { rules: vi.fn(() => of([current])), addRules: vi.fn(() => of(current)) };
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
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			provideRouter([]),
			{ provide: PayrollGateway, useValue: calls },
			{ provide: NotificationService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
			{ provide: AuthStore, useValue: { permissions: signal(['accounts.index', 'accounts.lock']) } },
			{
				provide: NgbModal,
				useValue: {
					open: vi.fn((content: TemplateRef<unknown>) => {
						const ref = { close: vi.fn(), dismiss: vi.fn() };
						const view = content.createEmbeddedView({ $implicit: ref });
						TestBed.inject(ApplicationRef).attachView(view);
						view.detectChanges();
						const holder = document.createElement('div');
						holder.className = 'tx-test-modal';
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
	return { fixture, page: fixture.componentInstance, opened, calls };
}

async function editing(current: PayrollRulesVersion = WITH_TAX) {
	const harness = mount(current);
	await settle(harness.fixture);
	(harness.fixture.nativeElement.querySelector('#rules_add') as HTMLButtonElement).click();
	const popup = harness.opened[0] as Opened;
	const redraw = async () => {
		popup.view.detectChanges();
		await new Promise((resolve) => setTimeout(resolve, 0));
		popup.view.detectChanges();
	};
	await redraw();
	return { ...harness, redraw };
}

const modal = <T extends HTMLElement = HTMLElement>(selector: string) =>
	document.querySelector(`.tx-test-modal ${selector}`) as T | null;
const enter = (control: Element | null | undefined, value: string) => {
	const box = control as HTMLInputElement;
	box.value = value;
	box.dispatchEvent(new Event('input'));
};
/** A slab or tier group's heading, its table's rows and its add button. */
function group(key: string) {
	const heading = [...document.querySelectorAll('.tx-test-modal h6')].find(
		(h) => h.textContent?.trim() === key,
	) as HTMLElement;
	const table = heading.nextElementSibling as HTMLElement;
	return {
		rows: [...table.querySelectorAll('tbody tr')] as HTMLElement[],
		add: table.nextElementSibling as HTMLButtonElement,
	};
}

describe('income tax as a form and back (TX2)', () => {
	it('names the four slab tables and the two surcharge tables', () => {
		expect(SLAB_GROUPS).toEqual(['newSlabs', 'oldSlabsBelow60', 'oldSlabs60To79', 'oldSlabs80Plus']);
		expect(TIER_GROUPS).toEqual(['newSurcharge', 'oldSurcharge']);
	});

	it('shows money in rupees with the open top slab empty, and writes it back in paise', () => {
		const form = taxToForm(TAX);
		expect(form.slabs.newSlabs).toEqual([
			{ upTo: 4_00_000, rate: 0 },
			{ upTo: 8_00_000, rate: 5 },
			{ upTo: null, rate: 30 },
		]);
		expect(form.tiers.newSurcharge).toEqual([
			{ over: 50_00_000, rate: 10 },
			{ over: 1_00_00_000, rate: 15 },
		]);
		expect(form).toMatchObject({
			newStandard: 75_000,
			newRebateUpTo: 12_00_000,
			oldStandard: 50_000,
			oldRebateUpTo: 5_00_000,
			oldRebateMax: 12_500,
			cessPct: 4,
			limit80c: 1_50_000,
			limit80d: 25_000,
			limitHomeLoan: 2_00_000,
			proofFromMonth: 1,
		});
		// Brief 26 TX4: section 126's limits, the rounding and the cities come from the built-in set for a version without them.
		expect(taxToWrite(form)).toMatchObject(TAX);
	});

	it('carries income tax through a version’s form only when the version has it', () => {
		const withTax = toForm(WITH_TAX, '2026-04-01');
		expect(withTax.incomeTax).toEqual(taxToForm(TAX));
		expect(toWrite(withTax).incomeTax).toMatchObject(TAX);
		const without = toForm(WITHOUT_TAX, '2026-04-01');
		expect(without.incomeTax).toBeNull();
		expect('incomeTax' in toWrite(without)).toBe(false);
	});

	it('words the tax rule from the version’s figures, or as before when it has none', () => {
		const tds = (v: PayrollRulesVersion) => ruleRows(v).find((r) => r.key === 'tds');
		expect(tds(WITH_TAX)).toEqual({
			key: 'tds',
			from: '2025-04-01',
			values: { std: '75,000', rebate: '12,00,000', oldStd: '50,000', cess: '4' },
		});
		expect(tds(WITHOUT_TAX)).toEqual({ key: 'tds', from: null, values: {} });
	});
});

describe('the income-tax section of the add-a-version pop-up (TX2)', () => {
	it('shows the deductions, rebates, cess, limits and proof month, and changes each', async () => {
		const { page, redraw } = await editing();
		expect(document.querySelector('.tx-test-modal')?.textContent).toContain('payroll_tax_rules_title');
		expect(modal<HTMLInputElement>('#pr_tax_new_std')?.value).toBe('75000');
		const typed: [string, string, string][] = [
			['#pr_tax_new_std', '80000', 'newStandard'],
			['#pr_tax_new_rebate', '1300000', 'newRebateUpTo'],
			['#pr_tax_old_std', '60000', 'oldStandard'],
			['#pr_tax_old_rebate', '600000', 'oldRebateUpTo'],
			['#pr_tax_old_rebate_max', '15000', 'oldRebateMax'],
			['#pr_tax_cess', '5', 'cessPct'],
			['#pr_tax_80c', '200000', 'limit80c'],
			['#pr_tax_home', '300000', 'limitHomeLoan'],
			['#pr_tax_proof', '12', 'proofFromMonth'],
		];
		for (const [selector, value] of typed) enter(modal(selector), value);
		await redraw();
		const tax = page.form()?.incomeTax as unknown as Record<string, number>;
		expect(typed.map(([, , key]) => tax[key])).toEqual(typed.map(([, value]) => Number(value)));
	});

	it('draws each slab table with the open top slab above the rest and no remove button on it', async () => {
		await editing();
		expect(SLAB_GROUPS.map((g) => group(`payroll_tax_slabs_${g}`).rows.length)).toEqual([3, 2, 2, 1]);
		const { rows } = group('payroll_tax_slabs_newSlabs');
		expect(rows[2]?.textContent).toContain('payroll_f_pt_above');
		expect(rows.map((row) => row.querySelectorAll('button').length)).toEqual([1, 1, 0]);
		expect(TIER_GROUPS.map((g) => group(`payroll_tax_tiers_${g}`).rows.length)).toEqual([2, 1]);
	});

	it('edits a slab, adds one below the open top slab and removes one, in that table only', async () => {
		const { page, redraw } = await editing();
		const slabs = () => page.form()?.incomeTax?.slabs as Record<SlabGroup, { upTo: number | null; rate: number }[]>;
		enter(
			group('payroll_tax_slabs_newSlabs').rows[1]?.querySelector('input[aria-label="payroll_tax_f_up_to"]'),
			'900000',
		);
		enter(
			group('payroll_tax_slabs_newSlabs').rows[1]?.querySelector('input[aria-label="payroll_tax_f_rate"]'),
			'10',
		);
		await redraw();
		expect(slabs().newSlabs[1]).toEqual({ upTo: 9_00_000, rate: 10 });
		expect(slabs().newSlabs[0]).toEqual({ upTo: 4_00_000, rate: 0 });
		group('payroll_tax_slabs_oldSlabsBelow60').add.click();
		await redraw();
		expect(slabs().oldSlabsBelow60).toEqual([
			{ upTo: 2_50_000, rate: 0 },
			{ upTo: 0, rate: 0 },
			{ upTo: null, rate: 30 },
		]);
		(group('payroll_tax_slabs_newSlabs').rows[0]?.querySelector('button') as HTMLButtonElement).click();
		await redraw();
		expect(slabs().newSlabs.map((s) => s.upTo)).toEqual([9_00_000, null]);
		expect(slabs().oldSlabs80Plus).toHaveLength(1);
	});

	it('edits, adds and removes surcharge tiers', async () => {
		const { page, redraw } = await editing();
		const tiers = () => page.form()?.incomeTax?.tiers as Record<TierGroup, { over: number; rate: number }[]>;
		enter(
			group('payroll_tax_tiers_newSurcharge').rows[1]?.querySelector('input[aria-label="payroll_tax_f_over"]'),
			'20000000',
		);
		enter(
			group('payroll_tax_tiers_newSurcharge').rows[1]?.querySelector('input[aria-label="payroll_tax_f_rate"]'),
			'25',
		);
		await redraw();
		expect(tiers().newSurcharge).toEqual([
			{ over: 50_00_000, rate: 10 },
			{ over: 2_00_00_000, rate: 25 },
		]);
		group('payroll_tax_tiers_oldSurcharge').add.click();
		await redraw();
		expect(tiers().oldSurcharge).toEqual([
			{ over: 50_00_000, rate: 10 },
			{ over: 0, rate: 0 },
		]);
		(group('payroll_tax_tiers_oldSurcharge').rows[0]?.querySelector('button') as HTMLButtonElement).click();
		await redraw();
		expect(tiers().oldSurcharge).toEqual([{ over: 0, rate: 0 }]);
	});

	it('saves the income tax in paise with the rest of the version', async () => {
		const { page, calls, redraw } = await editing();
		enter(modal('#pr_tax_cess'), '5');
		await redraw();
		await page.save();
		const [sent] = calls.addRules.mock.lastCall as unknown as [{ incomeTax: IncomeTaxRules }];
		expect(sent.incomeTax).toMatchObject({ ...TAX, cessPct: 5 });
	});

	it('has no income-tax section for a version without it, and every change is then left alone', async () => {
		const { page } = await editing(WITHOUT_TAX);
		expect(modal('#pr_tax_new_std')).toBeNull();
		const before = page.form();
		page.patchTax({ cessPct: 5 });
		page.setTaxSlab('newSlabs', 0, { rate: 1 });
		page.addTaxSlab('newSlabs');
		page.removeTaxSlab('newSlabs', 0);
		page.setTier('newSurcharge', 0, { rate: 1 });
		page.addTier('newSurcharge');
		page.removeTier('newSurcharge', 0);
		expect(page.form()).toBe(before);
		const closed = mount(WITH_TAX);
		closed.page.patchTax({ cessPct: 5 });
		closed.page.addTier('oldSurcharge');
		expect(closed.page.form()).toBeNull();
	});
});

describe('section 126’s limits, the rounding and the rent cities (brief 26 TX4)', () => {
	const custom = {
		...TAX,
		health126: {
			selfPaise: 30_000_00,
			selfSeniorPaise: 60_000_00,
			parentsPaise: 30_000_00,
			parentsSeniorPaise: 60_000_00,
			checkupPaise: 6_000_00,
		},
		rounding: 'rupee',
		rentCities: ['Mumbai', 'Kochi'],
	} as IncomeTaxRules;

	it('reads a version’s own limits, rounding and cities, or the built-in ones for a version without them', () => {
		expect(taxToForm(custom)).toMatchObject({
			health: { self: 30_000, selfSenior: 60_000, parents: 30_000, parentsSenior: 60_000, checkup: 6_000 },
			rounding: 'rupee',
			rentCities: ['Mumbai', 'Kochi'],
		});
		const built = taxToForm(TAX);
		expect(built.health).toEqual({
			self: 25_000,
			selfSenior: 50_000,
			parents: 25_000,
			parentsSenior: 50_000,
			checkup: 5_000,
		});
		expect(built.rounding).toBe('ten');
		expect(built.rentCities).toHaveLength(8);
	});

	it('writes them back in paise, the cities trimmed with a one-letter one dropped, and 80D following the family’s limit', () => {
		const form = { ...taxToForm(custom), rentCities: [' Kochi ', 'X', 'Surat'] };
		expect(taxToWrite(form)).toMatchObject({
			health126: custom.health126,
			rounding: 'rupee',
			rentCities: ['Kochi', 'Surat'],
			limit80dPaise: 30_000_00,
		});
	});

	it('changes each limit and the rounding in the pop-up', async () => {
		const { page, redraw } = await editing();
		const keys = ['self', 'selfSenior', 'parents', 'parentsSenior', 'checkup'] as const;
		for (const [i, key] of keys.entries()) enter(modal(`#pr_tax_126_${key}`), String(10_000 + i));
		const rounding = modal<HTMLSelectElement>('#pr_tax_rounding') as HTMLSelectElement;
		rounding.value = 'rupee';
		rounding.dispatchEvent(new Event('change'));
		await redraw();
		expect(page.form()?.incomeTax?.health).toEqual({
			self: 10_000,
			selfSenior: 10_001,
			parents: 10_002,
			parentsSenior: 10_003,
			checkup: 10_004,
		});
		expect(page.form()?.incomeTax?.rounding).toBe('rupee');
	});

	it('adds a city of two letters or more once in any case, empties the box, and removes a city', async () => {
		const { page, redraw } = await editing();
		const cities = () => page.form()?.incomeTax?.rentCities;
		const add = () => modal<HTMLButtonElement>('#pr_tax_city_add') as HTMLButtonElement;
		enter(modal('#pr_tax_city'), ' K ');
		await redraw();
		expect(add().disabled).toBe(true);
		page.addCity();
		expect([cities()?.length, page.cityToAdd()]).toEqual([8, ' K ']);
		enter(modal('#pr_tax_city'), '  Kochi ');
		await redraw();
		add().click();
		await redraw();
		expect([cities()?.at(-1), page.cityToAdd()]).toEqual(['Kochi', '']);
		enter(modal('#pr_tax_city'), 'mumbai');
		await redraw();
		add().click();
		await redraw();
		expect([cities()?.length, page.cityToAdd()]).toEqual([9, '']);
		const rows = [...(modal('#pr_tax_city')?.closest('tbody')?.querySelectorAll('tr') ?? [])];
		(rows[0]?.querySelector('button') as HTMLButtonElement).click();
		await redraw();
		expect(cities()).not.toContain('Mumbai');
		expect(cities()).toHaveLength(8);
	});

	it('leaves the limits and cities alone for a version without income tax', async () => {
		const { page } = await editing(WITHOUT_TAX);
		page.setHealth('self', 1);
		page.cityToAdd.set('Kochi');
		page.addCity();
		page.removeCity(0);
		expect(page.form()?.incomeTax).toBeNull();
	});
});
