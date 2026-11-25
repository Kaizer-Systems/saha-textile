import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { NEVER, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccountsTemplatesGateway } from '@core/accounts/accounts-templates.gateway';
import { CompanyGateway } from '@core/company/company.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { CompanyProfileSettings } from './company-profile';

import type { CompanyProfile, Partner, PartnerDeed } from '@saha-textile/contracts';

/** Settings › Company, the partners' deed (brief 25 YC2): its date, a new deed from a day, pay, interest, loss years. */

const partner = (id: string, name: string, over: Partial<Partner> = {}): Partner => ({
	id,
	name,
	pan: 'ABCDE1234F',
	working: true,
	capitalINR: 5_00_000,
	profitSharePercent: 50,
	interestOnCapitalPercent: 12,
	monthlyRemunerationINR: 25_000,
	remunerationBasis: 'monthly',
	remunerationPercent: 0,
	designated: false,
	dpin: null,
	...over,
});
const ARINDAM = partner('ptn_a', 'Arindam', { profitSharePercent: 60 });
const RUPA = partner('ptn_r', 'Rupa', {
	profitSharePercent: 40,
	remunerationBasis: 'percent_of_book_profit',
	remunerationPercent: 5,
});
const SLEEPING = partner('ptn_s', 'Sleeping', { working: false, profitSharePercent: 0, remunerationBasis: 'none' });

const firm = (patch: Partial<CompanyProfile> = {}): CompanyProfile => ({
	kind: 'partnership',
	legalName: 'Arindam and Rupa',
	tradeName: 'Saha Textile',
	pan: 'AAFFA1234B',
	tan: null,
	cin: null,
	llpin: null,
	udyam: null,
	financialYearStartMonth: 4,
	booksStartOn: null,
	homeCurrency: 'INR',
	proprietor: null,
	otherBusinesses: [],
	partners: [ARINDAM, RUPA, SLEEPING],
	partnersCapital: 'fixed_with_current',
	deedFrom: '2025-04-01',
	interestBasis: 'daily',
	lossYearCharges: false,
	earlierDeeds: [],
	directors: [],
	shareholders: [],
	authorisedCapitalINR: 0,
	paidUpCapitalINR: 0,
	faceValueINR: 10,
	nomineeName: null,
	revision: 1,
	updatedAt: '2026-11-25T10:00:00.000Z',
	updatedBy: null,
	...patch,
});
const EARLIER: PartnerDeed = {
	from: null,
	to: '2025-03-31',
	interestBasis: 'opening',
	lossYearCharges: true,
	partners: [
		{
			id: 'ptn_a',
			name: 'Arindam',
			working: true,
			profitSharePercent: 50,
			interestOnCapitalPercent: 10,
			monthlyRemunerationINR: 20_000,
			remunerationBasis: 'monthly',
			remunerationPercent: 0,
		},
		{
			id: 'ptn_r',
			name: 'Rupa',
			working: true,
			profitSharePercent: 50,
			interestOnCapitalPercent: 10,
			monthlyRemunerationINR: 0,
			remunerationBasis: 'none',
			remunerationPercent: 0,
		},
	],
};

function setup(current: CompanyProfile | null, permissions = ['setting.index', 'company.edit']) {
	const gateway = { profile: vi.fn(() => (current ? of(current) : NEVER)), saveProfile: vi.fn(() => of(current)) };
	const templates = {
		opens: vi.fn(() => of({ charts: [], taxRules: [], reports: [], locked: 0, booksSetUp: true })),
		setUpBooks: vi.fn(() => of([])),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			CompanyProfileSettings,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideRouter([]),
			provideTanStackQuery(new QueryClient()),
			{ provide: CompanyGateway, useValue: gateway },
			{ provide: AccountsTemplatesGateway, useValue: templates },
			{ provide: AuthStore, useValue: { permissions: signal(permissions) } },
			{ provide: NotificationService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
		],
	});
	const fixture = TestBed.createComponent(CompanyProfileSettings);
	return { fixture, page: fixture.componentInstance };
}
const settle = async (fixture: ReturnType<typeof setup>['fixture']) => {
	for (let i = 0; i < 5; i++) {
		await new Promise((r) => setTimeout(r, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
async function opened(current: CompanyProfile, permissions?: string[]) {
	const harness = setup(current, permissions);
	await settle(harness.fixture);
	return harness;
}

type Fixture = ReturnType<typeof setup>['fixture'];
const el = <T extends HTMLElement = HTMLElement>(fixture: Fixture, selector: string) =>
	fixture.nativeElement.querySelector(selector) as T | null;
const all = <T extends HTMLElement = HTMLElement>(fixture: Fixture, selector: string) =>
	[...fixture.nativeElement.querySelectorAll(selector)] as T[];
const enter = async (fixture: Fixture, control: Element | null | undefined, value: string) => {
	const box = control as HTMLInputElement;
	box.value = value;
	box.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
	await settle(fixture);
};
const basis = (fixture: Fixture) => all<HTMLSelectElement>(fixture, 'select[aria-label="co_remuneration_basis"]');

describe('the partners’ deed on Settings › Company (YC2)', () => {
	it('shows the deed’s date, its terms per partner, interest basis and the loss-year switch', async () => {
		const { fixture } = await opened(firm());
		const from = el<HTMLInputElement>(fixture, '#co_deed_from');
		expect([from?.value, from?.disabled]).toEqual(['2025-04-01', false]);
		expect(el(fixture, '#co_new_deed_on')).not.toBeNull();
		expect(el<HTMLButtonElement>(fixture, '#co_new_deed_start')?.disabled).toBe(true);
		expect(basis(fixture).map((select) => [select.value, select.disabled])).toEqual([
			['monthly', false],
			['percent_of_book_profit', false],
			['none', true],
		]);
		expect(all(fixture, 'input[aria-label="co_pay_month"]')).toHaveLength(1);
		expect(
			all<HTMLInputElement>(fixture, 'input[aria-label="co_remuneration_percent"]').map((i) => i.value),
		).toEqual(['5']);
		expect(el<HTMLSelectElement>(fixture, '#co_interest_basis')?.value).toBe('daily');
		expect(el<HTMLInputElement>(fixture, '#co_loss_year')?.checked).toBe(false);
		expect(fixture.nativeElement.textContent).not.toContain('co_earlier_deeds');
		expect(fixture.nativeElement.textContent).toContain('co_remuneration_col');
	});

	it('sets remuneration as a monthly sum, a % of book profit or none, and each figure', async () => {
		const { fixture, page } = await opened(firm());
		await enter(fixture, all(fixture, 'input[aria-label="co_pay_month"]')[0], '30000');
		expect(page.form()?.partners[0]?.monthlyRemunerationINR).toBe(30_000);
		await enter(fixture, all(fixture, 'input[aria-label="co_remuneration_percent"]')[0], '7.5');
		expect(page.form()?.partners[1]?.remunerationPercent).toBe(7.5);
		await enter(fixture, basis(fixture)[0], 'percent_of_book_profit');
		expect(page.form()?.partners[0]?.remunerationBasis).toBe('percent_of_book_profit');
		expect(all(fixture, 'input[aria-label="co_pay_month"]')).toHaveLength(0);
		expect(all(fixture, 'input[aria-label="co_remuneration_percent"]')).toHaveLength(2);
		await enter(fixture, basis(fixture)[1], 'none');
		expect(all(fixture, 'input[aria-label="co_remuneration_percent"]')).toHaveLength(1);
	});

	it('changes the deed’s date, clears it to the start of the books, and sets interest and loss years', async () => {
		const { fixture, page } = await opened(firm());
		await enter(fixture, el(fixture, '#co_deed_from'), '2025-05-01');
		expect(page.form()?.deedFrom).toBe('2025-05-01');
		await enter(fixture, el(fixture, '#co_deed_from'), '');
		expect(page.form()?.deedFrom).toBeNull();
		await enter(fixture, el(fixture, '#co_interest_basis'), 'opening');
		expect(page.form()?.interestBasis).toBe('opening');
		el<HTMLInputElement>(fixture, '#co_loss_year')?.click();
		await settle(fixture);
		expect(page.form()?.lossYearCharges).toBe(true);
	});

	it('starts a new deed only on a day after the one in force, keeping today’s terms as an earlier deed', async () => {
		const { fixture, page } = await opened(firm());
		const start = () => el<HTMLButtonElement>(fixture, '#co_new_deed_start') as HTMLButtonElement;
		await enter(fixture, el(fixture, '#co_new_deed_on'), '2025-03-01');
		expect(start().disabled).toBe(true);
		page.startNewDeed();
		expect(page.form()?.earlierDeeds).toEqual([]);
		await enter(fixture, el(fixture, '#co_new_deed_on'), '2025-04-01');
		expect(start().disabled).toBe(true);
		page.startNewDeed();
		expect(page.form()?.deedFrom).toBe('2025-04-01');
		await enter(fixture, el(fixture, '#co_new_deed_on'), '2026-01-01');
		expect(start().disabled).toBe(false);
		start().click();
		await settle(fixture);
		expect(page.form()?.deedFrom).toBe('2026-01-01');
		expect(page.newDeedOn()).toBe('');
		const [kept] = page.form()?.earlierDeeds ?? [];
		expect(kept).toEqual({
			from: '2025-04-01',
			to: '2025-12-31',
			interestBasis: 'daily',
			lossYearCharges: false,
			partners: [ARINDAM, RUPA, SLEEPING].map((p) => ({
				id: p.id,
				name: p.name,
				working: p.working,
				profitSharePercent: p.profitSharePercent,
				interestOnCapitalPercent: p.interestOnCapitalPercent,
				monthlyRemunerationINR: p.monthlyRemunerationINR,
				remunerationBasis: p.remunerationBasis,
				remunerationPercent: p.remunerationPercent,
			})),
		});
		expect(el<HTMLInputElement>(fixture, '#co_deed_from')?.disabled).toBe(true);
		expect(all(fixture, 'ul.small li').map((li) => li.textContent?.trim())).toEqual(['co_earlier_deed_line']);
		expect(fixture.nativeElement.textContent).toContain('co_earlier_deeds');
	});

	it('keeps a deed with no start date as ruling from the start, and starts nothing without a day', async () => {
		const { page } = await opened(firm({ deedFrom: null, earlierDeeds: [] }));
		page.startNewDeed();
		expect(page.form()?.earlierDeeds).toEqual([]);
		page.newDeedOn.set('2025-06-01');
		page.startNewDeed();
		expect(page.form()?.earlierDeeds.map((d) => [d.from, d.to])).toEqual([[null, '2025-05-31']]);
		expect(page.form()?.deedFrom).toBe('2025-06-01');
	});

	it('lists earlier deeds with each partner’s share, and starts nothing before the profile is read', async () => {
		const { fixture, page } = await opened(firm({ earlierDeeds: [EARLIER] }));
		expect(all(fixture, 'ul.small li')).toHaveLength(1);
		expect(el<HTMLInputElement>(fixture, '#co_deed_from')?.disabled).toBe(true);
		expect(page.deedShares(EARLIER)).toBe('Arindam 50% · Rupa 50%');
		expect(page.deedShares({ ...EARLIER, partners: [] })).toBe('');
		const unread = setup(null);
		unread.page.newDeedOn.set('2026-01-01');
		unread.page.startNewDeed();
		expect(unread.page.form()).toBeNull();
	});

	it('is read-only without company.edit: no new deed, and every deed field off', async () => {
		const { fixture } = await opened(firm(), ['setting.index']);
		expect(el(fixture, '#co_new_deed_on')).toBeNull();
		expect(el<HTMLInputElement>(fixture, '#co_deed_from')?.disabled).toBe(true);
		expect(el<HTMLSelectElement>(fixture, '#co_interest_basis')?.disabled).toBe(true);
		expect(el<HTMLInputElement>(fixture, '#co_loss_year')?.disabled).toBe(true);
		expect(basis(fixture).every((select) => select.disabled)).toBe(true);
	});

	it('shows the same deed fields for an LLP, and a new partner is paid monthly from 0%', async () => {
		const { fixture, page } = await opened(firm({ kind: 'llp', partners: [] }));
		expect(el(fixture, '#co_deed_from')).not.toBeNull();
		page.addPartner();
		expect(page.form()?.partners[0]).toMatchObject({ remunerationBasis: 'monthly', remunerationPercent: 0 });
		await settle(fixture);
		expect(basis(fixture).map((select) => select.value)).toEqual(['monthly']);
	});
});
