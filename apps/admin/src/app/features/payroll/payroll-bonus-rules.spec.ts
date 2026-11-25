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

import { PayrollRulesPage, ruleRows, toForm, toWrite } from './payroll-rules-page';

import type { BonusRules, PayrollRulesVersion } from '@saha-textile/contracts';

/** The Bonus Act's figures on Settings › Payroll rules (brief 25 BN1): rate, ceiling, eligibility, minimum, when booked. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};

const BONUS: BonusRules = {
	ratePct: 8.33,
	wageCeilingPaise: 7_000_00,
	eligibleUpToPaise: 21_000_00,
	minimumPaise: 100_00,
	provision: 'monthly',
};
const version = (id: string, over: Record<string, unknown> = {}) =>
	({
		id,
		from: '2025-04-01',
		note: '',
		builtIn: true,
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
		bonus: BONUS,
		...over,
	}) as unknown as PayrollRulesVersion;
const WITH_BONUS = version('v4', { bonus: { ...BONUS, ratePct: 20, wageCeilingPaise: 10_000_00 } });
const WITHOUT_BONUS = version('v2', { bonus: undefined });

interface Opened {
	close: ReturnType<typeof vi.fn>;
	dismiss: ReturnType<typeof vi.fn>;
	view: EmbeddedViewRef<unknown>;
}

function mount(current: PayrollRulesVersion) {
	TestBed.resetTestingModule();
	document.body.querySelectorAll('.bn-test-modal').forEach((node) => node.remove());
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
						holder.className = 'bn-test-modal';
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

async function editing(current: PayrollRulesVersion) {
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
	document.querySelector(`.bn-test-modal ${selector}`) as T | null;
const enter = (control: Element | null, value: string) => {
	const box = control as HTMLInputElement;
	box.value = value;
	box.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
};

describe('the bonus rules as a form and back (BN1)', () => {
	it('shows money in rupees and writes it back in paise, only when the version has bonus rules', () => {
		const form = toForm(WITH_BONUS, '2026-04-01');
		expect(form.bonus).toMatchObject({
			ratePct: 20,
			ceiling: 10_000,
			eligibleUpTo: 21_000,
			minimum: 100,
			provision: 'monthly',
		});
		// Brief 26 BN2: the law, the wage basis and the qualifying days are written too.
		expect(toWrite(form).bonus).toMatchObject(WITH_BONUS.bonus ?? {});
		const without = toForm(WITHOUT_BONUS, '2026-04-01');
		expect(without.bonus).toBeNull();
		expect('bonus' in toWrite(without)).toBe(false);
	});

	it('words the bonus rule from the version’s figures, or from the Act’s when it has none', () => {
		const bonus = (v: PayrollRulesVersion) => ruleRows(v).find((r) => r.key === 'bonus');
		expect(bonus(WITH_BONUS)).toEqual({
			key: 'bonus',
			from: null,
			values: { n: '20', warn: '18', rate: '20', ceiling: '10,000', limit: '21,000' },
		});
		expect(bonus(WITHOUT_BONUS)?.values).toEqual({
			n: '20',
			warn: '18',
			rate: '8.33',
			ceiling: '7,000',
			limit: '21,000',
		});
	});
});

describe('the bonus section of the add-a-version pop-up (BN1)', () => {
	it('shows the rate, ceiling, eligibility, minimum and when it is booked, changes each, and saves them', async () => {
		const { page, calls, redraw } = await editing(WITH_BONUS);
		expect(document.querySelector('.bn-test-modal')?.textContent).toContain('payroll_bonus_rules_title');
		expect(modal<HTMLInputElement>('#pr_bonus_rate')?.value).toBe('20');
		expect(modal<HTMLSelectElement>('#pr_bonus_book')?.value).toBe('monthly');
		enter(modal('#pr_bonus_rate'), '12');
		enter(modal('#pr_bonus_ceiling'), '8000');
		enter(modal('#pr_bonus_limit'), '25000');
		enter(modal('#pr_bonus_min'), '150');
		enter(modal('#pr_bonus_book'), 'year_end');
		await redraw();
		expect(page.form()?.bonus).toMatchObject({
			ratePct: 12,
			ceiling: 8_000,
			eligibleUpTo: 25_000,
			minimum: 150,
			provision: 'year_end',
		});
		await page.save();
		const [sent] = calls.addRules.mock.lastCall as unknown as [{ bonus: BonusRules }];
		expect(sent.bonus).toMatchObject({
			ratePct: 12,
			wageCeilingPaise: 8_000_00,
			eligibleUpToPaise: 25_000_00,
			minimumPaise: 150_00,
			provision: 'year_end',
		});
	});

	it('has no bonus section for a version without it, and leaves the form alone then and before it opens', async () => {
		const closed = mount(WITH_BONUS);
		closed.page.patchBonus({ ratePct: 12 });
		expect(closed.page.form()).toBeNull();
		const { page } = await editing(WITHOUT_BONUS);
		expect(modal('#pr_bonus_rate')).toBeNull();
		const before = page.form();
		page.patchBonus({ ratePct: 12 });
		expect(page.form()).toBe(before);
	});
});
