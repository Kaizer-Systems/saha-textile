import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { YearCloseGateway } from '@core/accounts/year-close.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { rupees } from '@features/accounts/ledger-helpers';

import { YearClosePage } from './year-close-page';

/** Where the year's profit goes (brief 25 YC1, YC3): the choice, a firm's sharing, and what posting makes. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const ALL = ['accounts.index', 'accounts.post', 'accounts.lock'];

const choice = (option: string, over: Record<string, unknown> = {}) => ({
	option,
	reserveBasis: 'percent',
	reserveValue: 0,
	...over,
});
const partner = (partnerId: string, name: string, sharePercent: number, over: Record<string, unknown> = {}) => ({
	partnerId,
	name,
	sharePercent,
	interestPaise: 0,
	interestAllowedPaise: 0,
	remunerationPaise: 0,
	sharePaise: 0,
	totalPaise: 0,
	tdsPaise: 0,
	...over,
});
const line = (ledgerName: string, debitPaise: number, creditPaise: number, narration: string) => ({
	ledgerName,
	debitPaise,
	creditPaise,
	narration,
});
const plan = (over: Record<string, unknown> = {}) => ({
	option: 'deed',
	profitPaise: 0,
	rows: [],
	bookProfitPaise: null,
	remunerationLimitPaise: null,
	remunerationDisallowedPaise: 0,
	interestDisallowedPaise: 0,
	chargesApplied: true,
	drawingsPaise: 0,
	capitalAfterPaise: null,
	reservePaise: 0,
	lines: [],
	problems: [],
	...over,
});
const year = (over: Record<string, unknown> = {}) => ({
	year: '2025-26',
	from: '2025-04-01',
	to: '2026-03-31',
	kind: 'partnership',
	profitChoice: choice('deed'),
	profitChoices: ['keep', 'deed', 'ratio_only'],
	profitPlan: null,
	profitVoucherId: null,
	checks: [{ key: 'cash', state: 'ok', count: 0, of: null, amountPaise: null }],
	done: 1,
	canPostClosing: true,
	canClose: false,
	closingVoucherId: null,
	profitPaise: 0,
	suspenseNote: null,
	accrualsConfirmedAt: null,
	closedAt: null,
	closedBy: null,
	...over,
});

/** A firm sharing ₹10 lakh as the deed says, with every note the plan can carry. */
const ARINDAM = partner('p1', 'Arindam', 60, {
	interestPaise: 12_000_00,
	remunerationPaise: 3_00_000_00,
	sharePaise: 3_70_800_00,
	totalPaise: 6_82_800_00,
	tdsPaise: 31_200_00,
});
const RUPA = partner('p2', 'Rupa', 40, {
	interestPaise: 8_000_00,
	remunerationPaise: 0,
	sharePaise: 2_47_200_00,
	totalPaise: 2_55_200_00,
	tdsPaise: 0,
});
const FIRM = year({
	profitPaise: 10_00_000_00,
	profitPlan: plan({
		profitPaise: 10_00_000_00,
		rows: [ARINDAM, RUPA],
		bookProfitPaise: 9_80_000_00,
		remunerationLimitPaise: 7_38_000_00,
		remunerationDisallowedPaise: 0,
		interestDisallowedPaise: 1_000_00,
		chargesApplied: true,
		lines: [
			line('Profit and loss account', 10_00_000_00, 0, 'The year’s profit shared'),
			line('Arindam current account', 0, 6_82_800_00, 'Interest, remuneration and share'),
		],
		problems: ['partner_shares_total_100'],
	}),
});
/** A company keeping 10% of its profit to general reserve. */
const COMPANY = year({
	kind: 'private_limited',
	profitChoice: choice('to_general_reserve', { reserveValue: 10 }),
	profitChoices: ['keep', 'to_general_reserve'],
	profitPlan: plan({ option: 'to_general_reserve', profitPaise: 5_00_000_00, reservePaise: 50_000_00 }),
});

function mount(view: unknown, gateway: Record<string, unknown> = {}, permissions = ALL) {
	TestBed.resetTestingModule();
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const calls = {
		view: vi.fn(() => of(view)),
		confirm: vi.fn(() => of(view)),
		postClosing: vi.fn(() => of(view)),
		close: vi.fn(() => of(view)),
		...gateway,
	};
	TestBed.configureTestingModule({
		imports: [
			YearClosePage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			provideRouter([]),
			{ provide: YearCloseGateway, useValue: calls },
			{ provide: NotificationService, useValue: notifier },
			{ provide: AuthStore, useValue: { permissions: signal(permissions) } },
			{ provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({ year: '2025-26' })) } },
		],
	});
	vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
	const fixture = TestBed.createComponent(YearClosePage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, notifier, calls };
}

async function opened(view: unknown, gateway: Record<string, unknown> = {}, permissions = ALL) {
	const harness = mount(view, gateway, permissions);
	await settle(harness.fixture);
	return harness;
}

interface Fixture {
	nativeElement: HTMLElement;
}
const card = (fixture: Fixture) => fixture.nativeElement.querySelector('#yc_profit') as HTMLElement;
const el = <T extends HTMLElement = HTMLElement>(fixture: Fixture, selector: string) =>
	fixture.nativeElement.querySelector(selector) as T | null;
const radios = (fixture: Fixture) => [...card(fixture).querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
const notes = (fixture: Fixture) =>
	[...card(fixture).querySelectorAll('.card-body > small.d-block')].map((note) => note.textContent?.trim() ?? '');
const tables = (fixture: Fixture) => [...card(fixture).querySelectorAll('table')] as HTMLTableElement[];
const cells = (row: Element | null | undefined) =>
	[...(row?.querySelectorAll('th, td') ?? [])].map((cell) => cell.textContent?.trim() ?? '');
const enter = (control: Element | null, value: string) => {
	const box = control as HTMLInputElement;
	box.value = value;
	box.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
};

describe('a firm’s profit shared as the deed says (YC1, YC3)', () => {
	it('offers the kind’s choices with the saved one picked, and nothing to save yet', async () => {
		const { fixture, page } = await opened(FIRM);
		expect(card(fixture).querySelector('h5')?.textContent).toContain('year_close_profit_title');
		expect(card(fixture).querySelector('h5')?.textContent).toContain('co_kind_partnership');
		expect(radios(fixture).map((radio) => [radio.id, radio.checked, radio.disabled])).toEqual([
			['yc_choice_keep', false, false],
			['yc_choice_deed', true, false],
			['yc_choice_ratio_only', false, false],
		]);
		expect(card(fixture).querySelector('label[for="yc_choice_deed"]')?.textContent).toContain(
			'year_close_choice_deed_help',
		);
		expect(el(fixture, '#yc_reserve_basis')).toBeNull();
		expect(el<HTMLButtonElement>(fixture, '#yc_choice_save')?.disabled).toBe(true);
		expect(page.dirty()).toBe(false);
		expect(notes(fixture)).not.toContain('year_close_choice_unsaved');
	});

	it('draws each partner’s interest, remuneration, share, total and TDS, with a total for each part', async () => {
		const { fixture, page } = await opened(FIRM);
		const [sharing] = tables(fixture);
		expect(cells(sharing?.querySelector('thead tr'))).toEqual([
			'',
			'Arindam (60%)',
			'Rupa (40%)',
			'year_close_share_total',
		]);
		const rows = [...(sharing?.querySelectorAll('tbody tr') ?? [])];
		expect(cells(rows[0])).toEqual(['year_close_share_profit', '', '', rupees(10_00_000_00)]);
		expect(rows.slice(1).map((row) => cells(row)[0])).toEqual([
			'year_close_share_interestPaise',
			'year_close_share_remunerationPaise',
			'year_close_share_sharePaise',
			'year_close_share_totalPaise',
			'year_close_share_tdsPaise',
		]);
		expect(cells(rows[1])).toEqual([
			'year_close_share_interestPaise',
			rupees(12_000_00),
			rupees(8_000_00),
			rupees(20_000_00),
		]);
		expect(cells(rows[4]).slice(1)).toEqual([rupees(6_82_800_00), rupees(2_55_200_00), rupees(9_38_000_00)]);
		expect(rows.map((row) => row.classList.contains('fw-bold'))).toEqual([false, false, false, false, true, false]);
		expect(page.total([ARINDAM, RUPA], 'tdsPaise')).toBe(31_200_00);
		expect(page.total([], 'sharePaise')).toBe(0);
	});

	it('notes the tax limit on remuneration, interest over 12%, and the plan’s problems', async () => {
		const { fixture } = await opened(FIRM);
		expect(notes(fixture)).toEqual(
			expect.arrayContaining([
				'year_close_share_limit',
				'year_close_share_interest_over',
				'year_close_plan_problem_partner_shares_total_100',
			]),
		);
		expect(card(fixture).querySelector('small.text-danger')?.textContent).toContain(
			'year_close_plan_problem_partner_shares_total_100',
		);
		expect(notes(fixture)).not.toContain('year_close_share_loss_year');
		expect(notes(fixture)).not.toContain('year_close_capital_after');
		expect(notes(fixture)).not.toContain('year_close_reserve_moves');
	});

	it('shows what posting makes, with each line’s debit or credit and its narration', async () => {
		const { fixture } = await opened(FIRM);
		expect(card(fixture).querySelector('h6')?.textContent).toContain('year_close_posts');
		const posts = tables(fixture)[1];
		expect(cells(posts?.querySelector('thead tr'))).toEqual([
			'year_close_posts_ledger',
			'year_close_posts_debit',
			'year_close_posts_credit',
		]);
		const rows = [...(posts?.querySelectorAll('tbody tr') ?? [])];
		expect(rows.map((row) => cells(row).slice(1))).toEqual([
			[rupees(10_00_000_00), ''],
			['', rupees(6_82_800_00)],
		]);
		expect(rows[1]?.querySelector('small')?.textContent).toContain('Interest, remuneration and share');
	});

	it('says a loss year pays no interest or remuneration when the deed says so, without the tax limit', async () => {
		const loss = year({
			profitPlan: plan({
				rows: [partner('p1', 'Arindam', 60), partner('p2', 'Rupa', 40)],
				chargesApplied: false,
				remunerationLimitPaise: 1_50_000_00,
				bookProfitPaise: null,
			}),
		});
		const { fixture } = await opened(loss);
		expect(notes(fixture)).toContain('year_close_share_loss_year');
		expect(notes(fixture)).not.toContain('year_close_share_limit');
		expect(notes(fixture)).not.toContain('year_close_share_interest_over');
		expect(card(fixture).querySelector('h6')).toBeNull();
		expect(tables(fixture)).toHaveLength(1);
	});

	it('has no loss-year note when the profit is shared in the ratio, nor a table when the deed has no partners', async () => {
		const ratio = await opened(
			year({
				profitChoice: choice('ratio_only'),
				profitPlan: plan({
					option: 'ratio_only',
					rows: [partner('p1', 'Arindam', 100)],
					chargesApplied: false,
				}),
			}),
		);
		expect(notes(ratio.fixture)).not.toContain('year_close_share_loss_year');
		expect(tables(ratio.fixture)).toHaveLength(1);
		const empty = await opened(
			year({ profitPlan: plan({ chargesApplied: false, problems: ['partners_missing'] }) }),
		);
		expect(tables(empty.fixture)).toHaveLength(0);
		expect(notes(empty.fixture)).toEqual(['year_close_plan_problem_partners_missing']);
	});
});

describe('a proprietor’s profit to capital (YC1)', () => {
	it('shows the drawings closed into capital and the capital after, with no sharing table', async () => {
		const { fixture } = await opened(
			year({
				kind: 'proprietorship',
				profitChoice: choice('to_capital'),
				profitChoices: ['keep', 'to_capital', 'to_capital_keep_drawings'],
				profitPlan: plan({
					option: 'to_capital',
					profitPaise: 4_00_000_00,
					drawingsPaise: 1_20_000_00,
					capitalAfterPaise: 7_80_000_00,
					lines: [line('Capital account', 0, 4_00_000_00, 'The year’s profit to capital')],
				}),
			}),
		);
		expect(card(fixture).querySelector('h5')?.textContent).toContain('co_kind_proprietorship');
		expect(radios(fixture).map((radio) => radio.checked)).toEqual([false, true, false]);
		expect(notes(fixture)).toEqual(expect.arrayContaining(['year_close_capital_after']));
		expect(notes(fixture)).not.toContain('year_close_share_limit');
		expect(tables(fixture)).toHaveLength(1);
	});

	it('draws only the choices before the books have a plan', async () => {
		const { fixture } = await opened(year({ kind: 'proprietorship', profitPlan: null }));
		expect(card(fixture).querySelector('h5')?.textContent).toContain('year_close_profit_title');
		expect(tables(fixture)).toHaveLength(0);
		expect(notes(fixture)).toEqual([]);
	});
});

describe('a company’s general reserve, and picking and saving a choice (YC1)', () => {
	it('shows the reserve basis and value only for general reserve, and what moves to it', async () => {
		const { fixture, page } = await opened(COMPANY);
		expect(el<HTMLSelectElement>(fixture, '#yc_reserve_basis')?.value).toBe('percent');
		expect(el<HTMLInputElement>(fixture, '#yc_reserve_value')?.value).toBe('10');
		expect(notes(fixture)).toContain('year_close_reserve_moves');
		expect(page.chosen()).toEqual(choice('to_general_reserve', { reserveValue: 10 }));
	});

	it('picking the saved choice again leaves nothing to save', async () => {
		const { fixture, page } = await opened(COMPANY);
		radios(fixture)[1]?.dispatchEvent(new Event('change'));
		fixture.detectChanges();
		expect(page.picked()).toEqual(choice('to_general_reserve', { reserveValue: 10 }));
		expect(page.dirty()).toBe(false);
		expect(el<HTMLButtonElement>(fixture, '#yc_choice_save')?.disabled).toBe(true);
	});

	it('changes the basis and the value, never below nothing, says to save to see, and saves the choice', async () => {
		const { fixture, page, calls, notifier } = await opened(COMPANY);
		enter(el(fixture, '#yc_reserve_basis'), 'amount');
		fixture.detectChanges();
		expect(page.picked()).toEqual(choice('to_general_reserve', { reserveBasis: 'amount', reserveValue: 10 }));
		expect(page.dirty()).toBe(true);
		expect(notes(fixture)).toContain('year_close_choice_unsaved');
		expect(notes(fixture)).not.toContain('year_close_reserve_moves');
		expect(el<HTMLButtonElement>(fixture, '#yc_choice_save')?.disabled).toBe(false);
		enter(el(fixture, '#yc_reserve_value'), '-5');
		fixture.detectChanges();
		expect(page.chosen()?.reserveValue).toBe(0);
		page.setReserve({ reserveValue: 'lots' as unknown as number });
		expect(page.chosen()?.reserveValue).toBe(0);
		enter(el(fixture, '#yc_reserve_value'), '25000');
		fixture.detectChanges();
		expect(page.chosen()).toEqual(choice('to_general_reserve', { reserveBasis: 'amount', reserveValue: 25_000 }));
		el<HTMLButtonElement>(fixture, '#yc_choice_save')?.click();
		await settle(fixture);
		expect(calls.confirm).toHaveBeenCalledWith('2025-26', {
			profitChoice: choice('to_general_reserve', { reserveBasis: 'amount', reserveValue: 25_000 }),
		});
		expect(notifier.showSuccess).toHaveBeenLastCalledWith('year_close_saved');
		expect(page.picked()).toBeNull();
		expect(page.chosen()).toEqual(choice('to_general_reserve', { reserveValue: 10 }));
	});

	it('keeps the reserve figures when another choice is picked, and hides the reserve fields', async () => {
		const { fixture, page } = await opened(COMPANY);
		page.setReserve({ reserveBasis: 'amount', reserveValue: 40_000 });
		radios(fixture)[0]?.click();
		fixture.detectChanges();
		expect(page.picked()).toEqual(choice('keep', { reserveBasis: 'amount', reserveValue: 40_000 }));
		expect(radios(fixture).map((radio) => radio.checked)).toEqual([true, false]);
		expect(el(fixture, '#yc_reserve_basis')).toBeNull();
	});

	it('locks the choice and its reserve fields once the year is closed', async () => {
		const { fixture } = await opened({ ...COMPANY, closedAt: '2026-05-10T06:00:00.000Z' });
		expect(radios(fixture).every((radio) => radio.disabled)).toBe(true);
		expect(el<HTMLButtonElement>(fixture, '#yc_choice_save')?.disabled).toBe(true);
		expect(el<HTMLSelectElement>(fixture, '#yc_reserve_basis')?.disabled).toBe(true);
		expect(el<HTMLInputElement>(fixture, '#yc_reserve_value')?.disabled).toBe(true);
	});

	it('offers Save only to those who may post', async () => {
		const { fixture } = await opened(COMPANY, {}, ['accounts.index']);
		expect(el(fixture, '#yc_choice_save')).toBeNull();
		expect(radios(fixture)).toHaveLength(2);
	});

	it('before the year is read: no choice to change or save, and a pick starts at 0%', async () => {
		const { fixture, page, calls } = mount(year(), { view: vi.fn(() => of()) });
		await settle(fixture);
		expect(page.chosen()).toBeNull();
		page.setReserve({ reserveValue: 5 });
		expect(page.picked()).toBeNull();
		await page.saveChoice();
		expect(calls.confirm).not.toHaveBeenCalled();
		page.pickChoice('keep');
		expect(page.picked()).toEqual(choice('keep'));
		expect(page.dirty()).toBe(false);
	});
});
