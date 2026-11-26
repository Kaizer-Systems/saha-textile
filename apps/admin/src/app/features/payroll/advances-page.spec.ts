import { ApplicationRef, TemplateRef, signal, type EmbeddedViewRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { PayrollGateway } from '@core/accounts/payroll.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { AdvancesPage, advanceState } from './advances-page';

/** Advances and loans (accounts brief S9). */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const refusal = (code: string) => ({ error: { message: code } });

const SCHEDULE = {
	employeeId: 'e1',
	name: 'Asha Das',
	perMonthPaise: 100_000,
	leftPaise: 300_000,
	given: [
		{ id: 'a1', amountPaise: 400_000, givenOn: '2026-09-05' },
		{ id: 'a2', amountPaise: 100_000, givenOn: '2026-10-05' },
	],
	rows: [
		{ month: '2026-09', givenPaise: 400_000, recoveredPaise: 0, leftPaise: 400_000, how: 'none' },
		{ month: '2026-10', givenPaise: 100_000, recoveredPaise: 100_000, leftPaise: 400_000, how: 'payroll' },
		{ month: '2026-12', givenPaise: 0, recoveredPaise: 100_000, leftPaise: 200_000, how: 'planned' },
	],
};
const LIST = [SCHEDULE, { ...SCHEDULE, employeeId: 'e2', name: 'Rafiq Ali', leftPaise: 0 }];
const EMPLOYEES = [
	{ id: 'e1', name: 'Asha Das', leftOn: null, version: 7 },
	{ id: 'e3', name: 'Left Already', leftOn: '2026-06-30', version: 1 },
];
const at = '2026-01-01T00:00:00.000Z';
const CHART = {
	groups: [{ id: 'g_bank', systemKey: 'bank_accounts', parentId: null, name: 'Bank', createdAt: at, updatedAt: at }],
	ledgers: [{ id: 'hdfc', name: 'HDFC current', groupId: 'g_bank' }],
};

interface Opened {
	close: ReturnType<typeof vi.fn>;
	dismiss: ReturnType<typeof vi.fn>;
	view: EmbeddedViewRef<unknown>;
}

function mount(gateway: Record<string, unknown> = {}, options: { employeeId?: string; permissions?: string[] } = {}) {
	TestBed.resetTestingModule();
	document.body.querySelectorAll('.adv-test-modal').forEach((node) => node.remove());
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const invalidate = vi.spyOn(queries, 'invalidateQueries');
	const opened: Opened[] = [];
	const calls = {
		advances: vi.fn(() => of(LIST)),
		advance: vi.fn(() => of(SCHEDULE)),
		employees: vi.fn(() => of(EMPLOYEES)),
		giveAdvance: vi.fn(() => of(SCHEDULE)),
		...gateway,
	};
	TestBed.configureTestingModule({
		imports: [
			AdvancesPage,
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
			{ provide: LedgerGateway, useValue: { chart: vi.fn(() => of(CHART)) } },
			{ provide: NotificationService, useValue: notifier },
			{
				provide: AuthStore,
				useValue: { permissions: signal(options.permissions ?? ['accounts.index', 'accounts.post']) },
			},
			{
				provide: ActivatedRoute,
				useValue: {
					paramMap: of(convertToParamMap(options.employeeId ? { employeeId: options.employeeId } : {})),
				},
			},
			{
				provide: NgbModal,
				useValue: {
					open: vi.fn((content: TemplateRef<unknown>) => {
						const ref = { close: vi.fn(), dismiss: vi.fn() };
						const view = content.createEmbeddedView({ $implicit: ref });
						TestBed.inject(ApplicationRef).attachView(view);
						view.detectChanges();
						const holder = document.createElement('div');
						holder.className = 'adv-test-modal';
						holder.append(...(view.rootNodes as Node[]));
						document.body.append(holder);
						opened.push({ ...ref, view });
						return ref;
					}),
				},
			},
		],
	});
	const fixture = TestBed.createComponent(AdvancesPage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, notifier, invalidate, opened, calls };
}

async function advances(gateway: Record<string, unknown> = {}, options: Parameters<typeof mount>[1] = {}) {
	const harness = mount(gateway, options);
	await settle(harness.fixture);
	return harness;
}

const all = (fixture: { nativeElement: HTMLElement }, selector: string) =>
	[...fixture.nativeElement.querySelectorAll(selector)] as HTMLElement[];
const modal = (selector: string) => document.querySelector(`.adv-test-modal ${selector}`) as HTMLElement | null;
const enter = (control: HTMLElement | null, value: string) => {
	const box = control as HTMLInputElement;
	box.value = value;
	box.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
};
const giveButton = (fixture: { nativeElement: HTMLElement }) =>
	all(fixture, 'button').find((b) => !b.closest('table')) as HTMLButtonElement | undefined;

describe('an advance’s state', () => {
	it('is being recovered while something is left, and recovered once nothing is', () => {
		expect(advanceState({ leftPaise: 1 })).toBe('recovering');
		expect([advanceState({ leftPaise: 0 }), advanceState({ leftPaise: -5 })]).toEqual(['recovered', 'recovered']);
	});
});

describe('everyone given an advance', () => {
	it('lists each person with a link to their schedule, reading the list and not one person', async () => {
		const { fixture, page, calls } = await advances();
		expect(calls.advances).toHaveBeenCalled();
		expect(calls.advance).not.toHaveBeenCalled();
		expect(all(fixture, 'a[href="/payroll/advances/e1"]')).toHaveLength(1);
		expect(page.given(SCHEDULE as never)).toBe(500_000);
		expect(page.staff().map((e) => e.id)).toEqual(['e1']);
		expect(page.banks()).toEqual([{ id: 'hdfc', name: 'HDFC current' }]);
		expect(page.month('2026-11')).toBe('November 2026');
		expect(page.day('2026-09-05')).toBeTruthy();
	});

	it('says when no one has an advance', async () => {
		const { fixture } = await advances({ advances: vi.fn(() => of([])) });
		expect(fixture.nativeElement.querySelector('tbody td[colspan]')).not.toBeNull();
	});
});

describe('one person’s schedule', () => {
	it('shows each month’s recovery, a dash for months with none, and a way back to everyone', async () => {
		const { fixture, calls } = await advances({}, { employeeId: 'e1' });
		expect(calls.advance).toHaveBeenCalledWith('e1');
		expect(calls.advances).not.toHaveBeenCalled();
		const rows = all(fixture, 'tbody tr');
		expect(rows).toHaveLength(3);
		expect(rows[0]?.textContent).toContain('—');
		expect(rows[1]?.textContent).toContain('payroll_how_payroll');
		expect(rows[2]?.textContent).toContain('payroll_how_planned');
		expect(all(fixture, 'a[href="/payroll/advances"]')).toHaveLength(1);
	});
});

describe('giving an advance', () => {
	it('opens for the person shown, needs whom, from where and how much, and gives it with their version', async () => {
		const { fixture, page, opened, calls, notifier, invalidate } = await advances({}, { employeeId: 'e1' });
		page.patch({ amountINR: 99 });
		(giveButton(fixture) as HTMLButtonElement).click();
		const popup = opened[0] as Opened;
		expect(page.form()).toMatchObject({ employeeId: 'e1', amountINR: 0, ledgerId: '', perMonthINR: 0, note: '' });
		const confirm = [...document.querySelectorAll('.adv-test-modal button')].at(-1) as HTMLButtonElement;
		expect(confirm.disabled).toBe(true);
		expect([...(modal('#adv_emp') as HTMLSelectElement).options].map((o) => o.value)).toContain('e1');
		enter(modal('#adv_amount'), '6000');
		enter(modal('#adv_on'), '2026-11-20');
		enter(modal('#adv_from'), 'hdfc');
		enter(modal('#adv_month'), '1000');
		enter(modal('#adv_note'), 'Festival advance');
		popup.view.detectChanges();
		expect(confirm.disabled).toBe(false);
		confirm.click();
		await settle(fixture);
		expect(calls.giveAdvance).toHaveBeenCalledWith('e1', {
			amountINR: 6_000,
			givenOn: '2026-11-20',
			ledgerId: 'hdfc',
			perMonthINR: 1_000,
			note: 'Festival advance',
			version: 7,
		});
		expect(notifier.showSuccess).toHaveBeenCalledWith('payroll_advance_given');
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['payroll'] });
		expect(popup.close).toHaveBeenCalled();
		(modal('.btn-close') as HTMLButtonElement).click();
		expect(popup.dismiss).toHaveBeenCalled();
	});

	it('picks the person in the list view, sends version 0 for someone unknown, and names a refusal', async () => {
		const giveAdvance = vi
			.fn()
			.mockReturnValueOnce(throwError(() => refusal('payroll_advance_too_large')))
			.mockReturnValueOnce(of(SCHEDULE));
		const { fixture, page, opened, notifier } = await advances({ giveAdvance });
		(giveButton(fixture) as HTMLButtonElement).click();
		expect(page.form().employeeId).toBe('');
		enter(modal('#adv_emp'), 'e1');
		expect(page.form().employeeId).toBe('e1');
		page.patch({ employeeId: 'e9', amountINR: 100, ledgerId: 'hdfc' });
		await page.give();
		expect(notifier.showError).toHaveBeenCalledWith('payroll_problem_payroll_advance_too_large');
		expect(opened[0]?.close).not.toHaveBeenCalled();
		await page.give();
		expect(giveAdvance).toHaveBeenLastCalledWith('e9', expect.objectContaining({ version: 0 }));
		expect(page.busy()).toBe(false);
	});

	it('gives with no pop-up open, and offers no Give to someone who may not post', async () => {
		const { page, notifier } = await advances();
		page.patch({ employeeId: 'e1', amountINR: 100, ledgerId: 'hdfc' });
		await page.give();
		expect(notifier.showSuccess).toHaveBeenCalledWith('payroll_advance_given');
		const reader = await advances({}, { permissions: ['accounts.index'] });
		expect(giveButton(reader.fixture)).toBeUndefined();
	});

	it('has no banks or staff before the chart and people are read', () => {
		const { page } = mount({ employees: vi.fn(() => of()) });
		expect([page.banks(), page.staff()]).toEqual([[], []]);
	});
});
