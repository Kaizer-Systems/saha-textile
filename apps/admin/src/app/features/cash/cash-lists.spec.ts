import { signal } from '@angular/core';
import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CashGateway } from '@core/cash/cash.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { CashSheetsListPage, CASH_PRESETS, SHEET_CHIPS } from './cash-sheets-list';
import cashRoutes from './cash.routes';
import { CashClaimsListPage, CLAIM_CHIPS, CLAIM_PILL } from './claims-list';
import { CashPettyListPage } from './petty-list';

/** Cash › Cash sheets (O11), Differences to resolve, Petty expenses (O13) and Expense claims (O12). */

const sheetRow = (patch: Record<string, unknown> = {}) => ({
	id: 'sh1',
	date: '2026-11-23',
	boxName: 'Counter <till>',
	locationName: 'Gariahat store',
	status: 'difference',
	openingPaise: 231_200,
	inPaise: 500_000,
	outPaise: 60_000,
	countedPaise: 641_200,
	differencePaise: -30_000,
	openedBy: 'Priya Sen',
	...patch,
});
const pettyRow = (patch: Record<string, unknown> = {}) => ({
	id: 'pc1',
	number: 'PC/26-27/000001',
	date: '2026-11-23',
	boxName: 'Counter till',
	headName: 'Local delivery',
	paidTo: 'Bike rider',
	whatFor: 'Saree',
	amountPaise: 12_000,
	gst: null,
	byName: 'Priya Sen',
	...patch,
});
const claimRow = (patch: Record<string, unknown> = {}) => ({
	id: 'ec1',
	number: 'EC/26-27/000001',
	spentOn: '2026-11-21',
	staffName: 'Rahul Das',
	locationName: 'Salt Lake',
	headName: 'Local delivery',
	amountPaise: 45_000,
	payBack: null,
	status: 'waiting',
	...patch,
});
const choices = {
	boxes: [
		{ id: 'box_petty', name: 'Petty cash', kind: 'fixed_float', locationId: 'loc_gar', locationName: 'Gariahat' },
		{ id: 'box_till', name: 'Counter till', kind: 'day_sheet', locationId: 'loc_gar', locationName: 'Gariahat' },
	],
	banks: [{ id: 'led_hdfc', name: 'HDFC' }],
	heads: [{ id: 'led_conv', name: 'Local delivery' }],
	staff: [{ id: 'adm_rahul', name: 'Rahul Das' }],
	locations: [{ id: 'loc_gar', name: 'Gariahat' }],
	manager: true,
};

function setup<T>(
	component: Type<T>,
	gatewayPatch: Record<string, unknown> = {},
	answers: unknown[] = [],
	data: Record<string, unknown> = {},
) {
	const queue = [...answers];
	const modals = {
		open: vi.fn(() => {
			const answer = queue.shift();
			return {
				componentInstance: { start: vi.fn() },
				close: vi.fn(),
				result: answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer),
			};
		}),
	};
	const gateway = {
		choices: vi.fn(() => of(choices)),
		sheets: vi.fn(() =>
			of({
				items: [
					sheetRow(),
					sheetRow({
						id: 'sh2',
						status: 'open',
						openingPaise: null,
						inPaise: null,
						outPaise: null,
						countedPaise: null,
						differencePaise: null,
					}),
				],
				total: 2,
				counts: { all: 2, difference: 1, open: 1 },
				amounts: true,
			}),
		),
		petty: vi.fn(() =>
			of({
				items: [
					pettyRow(),
					pettyRow({ id: 'pc2', gst: { cgstPaise: 900, sgstPaise: 900, igstPaise: 0 }, byName: null }),
				],
				total: 2,
				totalPaise: 24_000,
			}),
		),
		refillPreview: vi.fn(() => of({ box: choices.boxes[0], spentPaise: 356_000, refillPaise: 356_000, heads: [] })),
		refill: vi.fn(() => of({})),
		claims: vi.fn(() =>
			of({
				items: [claimRow(), claimRow({ id: 'ec2', payBack: 'salary', status: 'approved' })],
				total: 2,
				counts: { all: 2, waiting: 1, approved: 1, paid: 0, rejected: 0 },
			}),
		),
		createClaim: vi.fn(() => of({ id: 'ec9' })),
		...gatewayPatch,
	};
	const router = { navigate: vi.fn() };
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			component,
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
			{ provide: Router, useValue: router },
			{ provide: NotificationService, useValue: notifier },
			{ provide: ActivatedRoute, useValue: { snapshot: { data } } },
			{ provide: AuthStore, useValue: { permissions: signal(['cash.index', 'expense_claim.create']) } },
		],
	});
	const fixture = TestBed.createComponent(component);
	return { fixture, page: fixture.componentInstance, gateway, router, notifier, modals };
}

describe('the cash sheets list (O11) and differences to resolve', () => {
	it('lists every box and day with amounts, escaping names, and narrows by chip, period, location and search', async () => {
		const { fixture, page, gateway, router } = setup(CashSheetsListPage);
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.tableConfig().data).toHaveLength(2));
		const [first, second] = page.tableConfig().data;
		expect(first).toMatchObject({ boxText: 'Counter &lt;till&gt; · Gariahat store', differenceText: '-₹300.00' });
		expect(second).toMatchObject({ openingText: '—', countedText: '—' });
		expect(String(first?.['statusHtml'])).toContain('status-danger');
		expect(page.counts()).toEqual({ all: 2, difference: 1, open: 1 });
		page.setChip('open');
		page.setLocation('loc_gar');
		expect(page.query()).toMatchObject({ locationId: 'loc_gar' });
		page.setLocation('');
		page.setPeriod({ period: 'last_month' });
		page.onTableChange({ search: ' priya ', page: 2, paginate: 500 });
		expect(page.query()).toMatchObject({ chip: 'open', search: 'priya', page: 2, pageSize: 100 });
		page.onTableChange();
		expect(page.query()).toMatchObject({ page: 1, pageSize: 30 });
		page.open(first as never);
		page.onAction({ actionToPerform: 'view', data: first } as never);
		page.onAction({ actionToPerform: 'other', data: first } as never);
		page.onAction({ actionToPerform: 'view' } as never);
		expect(router.navigate).toHaveBeenCalledTimes(2);
		expect(gateway.sheets).toHaveBeenCalled();
		expect(SHEET_CHIPS).toEqual(['all', 'difference', 'open']);
		expect(CASH_PRESETS).toContain('this_month');
	});

	it('starts on the difference chip as Differences to resolve', () => {
		const { page } = setup(CashSheetsListPage, {}, [], { differences: true });
		expect(page.differences).toBe(true);
		expect(page.chip()).toBe('difference');
	});
});

describe('petty expenses and refills (O13)', () => {
	it('lists petty expenses with their GST, and refills a fixed float from a bank', async () => {
		const { fixture, page, gateway, notifier } = setup(CashPettyListPage, {}, [undefined]);
		expect(page.floats()).toEqual([]);
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.tableConfig().data).toHaveLength(2));
		expect(page.tableConfig().data.map((r) => [r['gstText'], r['byText']])).toEqual([
			['—', 'Priya Sen'],
			['₹18.00', '—'],
		]);
		expect(page.floats().map((b) => b.id)).toEqual(['box_petty']);
		page.setBox('box_petty');
		expect(page.query()).toMatchObject({ boxId: 'box_petty' });
		page.setBox('');
		page.setPeriod({ period: 'last_month' });
		page.onTableChange({ search: 'rider' });
		expect(page.query()).toMatchObject({ search: 'rider', page: 1 });
		page.onTableChange();
		await page.openRefill('box_petty', {} as never);
		expect(page.amount()).toBe('3560');
		await page.refill();
		expect(gateway.refill).not.toHaveBeenCalled();
		page.from.set('led_hdfc');
		await page.refill();
		expect(gateway.refill).toHaveBeenCalledWith('box_petty', { fromLedgerId: 'led_hdfc', amountPaise: 356_000 });
		expect(notifier.showSuccess).toHaveBeenCalledWith('cash_refilled');
	});

	it('says why a refill or its preview was refused', async () => {
		const { page, notifier } = setup(CashPettyListPage, {
			refillPreview: vi.fn(() => throwError(() => ({ error: { issues: [{ message: 'not_a_fixed_float' }] } }))),
		});
		await page.openRefill('box_till', {} as never);
		expect(notifier.showError).toHaveBeenCalledWith('cash_problem_not_a_fixed_float');
		const failing = setup(CashPettyListPage, { refill: vi.fn(() => throwError(() => new Error('down'))) }, [
			undefined,
		]);
		await failing.page.openRefill('box_petty', {} as never);
		failing.page.from.set('led_hdfc');
		await failing.page.refill();
		expect(failing.notifier.showError).toHaveBeenCalledWith('cash_failed');
	});
});

describe('expense claims (O12)', () => {
	it('lists claims with their state, and opens one', async () => {
		const { fixture, page, router } = setup(CashClaimsListPage);
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.tableConfig().data).toHaveLength(2));
		expect(page.tableConfig().data.map((r) => r['payBackText'])).toEqual(['—', 'cash_pay_salary']);
		expect(page.canClaim()).toBe(true);
		page.setChip('waiting');
		page.setPeriod({ period: 'last_month' });
		page.onTableChange({ search: 'rahul' });
		expect(page.query()).toMatchObject({ chip: 'waiting', search: 'rahul' });
		page.onTableChange();
		const row = page.tableConfig().data[0];
		page.onAction({ actionToPerform: 'view', data: row } as never);
		page.onAction({ actionToPerform: 'other', data: row } as never);
		page.onAction({ actionToPerform: 'view' } as never);
		expect(router.navigate).toHaveBeenCalledWith(['/cash/claims', 'ec1']);
		expect(CLAIM_CHIPS).toHaveLength(5);
		expect(CLAIM_PILL.rejected).toBe('status-danger');
	});

	it('sends a new claim with its bill, for oneself or someone else, and says why one was refused', async () => {
		const { fixture, page, gateway, router } = setup(CashClaimsListPage, {}, [
			undefined,
			[{ assetId: 'med_bill', name: 'auto.jpg' }],
			new Error('closed'),
		]);
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.choices.data()).toBeTruthy());
		page.newClaim({} as never);
		expect(page.location()).toBe('loc_gar');
		expect(page.ready()).toBe(false);
		page.head.set('led_conv');
		page.amount.set('450');
		page.whatFor.set(' Auto to Barasat ');
		expect(page.ready()).toBe(true);
		await page.pickBill();
		await page.pickBill();
		expect(page.bill()?.assetId).toBe('med_bill');
		await page.save();
		expect(gateway.createClaim).toHaveBeenCalledWith(
			expect.objectContaining({
				staffUserId: null,
				amountPaise: 45_000,
				whatFor: 'Auto to Barasat',
				billMediaId: 'med_bill',
			}),
		);
		expect(router.navigate).toHaveBeenCalledWith(['/cash/claims', 'ec9']);
		page.staff.set('adm_rahul');
		page.bill.set(null);
		await page.save();
		expect(gateway.createClaim).toHaveBeenLastCalledWith(
			expect.objectContaining({ staffUserId: 'adm_rahul', billMediaId: null }),
		);
		const refused = setup(CashClaimsListPage, { createClaim: vi.fn(() => throwError(() => new Error('x'))) });
		await refused.page.save();
		expect(refused.notifier.showError).toHaveBeenCalledWith('cash_failed');
		// With no locations yet, a new claim starts with none chosen.
		refused.gateway.choices.mockReturnValue(of({ ...choices, locations: [] }));
		refused.page.newClaim({} as never);
		expect(refused.page.location()).toBe('');
	});
});

describe('cash routes', () => {
	it('lazy-load every cash page', async () => {
		const pages = await Promise.all(
			cashRoutes.flatMap((route) =>
				'loadComponent' in route && route.loadComponent ? [route.loadComponent()] : [],
			),
		);
		expect(pages).toHaveLength(7);
		expect(cashRoutes.find((r) => r.path === 'differences')?.data).toEqual({ differences: true });
	});
});
