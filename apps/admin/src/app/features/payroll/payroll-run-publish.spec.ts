import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { PayrollGateway } from '@core/accounts/payroll.gateway';
import { LocationsGateway } from '@core/locations/locations.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { PayrollRunPage } from './payroll-run-page';

import type { PayrollRun } from '@saha-textile/contracts';

/**
 * Publish (brief 26 PE1, PE3, PE4): approve and post a draft together; with edited payslips, first what changed, then
 * whether to keep the new figures as the salary from next month.
 */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};

const row = (employeeId: string, over: Record<string, unknown> = {}) => ({
	employeeId,
	name: 'Asha Das',
	locationId: 'l1',
	paidDays: 30,
	grossPaise: 3_200_000,
	pfEmployeePaise: 192_000,
	esiEmployeePaise: 0,
	ptPaise: 20_000,
	tdsPaise: 0,
	advancePaise: 0,
	netPaise: 2_988_000,
	...over,
});
const run = (over: Record<string, unknown> = {}) => ({
	month: '2026-11',
	status: 'draft',
	rows: [row('e1', { stateCode: '19' }), row('e2', { name: 'Rafiq Ali', locationId: 'l9' })],
	version: 3,
	voucherId: null,
	payVoucherId: null,
	...over,
});

interface Options {
	permissions?: string[];
	answers?: unknown[];
	gateway?: Record<string, unknown>;
}

/** The run page with its pop-ups answered in turn: true, false, null, or 'dismissed'. */
async function opened(current: ReturnType<typeof run>, options: Options = {}) {
	TestBed.resetTestingModule();
	const answers = [...(options.answers ?? [])];
	const asked: unknown[] = [];
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const gateway = {
		run: vi.fn(() => of(current)),
		attendance: vi.fn(() => of({ lockedAt: '2026-12-01T05:30:00.000Z' })),
		prepare: vi.fn(() => of(current)),
		step: vi.fn((_month: string, body: { to: string; version: number }) =>
			of({ ...current, status: body.to, version: body.version + 1 }),
		),
		keepFigures: vi.fn(() => of([])),
		...options.gateway,
	};
	TestBed.configureTestingModule({
		imports: [
			PayrollRunPage,
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
			{ provide: LedgerGateway, useValue: { chart: vi.fn(() => of({ groups: [], ledgers: [] })) } },
			{
				provide: LocationsGateway,
				useValue: { list: vi.fn(() => of([{ id: 'l1', name: 'Barasat', active: true }])) },
			},
			{ provide: NotificationService, useValue: notifier },
			{
				provide: AuthStore,
				useValue: {
					permissions: signal(
						options.permissions ?? ['accounts.index', 'accounts.edit', 'accounts.lock', 'accounts.post'],
					),
				},
			},
			{
				provide: NgbModal,
				useValue: {
					open: vi.fn(() => {
						const answer = answers.shift();
						return {
							componentInstance: { start: (ask: unknown) => asked.push(ask) },
							result:
								answer === 'dismissed'
									? Promise.reject(new Error('dismissed'))
									: Promise.resolve(answer),
						};
					}),
				},
			},
		],
	});
	const fixture = TestBed.createComponent(PayrollRunPage);
	fixture.detectChanges();
	await settle(fixture);
	return { fixture, page: fixture.componentInstance, gateway, notifier, asked };
}

const el = <T extends HTMLElement = HTMLElement>(fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as T | null;

const byRules = {
	headsPaise: { basic: 1_000_000, special: 500_000 },
	grossPaise: 2_000_000,
	pfEmployeePaise: 120_000,
	pfEmployerPaise: 120_000,
	esiEmployeePaise: 15_000,
	esiEmployerPaise: 65_000,
	ptPaise: 15_000,
	tdsPaise: 100_000,
	advancePaise: 50_000,
	netPaise: 1_700_000,
};
/** Asha's basic raised, a head added and special dropped, a bonus added, PF, tax, TDS and the advance changed. */
const editedRow = () =>
	row('e1', {
		stateCode: '19',
		headsPaise: { basic: 1_100_000, other: 50_000 },
		pfEmployeePaise: 132_000,
		esiEmployeePaise: 15_000,
		ptPaise: 20_000,
		tdsPaise: 0,
		advancePaise: 0,
		netPaise: 1_983_000,
		byRules,
		edits: {
			heads: { basic: 1_100_000 },
			added: [{ id: 'la', kind: 'taxable', name: 'Festival bonus', paise: 200_000, oneOff: true }],
			deductions: { tds: 0 },
			reasons: { basic: 'Promoted', tds: 'Rent proof' },
		},
	});
const editedRun = () => run({ rows: [editedRow(), row('e2', { name: 'Rafiq Ali', stateCode: '19' })] });
const asRun = (r: unknown) => r as PayrollRun;

describe('what changed on the edited payslips (PE3)', () => {
	it('lists each changed line by the rules and now, the added lines and the net, for edited payslips only', async () => {
		const { page } = await opened(editedRun());
		const money = page.money;
		expect(page.changes(asRun(editedRun()))).toEqual([
			`Asha Das · payroll_head_basic: ${money(1_000_000)} → ${money(1_100_000)}`,
			`Asha Das · payroll_head_special: ${money(500_000)} → ${money(0)}`,
			`Asha Das · payroll_head_other: ${money(0)} → ${money(50_000)}`,
			`Asha Das · Festival bonus (pe_kind_taxable): ${money(200_000)}`,
			`Asha Das · pe_deduction_pf: ${money(120_000)} → ${money(132_000)}`,
			`Asha Das · pe_deduction_pt: ${money(15_000)} → ${money(20_000)}`,
			`Asha Das · pe_deduction_tds: ${money(100_000)} → ${money(0)}`,
			`Asha Das · pe_deduction_advance: ${money(50_000)} → ${money(0)}`,
			`Asha Das · pe_net: ${money(1_700_000)} → ${money(1_983_000)}`,
		]);
	});

	it('lists nothing for a row edited without the rules’ payslip, and reads a row with no heads as none', async () => {
		const { page } = await opened(editedRun());
		expect(page.changes(asRun(run({ rows: [{ ...editedRow(), byRules: undefined }] })))).toEqual([]);
		const noHeads = run({ rows: [{ ...editedRow(), headsPaise: undefined }] });
		expect(page.changes(asRun(noHeads)).slice(0, 2)).toEqual([
			`Asha Das · payroll_head_basic: ${page.money(1_000_000)} → ${page.money(0)}`,
			`Asha Das · payroll_head_special: ${page.money(500_000)} → ${page.money(0)}`,
		]);
	});
});

describe('Publish (PE1, PE3, PE4)', () => {
	it('offers Publish on a draft to someone who may lock the books, held with no rows or a State missing', async () => {
		const { fixture } = await opened(run());
		expect(el<HTMLButtonElement>(fixture, '#run_publish')?.disabled).toBe(false);
		const empty = await opened(run({ rows: [] }));
		expect(el<HTMLButtonElement>(empty.fixture, '#run_publish')?.disabled).toBe(true);
		const missing = await opened(run({ statesMissing: ['27'] }));
		expect(el<HTMLButtonElement>(missing.fixture, '#run_publish')?.disabled).toBe(true);
		const editor = await opened(run(), { permissions: ['accounts.index', 'accounts.edit'] });
		expect(el(editor.fixture, '#run_publish')).toBeNull();
		const approved = await opened(run({ status: 'approved' }));
		expect(el(approved.fixture, '#run_publish')).toBeNull();
	});

	it('approves and posts a run with no edited payslips at once, asking nothing', async () => {
		const { fixture, page, gateway, notifier, asked } = await opened(run());
		el<HTMLButtonElement>(fixture, '#run_publish')?.click();
		await settle(fixture);
		expect(asked).toEqual([]);
		expect(gateway.step.mock.calls).toEqual([
			[page.month(), { to: 'approved', version: 3 }],
			[page.month(), { to: 'posted', version: 4 }],
		]);
		expect(gateway.keepFigures).not.toHaveBeenCalled();
		expect([notifier.showSuccess.mock.calls, page.busy()]).toEqual([[['pe_published']], false]);
	});

	it('shows what changed first, and changes nothing when that is cancelled or the next question is closed', async () => {
		for (const answers of [[false], ['dismissed'], [true, 'dismissed'], [true, null]]) {
			const { page, gateway, asked } = await opened(editedRun(), { answers });
			await page.publish(asRun(editedRun()));
			expect(gateway.step, JSON.stringify(answers)).not.toHaveBeenCalled();
			expect(asked[0]).toEqual({
				icon: 'ri-file-list-3-line',
				title: 'pe_publish_title',
				body: 'pe_publish_body',
				params: { n: 1 },
				yes: 'pe_ok',
				items: page.changes(asRun(editedRun())),
			});
		}
	});

	it('publishes as edited on No, and keeps the new figures from next month on Yes, naming anyone refused', async () => {
		const no = await opened(editedRun(), { answers: [true, false] });
		await no.page.publish(asRun(editedRun()));
		expect(no.asked[1]).toEqual({
			icon: 'ri-save-line',
			title: 'pe_keep_title',
			body: 'pe_keep_body',
			yes: 'yes',
			no: 'no',
			items: ['Asha Das'],
		});
		expect([no.gateway.step.mock.calls.length, no.gateway.keepFigures.mock.calls.length]).toEqual([2, 0]);
		expect(no.notifier.showSuccess).toHaveBeenCalledWith('pe_published');
		const yes = await opened(editedRun(), {
			answers: [true, true],
			gateway: {
				keepFigures: vi.fn(() =>
					of([
						{ employeeId: 'e1', ok: false, problem: 'revision_before_last' },
						{ employeeId: 'e9', ok: false, problem: null },
						{ employeeId: 'e2', ok: true, problem: null },
					]),
				),
			},
		});
		await yes.page.publish(asRun(editedRun()));
		expect(yes.gateway.keepFigures).toHaveBeenCalledWith(yes.page.month(), ['e1']);
		expect(yes.notifier.showError.mock.calls).toEqual([
			['Asha Das: payroll_problem_revision_before_last'],
			['e9: payroll_problem_failed'],
		]);
		expect(yes.notifier.showSuccess).toHaveBeenCalledWith('pe_published');
	});

	it('names a refusal to approve or post, and frees the page', async () => {
		const { page, notifier } = await opened(run(), {
			gateway: { step: vi.fn(() => throwError(() => ({ error: { message: 'attendance_not_locked' } }))) },
		});
		await page.publish(asRun(run()));
		expect(notifier.showError).toHaveBeenCalledWith('payroll_problem_attendance_not_locked');
		expect([notifier.showSuccess.mock.calls.length, page.busy()]).toEqual([0, false]);
	});
});
