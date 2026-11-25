import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { NEVER, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PayrollGateway } from '@core/accounts/payroll.gateway';
import { LocationsGateway } from '@core/locations/locations.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { ExportMenu } from '@shared/ui/export-menu/export-menu';

import { IncrementsPage, STARTING_BANDS, nextCycleStart } from './increments-page';
import { RevisePayPopup } from './revise-pay-popup';

import type { EmployeeView, IncrementRowPreview, IncrementRowsInputValue } from '@saha-textile/contracts';

/**
 * Payroll › Increments (brief 26 SR3): a cycle for many people at once: who, the plan (by rating, the same %, the
 * same amount; saved by name), each row worked out with its checks, the year's cost, and Accept for the rows chosen.
 */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const person = (id: string, name: string, over: Record<string, unknown> = {}) =>
	({
		id,
		name,
		locationId: 'l1',
		department: '',
		joinedOn: '2024-05-01',
		leftOn: null,
		...over,
	}) as unknown as EmployeeView;
const STAFF = [
	person('e1', 'Asha Das', { department: 'Sales' }),
	person('e2', 'Rafiq Ali', { locationId: 'l2', department: 'Stores', joinedOn: '2025-11-01' }),
	person('e3', 'Mitali Sen', { joinedOn: '2023-01-01' }),
	person('e4', 'Gone Ghosh', { department: 'Accounts', leftOn: '2026-06-30' }),
];
const ROWS: Record<string, Omit<IncrementRowPreview, 'employeeId'>> = {
	e1: { ctcYearNowINR: 300_000, ctcYearNewINR: 324_000, changeMonthINR: 2_000, changePct: 8, checks: [] },
	e2: {
		ctcYearNowINR: 150_000,
		ctcYearNewINR: 154_500,
		changeMonthINR: 375,
		changePct: 3,
		checks: [{ code: 'below_minimum_wage', blocking: true, inr: 450 }],
	},
	e3: {
		ctcYearNowINR: 240_000,
		ctcYearNewINR: 252_000,
		changeMonthINR: 1_000,
		changePct: 5,
		checks: [{ code: 'wages_under_half', blocking: false, inr: 0 }],
	},
};
const rowsFor = (input: IncrementRowsInputValue): IncrementRowPreview[] =>
	input.rows.flatMap((r) => (ROWS[r.employeeId] ? [{ employeeId: r.employeeId, ...ROWS[r.employeeId] }] : []));
const PLAN = {
	id: 'p1',
	name: 'FY27 shop',
	kind: 'percent' as const,
	bands: [{ rating: 'X', pct: 9 }],
	pct: 6,
	amountMonthINR: 1_500,
	updatedAt: '2026-11-20T06:00:00.000Z',
};

interface Options {
	permissions?: string[];
	waiting?: boolean;
	gateway?: Record<string, unknown>;
}

async function increments(options: Options = {}) {
	TestBed.resetTestingModule();
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const popups: { content: unknown; options: unknown; start: ReturnType<typeof vi.fn> }[] = [];
	const gateway = {
		employees: vi.fn(() => of(STAFF)),
		incrementPlans: vi.fn(() => of([PLAN])),
		incrementsPreview: vi.fn((input: IncrementRowsInputValue) => of(rowsFor(input))),
		saveIncrementPlan: vi.fn(() => of(PLAN)),
		acceptIncrements: vi.fn((input: IncrementRowsInputValue) =>
			of(input.rows.map((r) => ({ employeeId: r.employeeId, ok: true, problem: null }))),
		),
		...options.gateway,
	};
	TestBed.configureTestingModule({
		imports: [
			IncrementsPage,
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
					list: vi.fn(() =>
						of([
							{ id: 'l1', name: 'Barasat', active: true },
							{ id: 'l2', name: 'Sodepur', active: true },
						]),
					),
				},
			},
			{ provide: NotificationService, useValue: notifier },
			{
				provide: AuthStore,
				useValue: { permissions: signal(options.permissions ?? ['accounts.index', 'accounts.edit']) },
			},
			{
				provide: NgbModal,
				useValue: {
					open: vi.fn((content: unknown, opened: unknown) => {
						const start = vi.fn();
						popups.push({ content, options: opened, start });
						return { componentInstance: { start } };
					}),
				},
			},
		],
	});
	TestBed.overrideComponent(IncrementsPage, {
		remove: { imports: [ExportMenu] },
		add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
	});
	const fixture = TestBed.createComponent(IncrementsPage);
	fixture.detectChanges();
	// A preview that never answers keeps the page from going stable: wait a few turns instead.
	const wait = options.waiting
		? async () => {
				for (let i = 0; i < 4; i++) {
					await new Promise((resolve) => setTimeout(resolve, 0));
					fixture.detectChanges();
				}
			}
		: () => settle(fixture);
	await wait();
	const find = <T extends HTMLElement = HTMLInputElement>(selector: string) =>
		fixture.nativeElement.querySelector(selector) as T | null;
	const enter = async (box: Element | null, value: string) => {
		(box as HTMLInputElement).value = value;
		box?.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
		await wait();
	};
	const lastInput = () => (gateway.incrementsPreview.mock.lastCall as unknown as [IncrementRowsInputValue])[0];
	return {
		fixture,
		page: fixture.componentInstance,
		gateway,
		notifier,
		popups,
		find,
		enter,
		lastInput,
		settle: wait,
	};
}

const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim();
const values = (select: HTMLSelectElement | null) => [...(select?.options ?? [])].map((o) => o.value);

describe('the start of the next cycle', () => {
	it('is 1 April of the coming financial year in India', () => {
		expect(nextCycleStart(new Date('2026-11-26T06:00:00.000Z'))).toBe('2027-04-01');
		expect(nextCycleStart(new Date('2027-03-10T06:00:00.000Z'))).toBe('2027-04-01');
		// 31 March, 19:00 UTC is already 1 April in India: the next cycle is a year on.
		expect(nextCycleStart(new Date('2027-03-31T19:00:00.000Z'))).toBe('2028-04-01');
		expect(STARTING_BANDS.map((b) => `${b.rating} ${b.pct}`)).toEqual(['A+ 12', 'A 8', 'B 3', 'C 0']);
	});
});

describe('Payroll › Increments (SR3)', () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-26T06:00:00.000Z'));
	});
	afterEach(() => vi.useRealTimers());

	it('takes everyone still employed from next April, rated A by default, and works each row out', async () => {
		const { page, find, lastInput } = await increments();
		expect([page.from(), page.people().map((e) => e.id)]).toEqual(['2027-04-01', ['e1', 'e2', 'e3']]);
		expect(text(find('small.text-muted'))).toBe('inc_sub');
		expect(lastInput()).toEqual({
			from: '2027-04-01',
			reason: 'Increment cycle',
			rows: ['e1', 'e2', 'e3'].map((employeeId) => ({
				employeeId,
				way: { kind: 'percent', pct: 8 },
				rating: 'A',
			})),
		});
		const rows = [...(find('tbody')?.querySelectorAll('tr') ?? [])] as HTMLElement[];
		expect(rows.map((tr) => [...tr.querySelectorAll('td')].slice(1, 8).map((td) => text(td)))).toEqual([
			['Asha Das', 'A+ABC', '3,00,000', '', '3,24,000', '2,000', '✓'],
			['Rafiq Ali', 'A+ABC', '1,50,000', '', '1,54,500', '375', 'rev_check_below_minimum_wage'],
			['Mitali Sen', 'A+ABC', '2,40,000', '', '2,52,000', '1,000', 'rev_check_wages_under_half'],
		]);
		expect(find<HTMLSelectElement>('#inc_rating_e1')?.value).toBe('A');
		expect(find<HTMLInputElement>('#inc_pct_e1')?.value).toBe('8');
		expect(rows[1]?.querySelector('.badge')?.classList.contains('bg-danger')).toBe(true);
		expect(rows[2]?.querySelector('.badge')?.classList.contains('bg-warning')).toBe(true);
	});

	it('narrows the cycle by store, department and joining date', async () => {
		const { page, find, enter } = await increments();
		expect(values(find('#inc_store'))).toEqual(['', 'l1', 'l2']);
		expect(values(find('#inc_department'))).toEqual(['', 'Accounts', 'Sales', 'Stores']);
		await enter(find('#inc_store'), 'l1');
		expect(page.people().map((e) => e.id)).toEqual(['e1', 'e3']);
		await enter(find('#inc_department'), 'Sales');
		expect(page.people().map((e) => e.id)).toEqual(['e1']);
		await enter(find('#inc_department'), '');
		await enter(find('#inc_joined'), '2024-01-01');
		expect(page.people().map((e) => e.id)).toEqual(['e3']);
		await enter(find('#inc_store'), 'l2');
		expect(page.people()).toEqual([]);
		expect(text(find('td[colspan="9"]'))).toBe('payroll_no_employees');
	});

	it('works nothing out with no one in the cycle or no whole day, and shows dots until a row is worked out', async () => {
		const { page, gateway, find, fixture } = await increments({
			waiting: true,
			gateway: { incrementsPreview: vi.fn(() => NEVER) },
		});
		expect([page.rowOf('e1'), page.blocked('e1'), page.selected('e1')]).toEqual([null, false, true]);
		expect(text(find('tbody tr td:nth-child(4)'))).toBe('…');
		expect(text(find('tbody tr td:nth-child(8)'))).toBe('');
		expect(text(find('#inc_year_cost'))).toBe('0');
		const calls = gateway.incrementsPreview.mock.calls.length;
		page.from.set('');
		fixture.detectChanges();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(gateway.incrementsPreview.mock.calls.length).toBe(calls);
		page.from.set('2027-04-01');
		page.store.set('l9');
		fixture.detectChanges();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(gateway.incrementsPreview.mock.calls.length).toBe(calls);
	});

	it('rates each person, a typed % over their band, and the rating cleared of it when changed', async () => {
		const { page, find, enter, lastInput } = await increments();
		const asha = STAFF[0] as EmployeeView;
		expect(values(find('#inc_rating_e1'))).toEqual(['A+', 'A', 'B', 'C']);
		await enter(find('#inc_rating_e1'), 'A+');
		expect([page.ratingOf(asha), page.pctOf(asha)]).toEqual(['A+', 12]);
		await enter(find('#inc_pct_e1'), '10');
		expect(lastInput().rows[0]).toEqual({ employeeId: 'e1', way: { kind: 'percent', pct: 10 }, rating: 'A+' });
		page.setPct('e3', 'lots');
		expect(page.typedPct()).toEqual({ e1: 10, e3: 0 });
		await enter(find('#inc_rating_e1'), 'B');
		expect([page.typedPct(), page.pctOf(asha)]).toEqual([{ e3: 0 }, 3]);
		// A rating no band has any more gives nothing.
		page.ratings.set({ e1: 'Z' });
		expect(page.pctOf(asha)).toBe(0);
	});

	it('edits the rating bands, and rates from what is left: the second band, else the first, else none', async () => {
		const { page, find, enter, settle, lastInput } = await increments();
		const mitali = STAFF[2] as EmployeeView;
		await enter(find('#inc_band_rating_0'), 'S');
		await enter(find('#inc_band_pct_0'), '15');
		find<HTMLButtonElement>('#inc_band_add')?.click();
		await settle();
		expect(page.bands()).toEqual([
			{ rating: 'S', pct: 15 },
			{ rating: 'A', pct: 8 },
			{ rating: 'B', pct: 3 },
			{ rating: 'C', pct: 0 },
			{ rating: 'R5', pct: 0 },
		]);
		expect(find('#inc_band_remove_0')?.title).toBe('remove');
		for (let i = 0; i < 3; i++) {
			find<HTMLButtonElement>('#inc_band_remove_1')?.click();
			await settle();
		}
		expect([page.bands().map((b) => b.rating), page.ratingOf(mitali)]).toEqual([['S', 'R5'], 'R5']);
		find<HTMLButtonElement>('#inc_band_remove_1')?.click();
		await settle();
		expect([page.ratingOf(mitali), page.pctOf(mitali)]).toEqual(['S', 15]);
		find<HTMLButtonElement>('#inc_band_remove_0')?.click();
		await settle();
		expect([page.ratingOf(mitali), page.pctOf(mitali)]).toEqual(['', 0]);
		expect(lastInput().rows[0]?.rating).toBeNull();
	});

	it('gives everyone the same % or the same amount, a % typed for one person going by % instead', async () => {
		const { page, find, enter, lastInput } = await increments();
		await enter(find('#inc_kind'), 'percent');
		expect([find('#inc_band_add'), find('#inc_amount'), find('#inc_rating_e1')]).toEqual([null, null, null]);
		expect(text(find('tbody tr td:nth-child(3)'))).toBe('—');
		await enter(find('#inc_pct'), '6');
		expect(lastInput().rows.map((r) => r.way)).toEqual([
			{ kind: 'percent', pct: 6 },
			{ kind: 'percent', pct: 6 },
			{ kind: 'percent', pct: 6 },
		]);
		await enter(find('#inc_kind'), 'amount');
		expect(find('#inc_pct')).toBeNull();
		await enter(find('#inc_amount'), '1500');
		expect(lastInput().rows[0]?.way).toEqual({ kind: 'amount', monthINR: 1_500 });
		// The % box shows what the amount comes to.
		expect(find<HTMLInputElement>('#inc_pct_e1')?.value).toBe('8');
		await enter(find('#inc_pct_e1'), '9');
		expect(lastInput().rows.map((r) => r.way)).toEqual([
			{ kind: 'percent', pct: 9 },
			{ kind: 'amount', monthINR: 1_500 },
			{ kind: 'amount', monthINR: 1_500 },
		]);
		expect(page.pctOf(STAFF[1] as EmployeeView)).toBe(6);
	});

	it('shows a nought for a row’s % on an amount until it is worked out', async () => {
		const { find, enter } = await increments({ waiting: true, gateway: { incrementsPreview: vi.fn(() => NEVER) } });
		await enter(find('#inc_kind'), 'amount');
		expect(find<HTMLInputElement>('#inc_pct_e1')?.value).toBe('0');
	});

	it('leaves a row with a blocking check out, any other by hand, and counts the year’s cost of those chosen', async () => {
		const { page, find, settle } = await increments();
		const pick = (id: string) => find<HTMLInputElement>(`#inc_pick_${id}`) as HTMLInputElement;
		expect([pick('e1').checked, pick('e2').checked, pick('e2').disabled, pick('e3').checked]).toEqual([
			true,
			false,
			true,
			true,
		]);
		expect([page.chosen().map((e) => e.id), page.yearCost()]).toEqual([['e1', 'e3'], 36_000]);
		expect(text(find('#inc_year_cost'))).toBe('36,000');
		pick('e1').click();
		await settle();
		expect([page.chosen().map((e) => e.id), page.yearCost(), pick('e1').checked]).toEqual([['e3'], 12_000, false]);
		expect(text(find('#inc_accept'))).toBe('inc_accept');
		pick('e1').click();
		await settle();
		expect(page.selected('e1')).toBe(true);
	});

	it('reuses a saved plan, and saves the plan on screen by name', async () => {
		const { page, gateway, notifier, find, enter } = await increments();
		expect(values(find('#inc_plan_pick'))).toEqual(['', 'p1']);
		await enter(find('#inc_plan_pick'), 'p1');
		expect([page.planName(), page.kind(), page.bands(), page.pct(), page.amountMonth()]).toEqual([
			'FY27 shop',
			'percent',
			[{ rating: 'X', pct: 9 }],
			6,
			1_500,
		]);
		expect(page.bands()[0]).not.toBe(PLAN.bands[0]);
		page.usePlan('gone');
		expect(page.planName()).toBe('FY27 shop');
		const save = find<HTMLButtonElement>('#inc_plan_save') as HTMLButtonElement;
		await enter(find('#inc_plan_name'), ' F ');
		expect(save.disabled).toBe(true);
		await enter(find('#inc_plan_name'), '  FY28 shop  ');
		expect(save.disabled).toBe(false);
		save.click();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(gateway.saveIncrementPlan).toHaveBeenCalledWith({
			name: 'FY28 shop',
			kind: 'percent',
			bands: [{ rating: 'X', pct: 9 }],
			pct: 6,
			amountMonthINR: 1_500,
		});
		expect(notifier.showSuccess).toHaveBeenCalledWith('inc_plan_saved');
		gateway.saveIncrementPlan.mockReturnValueOnce(
			throwError(() => ({ error: { message: 'increment_rating_twice' } })),
		);
		await page.savePlan();
		expect(notifier.showError).toHaveBeenCalledWith('payroll_problem_increment_rating_twice');
	});

	it('opens a person’s own Revise pay from their row', async () => {
		const { find, popups } = await increments();
		const eye = find<HTMLButtonElement>('#inc_open_e3') as HTMLButtonElement;
		expect(eye.title).toBe('payroll_revise_pay');
		eye.click();
		expect(popups).toEqual([
			{ content: RevisePayPopup, options: { centered: true, size: 'xl' }, start: expect.any(Function) },
		]);
		expect(popups[0]?.start).toHaveBeenCalledWith(STAFF[2]);
	});

	it('accepts the rows chosen with the reason typed, counting those saved and naming each refused', async () => {
		const { page, gateway, notifier, find, enter } = await increments({
			gateway: {
				acceptIncrements: vi.fn(() =>
					of([
						{ employeeId: 'e1', ok: true, problem: null },
						{ employeeId: 'e3', ok: false, problem: 'revision_before_last' },
						{ employeeId: 'e9', ok: false, problem: null },
					]),
				),
			},
		});
		const accept = find<HTMLButtonElement>('#inc_accept') as HTMLButtonElement;
		expect(accept.disabled).toBe(true);
		await enter(find('#inc_why'), '  FY27 cycle  ');
		expect(accept.disabled).toBe(false);
		accept.click();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(gateway.acceptIncrements).toHaveBeenCalledWith({
			from: '2027-04-01',
			reason: 'FY27 cycle',
			rows: [
				{ employeeId: 'e1', way: { kind: 'percent', pct: 8 }, rating: 'A' },
				{ employeeId: 'e3', way: { kind: 'percent', pct: 8 }, rating: 'A' },
			],
		});
		expect(notifier.showSuccess).toHaveBeenCalledWith('inc_accepted');
		expect(notifier.showError.mock.calls).toEqual([
			['Mitali Sen: payroll_problem_revision_before_last'],
			['e9: payroll_problem_failed'],
		]);
		expect(page.busy()).toBe(false);
	});

	it('names a refusal of the whole cycle', async () => {
		const { page, notifier } = await increments({
			gateway: {
				acceptIncrements: vi.fn(() => throwError(() => ({ error: { message: 'increments_too_many' } }))),
			},
		});
		page.reason.set('FY27 cycle');
		await page.accept();
		expect(notifier.showError).toHaveBeenCalledWith('payroll_problem_increments_too_many');
		expect(page.busy()).toBe(false);
	});

	it('names each person before the staff list is read by their id', async () => {
		const { page } = await increments({ waiting: true, gateway: { employees: vi.fn(() => NEVER) } });
		expect([page.name('e1'), page.people(), page.departments()]).toEqual(['e1', [], []]);
	});

	it('offers no Accept or plan saving to someone who may not edit', async () => {
		const { find } = await increments({ permissions: ['accounts.index'] });
		expect([find('#inc_accept'), find('#inc_plan_save')]).toEqual([null, null]);
	});

	it('writes the cycle for the Export menu: each row worked out and whether it is chosen', async () => {
		const { page } = await increments({ waiting: true, gateway: { incrementsPreview: vi.fn(() => NEVER) } });
		expect(page.exportSource()?.rows[0]).toEqual(['Asha Das', 'A', null, null, null, null, 'yes']);
		const read = await increments();
		read.page.toggle('e1');
		const source = read.page.exportSource();
		expect(source).toMatchObject({
			fileName: 'increments-2027-04-01',
			title: 'payroll_increments',
			area: 'accounts',
			filters: [{ label: 'rev_from', value: '2027-04-01' }],
			header: [
				'payroll_col_name',
				'inc_rating',
				'inc_ctc_now',
				'%',
				'inc_ctc_new',
				'inc_change_month',
				'inc_selected',
			],
		});
		expect(source?.rows).toEqual([
			['Asha Das', 'A', 300_000, 8, 324_000, 2_000, 'no'],
			['Rafiq Ali', 'A', 150_000, 3, 154_500, 375, 'no'],
			['Mitali Sen', 'A', 240_000, 5, 252_000, 1_000, 'yes'],
		]);
	});
});
