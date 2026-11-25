import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { shortDateTime } from '@core/purchasing/purchasing-format';
import { WorklistGateway } from '@core/worklist/worklist.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { ExportMenu } from '@shared/ui/export-menu/export-menu';

import { WORKLIST_AREAS, WORKLIST_NEEDS, WorklistPage } from './worklist-page';

import type { WorklistRow } from '@saha-textile/contracts';

/**
 * The worklist (brief 26 WL1): everything waiting on the signed-in person, filtered by what it needs and where it
 * comes from; ✓ approves at once, ✕ asks for a reason, and Open lands on the item's own page.
 */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const ROWS: WorklistRow[] = [
	{
		id: 'leave_asked:la1',
		kind: 'leave_asked',
		needs: 'approve',
		area: 'payroll',
		params: { name: 'Asha Das', days: 2 },
		askedBy: 'Asha Das',
		since: '2026-11-25T05:30:00.000Z',
		open: { path: ['/payroll', 'attendance'], query: { month: '2026-11' } },
		answerable: true,
	},
	{
		id: 'payslip_blocking:2026-11/e2',
		kind: 'payslip_blocking',
		needs: 'fix',
		area: 'payroll',
		params: { name: 'Rafiq Ali' },
		askedBy: null,
		since: '2026-11-26T00:30:00.000Z',
		open: { path: ['/payroll', 'runs', '2026-11', 'payslips', 'e2', 'edit'], query: {} },
		answerable: false,
	},
	{
		id: 'stock_approval:sa9',
		kind: 'stock_approval',
		needs: 'check',
		area: 'stock',
		params: { sku: 'ST-BAN-0412' },
		askedBy: 'Mitali Sen',
		since: '2026-11-24T09:00:00.000Z',
		open: { path: ['/stock', 'approvals'], query: {} },
		answerable: true,
	},
];

interface Options {
	rows?: WorklistRow[];
	gateway?: Record<string, unknown>;
	/** The reason typed into ✕'s pop-up, or 'cancel' to close it. */
	reason?: string;
}

async function worklist(options: Options = {}) {
	TestBed.resetTestingModule();
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const asked: unknown[] = [];
	const gateway = {
		rows: vi.fn(() => of(options.rows ?? ROWS)),
		approve: vi.fn(() => of({ done: true })),
		reject: vi.fn(() => of({ done: true })),
		...options.gateway,
	};
	TestBed.configureTestingModule({
		imports: [
			WorklistPage,
			TranslocoTestingModule.forRoot({
				langs: { en: { wl_what_leave_asked: '{{ name }} asks for {{ days }} days' } },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			provideRouter([]),
			{ provide: WorklistGateway, useValue: gateway },
			{ provide: NotificationService, useValue: notifier },
			{
				provide: NgbModal,
				useValue: {
					open: vi.fn(() => {
						let ask: { act: (reason: string) => Promise<unknown> } | undefined;
						// The pop-up hands back what its action returned, or nothing when it is closed.
						const result = (async () => {
							await Promise.resolve();
							if (options.reason === 'cancel') throw new Error('closed');
							return ask?.act(options.reason ?? 'Stock-taking that week');
						})();
						return {
							componentInstance: {
								start: (given: typeof ask) => {
									ask = given;
									asked.push(given);
								},
							},
							result,
						};
					}),
				},
			},
		],
	});
	TestBed.overrideComponent(WorklistPage, {
		remove: { imports: [ExportMenu] },
		add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
	});
	const fixture = TestBed.createComponent(WorklistPage);
	fixture.detectChanges();
	await settle(fixture);
	const find = <T extends HTMLElement = HTMLElement>(selector: string) =>
		fixture.nativeElement.querySelector(selector) as T | null;
	return { fixture, page: fixture.componentInstance, gateway, notifier, asked, find, settle: () => settle(fixture) };
}

const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim();
const id = (rowId: string) => rowId.replace(/[:/]/g, (c) => `\\${c}`);

describe('the worklist (WL1)', () => {
	it('lists everything waiting, each with what it needs, where it is from, what it says, who asked and since when', async () => {
		const { find } = await worklist();
		expect([[...WORKLIST_NEEDS], [...WORKLIST_AREAS]]).toEqual([
			['approve', 'fix', 'check'],
			['payroll', 'stock', 'accounts'],
		]);
		expect(text(find('small.text-muted'))).toBe('wl_sub');
		const rows = [...(find('tbody')?.querySelectorAll('tr') ?? [])] as HTMLElement[];
		expect(rows.map((tr) => [...tr.querySelectorAll('td')].slice(0, 5).map((td) => text(td)))).toEqual([
			[
				'wl_needs_approve',
				'wl_area_payroll',
				'Asha Das asks for 2 days',
				'Asha Das',
				shortDateTime(ROWS[0]?.since),
			],
			['wl_needs_fix', 'wl_area_payroll', 'wl_what_payslip_blocking', 'wl_system', shortDateTime(ROWS[1]?.since)],
			['wl_needs_check', 'wl_area_stock', 'wl_what_stock_approval', 'Mitali Sen', shortDateTime(ROWS[2]?.since)],
		]);
		expect(rows.map((tr) => tr.querySelector('.badge')?.className)).toEqual([
			'badge badge-theme',
			'badge bg-danger',
			'badge bg-warning text-dark',
		]);
		const open = find<HTMLAnchorElement>(`#wl_open_${id('leave_asked:la1')}`) as HTMLAnchorElement;
		expect([open.getAttribute('href'), text(open)]).toEqual(['/payroll/attendance?month=2026-11', 'wl_open']);
		// ✓ and ✕ only on a yes-or-no item.
		expect(find(`#wl_yes_${id('payslip_blocking:2026-11/e2')}`)).toBeNull();
		expect(find<HTMLButtonElement>(`#wl_no_${id('stock_approval:sa9')}`)?.title).toBe('wl_reject');
		expect(find<HTMLButtonElement>(`#wl_yes_${id('stock_approval:sa9')}`)?.title).toBe('wl_approve');
	});

	it('filters by what an item needs and where it is from, a second click on an area clearing it', async () => {
		const { page, find, settle } = await worklist();
		expect([page.countOf(''), page.countOf('approve'), page.countOf('fix'), page.countOf('check')]).toEqual([
			3, 1, 1, 1,
		]);
		expect(text(find('#wl_need_all'))).toBe('wl_all 3');
		expect(find('#wl_need_all')?.classList.contains('btn-theme')).toBe(true);
		find<HTMLButtonElement>('#wl_need_fix')?.click();
		await settle();
		expect([page.rows().map((r) => r.id), find('#wl_need_fix')?.classList.contains('btn-theme')]).toEqual([
			['payslip_blocking:2026-11/e2'],
			true,
		]);
		expect(find('#wl_need_all')?.classList.contains('btn-outline')).toBe(true);
		find<HTMLButtonElement>('#wl_need_all')?.click();
		find<HTMLButtonElement>('#wl_area_stock')?.click();
		await settle();
		expect([page.rows().map((r) => r.id), find('#wl_area_stock')?.classList.contains('btn-theme')]).toEqual([
			['stock_approval:sa9'],
			true,
		]);
		find<HTMLButtonElement>('#wl_area_stock')?.click();
		await settle();
		expect([page.area(), page.rows()]).toEqual(['', ROWS]);
		find<HTMLButtonElement>('#wl_area_accounts')?.click();
		await settle();
		expect(text(find('td[colspan="6"]'))).toBe('wl_none');
	});

	it('approves an item at once, holding its buttons meanwhile, and names a refusal', async () => {
		const { page, gateway, notifier, find, settle } = await worklist();
		find<HTMLButtonElement>(`#wl_yes_${id('leave_asked:la1')}`)?.click();
		expect(page.busy()).toBe('leave_asked:la1');
		await settle();
		expect(gateway.approve).toHaveBeenCalledWith('leave_asked:la1');
		expect([notifier.showSuccess.mock.calls, page.busy()]).toEqual([[['wl_approved']], '']);
		gateway.approve.mockReturnValueOnce(throwError(() => ({ error: { message: 'leave_not_enough' } })));
		await page.approve(ROWS[0] as WorklistRow);
		expect(notifier.showError).toHaveBeenCalledWith('payroll_problem_leave_not_enough');
		expect(page.busy()).toBe('');
	});

	it('holds a row’s ✓ and ✕ while it is answered', async () => {
		const { page, fixture, find } = await worklist();
		page.busy.set('stock_approval:sa9');
		fixture.detectChanges();
		expect([
			find<HTMLButtonElement>(`#wl_yes_${id('stock_approval:sa9')}`)?.disabled,
			find<HTMLButtonElement>(`#wl_no_${id('stock_approval:sa9')}`)?.disabled,
			find<HTMLButtonElement>(`#wl_yes_${id('leave_asked:la1')}`)?.disabled,
		]).toEqual([true, true, false]);
	});

	it('rejects an item with the reason typed, which reaches the asker, and does nothing when closed', async () => {
		const { gateway, notifier, asked, find, settle } = await worklist();
		find<HTMLButtonElement>(`#wl_no_${id('leave_asked:la1')}`)?.click();
		await settle();
		expect(asked[0]).toMatchObject({
			title: 'wl_reject_title',
			label: 'wl_reject_reason',
			confirm: 'wl_reject',
			confirmClass: 'btn-danger',
		});
		expect(gateway.reject).toHaveBeenCalledWith('leave_asked:la1', 'Stock-taking that week');
		expect(notifier.showSuccess).toHaveBeenCalledWith('wl_rejected');
		const closed = await worklist({ reason: 'cancel' });
		await closed.page.reject(ROWS[0] as WorklistRow);
		expect([closed.gateway.reject.mock.calls.length, closed.notifier.showSuccess.mock.calls.length]).toEqual([
			0, 0,
		]);
	});

	it('writes the rows shown for the Export menu', async () => {
		const { page } = await worklist();
		page.need.set('approve');
		expect(page.exportSource()).toEqual({
			fileName: 'worklist',
			title: 'wl_title',
			header: ['wl_col_needs', 'wl_col_from', 'wl_col_what', 'wl_col_asked_by', 'wl_col_since'],
			rows: [['wl_needs_approve', 'wl_area_payroll', 'Asha Das asks for 2 days', 'Asha Das', ROWS[0]?.since]],
		});
		page.need.set('fix');
		expect(page.exportSource().rows[0]?.[3]).toBe('');
	});

	it('says so when nothing waits, and counts nothing before the list is read', async () => {
		const { page, find } = await worklist({ rows: [] });
		expect([page.countOf(''), text(find('td[colspan="6"]'))]).toEqual([0, 'wl_none']);
		const reading = await worklist({ gateway: { rows: vi.fn(() => throwError(() => new Error('offline'))) } });
		expect([reading.page.rows(), reading.page.countOf('fix')]).toEqual([[], 0]);
	});
});
