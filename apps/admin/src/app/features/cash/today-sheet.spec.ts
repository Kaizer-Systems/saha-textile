import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CashGateway } from '@core/cash/cash.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { ARRIVES, CashTodayPage } from './today-sheet';

import type { CashSheetRow, TodaysSheet } from '@saha-textile/contracts';

/** Cash › Today's sheet (accounts brief O2, O3, O5–O7, O9, O10, O14). */

const BOX = { id: 'box_till', name: 'Counter till', locationId: 'loc_gar', kind: 'day_sheet' } as TodaysSheet['box'];
const sheetView = (status = 'open', amounts = false) =>
	({
		sheet: {
			id: 'sh1',
			date: '2026-11-23',
			status,
			openedAt: '2026-11-23T04:32:00.000Z',
			opening: { totalPaise: 200_000 },
		},
		box: BOX,
		locationName: 'Gariahat store',
		openedByName: 'Priya Sen',
		amounts,
		rows: [
			{
				id: 'o',
				kind: 'opening',
				what: 'opening',
				at: '2026-11-23T04:32:00.000Z',
				inPaise: null,
				outPaise: null,
				expectedPaise: amounts ? 230_000 : null,
				addedOnReview: false,
				ref: null,
				by: 'Priya Sen',
			},
			{
				id: 'c',
				kind: 'carried',
				what: '2026-11-22',
				at: '2026-11-23T04:32:00.000Z',
				inPaise: null,
				outPaise: null,
				expectedPaise: amounts ? -30_000 : null,
				addedOnReview: false,
				ref: null,
				by: null,
			},
			{
				id: 'l',
				kind: 'counter_sale',
				what: 'Counter sale',
				at: '2026-11-23T06:10:00.000Z',
				inPaise: amounts ? 468_000 : null,
				outPaise: amounts ? 0 : null,
				expectedPaise: amounts ? 668_000 : null,
				addedOnReview: true,
				ref: 'TI/1',
				by: 'Priya Sen',
			},
		],
	}) as never;
const today = (patch: Partial<TodaysSheet> = {}): TodaysSheet =>
	({
		box: BOX,
		boxes: [BOX, { ...BOX, id: 'box_2', name: 'Second till' }],
		today: '2026-11-23',
		sheet: sheetView(),
		stillOpen: null,
		unsettled: [],
		denominations: [{ valuePaise: 50_000, kind: 'note', on: true }],
		...patch,
	}) as TodaysSheet;

function setup(data: TodaysSheet, answers: unknown[] = [], gatewayPatch: Record<string, unknown> = {}) {
	const queue = [...answers];
	const opened: unknown[] = [];
	const modals = {
		open: vi.fn((what: unknown) => {
			opened.push(what);
			const answer = queue.shift();
			return {
				componentInstance: { use: vi.fn() },
				result: answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer),
			};
		}),
	};
	const gateway = {
		today: vi.fn(() => of(data)),
		choices: vi.fn(() =>
			of({
				boxes: [{ ...BOX, locationName: 'Gariahat store' }],
				banks: [{ id: 'led_hdfc', name: 'HDFC' }],
				heads: [{ id: 'led_conv', name: 'Local delivery' }],
			}),
		),
		open: vi.fn(() => of({})),
		count: vi.fn(() => of({ result: 'closed', attempt: 1 })),
		submitDifference: vi.fn(() => of({})),
		...gatewayPatch,
	};
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			CashTodayPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient()),
			{ provide: CashGateway, useValue: gateway },
			{ provide: NgbModal, useValue: modals },
			{ provide: NotificationService, useValue: notifier },
			{ provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: new Map([['box', 'box_till']]) } } },
		],
	});
	const fixture = TestBed.createComponent(CashTodayPage);
	return { fixture, page: fixture.componentInstance, modals, gateway, notifier, opened, queue };
}

const count = { rows: [{ valuePaise: 50_000, kind: 'note', count: 4 }] };

describe('today’s sheet', () => {
	it('shows a cashier the lines without amounts, and what arrives by itself', async () => {
		const { fixture, page, modals } = setup(today());
		await vi.waitFor(() => {
			fixture.detectChanges();
			expect((fixture.nativeElement as HTMLElement).textContent).toContain('cash_blind_note');
		});
		expect(page.boxId()).toBe('box_till');
		expect(page.managerView()).toBe(false);
		expect(modals.open).not.toHaveBeenCalled();
		expect(ARRIVES).toHaveLength(4);
		const rows = (today().sheet as unknown as { rows: CashSheetRow[] }).rows;
		expect(rows.map((r) => page.rowWhat(r))).toEqual([
			{ key: 'cash_row_opening', text: '' },
			{ key: 'cash_row_carried', text: '2026-11-22' },
			{ key: null, text: 'Counter sale' },
		]);
		expect(page.placeOf('box_till')).toBe('Gariahat store');
		expect(page.placeOf('box_none')).toBe('');
		page.chooseBox('box_2');
		expect(page.boxId()).toBe('box_2');
	});

	it('shows a manager the amounts and the expected after each line (O10)', async () => {
		const { fixture, page } = setup(today({ sheet: sheetView('open', true) }));
		await vi.waitFor(() => {
			fixture.detectChanges();
			expect((fixture.nativeElement as HTMLElement).textContent).toContain('cash_manager_note');
		});
		expect(page.managerView()).toBe(true);
	});

	it('opens a sheet by counting the float, once per state, and takes no count when the pop-up is closed', async () => {
		const { fixture, gateway, modals } = setup(today({ sheet: null }), [count]);
		// The sheet reloads after opening with the same state: no second prompt.
		gateway.today
			.mockReturnValueOnce(of(today({ sheet: null })))
			.mockReturnValue(of(today({ sheet: null, denominations: [] })));
		fixture.detectChanges();
		await fixture.whenStable();
		await vi.waitFor(() =>
			expect(gateway.open).toHaveBeenCalledWith({ boxId: 'box_till', count, carryDifference: false }),
		);
		fixture.detectChanges();
		await fixture.whenStable();
		expect(modals.open).toHaveBeenCalledTimes(1);
		const closed = setup(today({ sheet: null }), [undefined]);
		closed.fixture.detectChanges();
		await closed.fixture.whenStable();
		await vi.waitFor(() => expect(closed.modals.open).toHaveBeenCalledTimes(1));
		expect(closed.gateway.open).not.toHaveBeenCalled();
	});

	it('closes yesterday first when it is still open (O14), or leaves it', async () => {
		const stillOpen = { sheetId: 'sh0', date: '2026-11-22' };
		const { page, gateway } = setup(today({ sheet: null, stillOpen }), ['close', count]);
		await page.prompt(today({ sheet: null, stillOpen }));
		expect(gateway.count).toHaveBeenCalledWith('sh0', count);
		const left = setup(today({ sheet: null, stillOpen }), [new Error('dismissed')]);
		await left.page.prompt(today({ sheet: null, stillOpen }));
		expect(left.gateway.count).not.toHaveBeenCalled();
	});

	it('waits for the manager or opens anyway, carrying the difference (O9)', async () => {
		const unsettled = [{ sheetId: 'sh0', date: '2026-11-22', differencePaise: -30_000 }];
		const { page, gateway } = setup(today({ sheet: null, unsettled }), ['open', count]);
		await page.prompt(today({ sheet: null, unsettled }));
		expect(gateway.open).toHaveBeenCalledWith({ boxId: 'box_till', count, carryDifference: true });
		const waits = setup(today({ sheet: null, unsettled }), ['wait']);
		await waits.page.prompt(today({ sheet: null, unsettled }));
		expect(waits.gateway.open).not.toHaveBeenCalled();
	});

	it('counts again once, then submits with a difference or counts again, never saying how much', async () => {
		const answers = [
			{ result: 'count_again', attempt: 1 },
			{ result: 'still_off', attempt: 2 },
			{ result: 'still_off', attempt: 3 },
		];
		const { page, gateway } = setup(today(), [count, count, 'again', count, 'submit'], {
			count: vi.fn(() => of(answers.shift())),
		});
		await page.close('sh1', today());
		expect(gateway.count).toHaveBeenCalledTimes(3);
		expect(gateway.submitDifference).toHaveBeenCalledWith('sh1');
		// Closing the difference dialog stops there.
		const stops = setup(today(), [count, undefined], {
			count: vi.fn(() => of({ result: 'still_off', attempt: 2 })),
		});
		await stops.page.close('sh1', today());
		expect(stops.gateway.submitDifference).not.toHaveBeenCalled();
		// No first count (the pop-up was dismissed): nothing happens.
		const none = setup(today(), [new Error('dismissed')]);
		await none.page.close('sh1', today());
		expect(none.gateway.count).not.toHaveBeenCalled();
	});

	it('says why a step was refused, in words', async () => {
		const { page, notifier } = setup(today(), [count], {
			count: vi.fn(() => throwError(() => ({ error: { issues: [{ message: 'cash_close_another' }] } }))),
		});
		await page.close('sh1', today());
		expect(notifier.showError).toHaveBeenCalledWith('cash_problem_cash_close_another');
		expect(page.busy()).toBe(false);
	});

	it('pays a petty expense and makes a bank deposit from the open sheet', async () => {
		const { page, notifier, opened } = setup(today(), [
			{ id: 'pc_1' },
			new Error('closed'),
			{ ok: true },
			new Error('closed'),
		]);
		await page.petty(today());
		expect(notifier.showSuccess).toHaveBeenCalledWith('cash_petty_done');
		await page.petty(today());
		await page.move(today(), 'sh1');
		expect(notifier.showSuccess).toHaveBeenCalledWith('cash_move_done');
		await page.move(today(), 'sh1');
		expect(opened).toHaveLength(4);
		expect(notifier.showSuccess).toHaveBeenCalledTimes(2);
	});
});
