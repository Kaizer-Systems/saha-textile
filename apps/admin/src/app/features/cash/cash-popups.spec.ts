import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CashGateway, cashProblemKey } from '@core/cash/cash.gateway';
import { runtimeConfig } from '@core/config/runtime-config';

import {
	ALL_SETTLEMENTS,
	EXCESS_SETTLEMENTS,
	SHORT_SETTLEMENTS,
	countingOrder,
	denominationLabel,
	istTime,
	paiseOf,
	settlementApplies,
	signedRupees,
} from './cash-format';
import { CashCountPopup } from './count-popup';
import { CashMovePopup } from './move-popup';
import { CashPettyPopup } from './petty-popup';

import type { CashBox, Denomination } from '@saha-textile/contracts';

/** Cash's gateway, helpers and pop-ups (accounts brief O2, O4, O5, O6). */

const DENOMS: Denomination[] = [
	{ valuePaise: 100, kind: 'coin', on: true },
	{ valuePaise: 50_000, kind: 'note', on: true },
	{ valuePaise: 1_000, kind: 'coin', on: true },
	{ valuePaise: 10_000, kind: 'note', on: true },
	{ valuePaise: 200_000, kind: 'note', on: false },
];
const BOX = { id: 'box_till', name: 'Counter till', locationId: 'loc_gar', kind: 'day_sheet' } as CashBox;

const translocoModule = () =>
	TranslocoTestingModule.forRoot({
		langs: { en: {} },
		translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
		preloadLangs: true,
	});

describe('the cash gateway', () => {
	it('calls each cash route with its body and query', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(CashGateway);
		const http = TestBed.inject(HttpTestingController);
		const api = `${runtimeConfig.apiUrl}/admin/cash/`;
		const calls: [() => unknown, string, string][] = [
			[() => gateway.settings(), 'GET', 'settings'],
			[() => gateway.saveSettings({} as never), 'PUT', 'settings'],
			[() => gateway.choices(), 'GET', 'choices'],
			[() => gateway.today(null), 'GET', 'today'],
			[() => gateway.today('box 1'), 'GET', 'today?boxId=box%201'],
			[() => gateway.open({} as never), 'POST', 'sheets'],
			[() => gateway.sheet('sh/1'), 'GET', 'sheets/sh%2F1'],
			[() => gateway.sheets({ chip: 'open' }), 'GET', 'sheets?chip=open'],
			[() => gateway.count('sh1', {} as never), 'POST', 'sheets/sh1/count'],
			[() => gateway.submitDifference('sh1'), 'POST', 'sheets/sh1/submit-difference'],
			[() => gateway.move('sh1', {} as never), 'POST', 'sheets/sh1/moves'],
			[() => gateway.settle('sh1', {} as never), 'POST', 'sheets/sh1/settle'],
			[() => gateway.pettyCheck('b1', 'x', 5), 'GET', 'petty/check?boxId=b1&paidTo=x&amountPaise=5'],
			[() => gateway.pay({} as never), 'POST', 'petty'],
			[() => gateway.petty({ boxId: 'b1' }), 'GET', 'petty?boxId=b1'],
			[() => gateway.refillPreview('b1'), 'GET', 'boxes/b1/refill'],
			[() => gateway.refill('b1', {} as never), 'POST', 'boxes/b1/refill'],
			[() => gateway.claims({ chip: 'waiting' }), 'GET', 'claims?chip=waiting'],
			[() => gateway.claim('ec1'), 'GET', 'claims/ec1'],
			[() => gateway.createClaim({} as never), 'POST', 'claims'],
			[() => gateway.decide('ec1', {} as never), 'POST', 'claims/ec1/decide'],
		];
		for (const [call, method, path] of calls) {
			(call() as { subscribe: () => void }).subscribe();
			http.expectOne((req) => req.method === method && req.urlWithParams === api + path).flush({});
		}
		http.verify();
	});

	it('puts cash refusals in words, a missing role with its name, and anything else with its code', () => {
		expect(cashProblemKey('cash_sheet_not_open')).toEqual({ key: 'cash_problem_cash_sheet_not_open', params: {} });
		expect(cashProblemKey('voucher_problem:role_not_mapped:employee_payable')).toEqual({
			key: 'cash_problem_role',
			params: { role: 'employee_payable' },
		});
		expect(cashProblemKey('boom')).toEqual({ key: 'cash_failed', params: { code: 'boom' } });
	});
});

describe('cash helpers', () => {
	it('names notes and coins, orders them notes first, reads rupees and tells which ways fit', () => {
		expect(denominationLabel({ valuePaise: 50_000, kind: 'note' }, 'note')).toBe('₹500 note');
		expect(countingOrder(DENOMS).map((d) => `${d.kind}${d.valuePaise}`)).toEqual([
			'note50000',
			'note10000',
			'coin1000',
			'coin100',
		]);
		expect(paiseOf('₹1,20.50')).toBe(12_050);
		expect(paiseOf('0')).toBeNull();
		expect(paiseOf('abc')).toBeNull();
		expect(settlementApplies('write_off', -1)).toBe(true);
		expect(settlementApplies('write_off', 1)).toBe(false);
		expect(settlementApplies('excess_suspense', 1)).toBe(true);
		expect(ALL_SETTLEMENTS).toHaveLength(10);
		// The admin's lists repeat the core's (contract values stay out of the admin bundle).
		expect([...SHORT_SETTLEMENTS, ...EXCESS_SETTLEMENTS].filter((w) => w !== 'counting_mistake')).toHaveLength(9);
		expect(istTime('2026-11-23T04:32:00.000Z')).toBe('10:02');
		expect(signedRupees(-30_000)).toBe('-₹300.00');
		expect(signedRupees(30_000)).toBe('₹300.00');
	});
});

describe('the count pop-up (O2, O5, O6)', () => {
	function count(touch = false) {
		const active = { close: vi.fn(), dismiss: vi.fn() };
		vi.stubGlobal('matchMedia', () => ({ matches: touch }));
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			imports: [CashCountPopup, translocoModule()],
			providers: [{ provide: NgbActiveModal, useValue: active }],
		});
		const fixture = TestBed.createComponent(CashCountPopup);
		vi.unstubAllGlobals();
		return { fixture, popup: fixture.componentInstance, active };
	}

	it('asks for each note and coin switched on, adds up the rows and closes with the counts', () => {
		const { fixture, popup, active } = count();
		popup.use({
			title: 'cash_open_title',
			info: 'cash_open_info',
			action: 'cash_open_action',
			denominations: DENOMS,
			start: [{ valuePaise: 50_000, kind: 'note', count: 2 }],
		});
		fixture.detectChanges();
		expect(popup.touch).toBe(false);
		expect(popup.rows().map((r) => r.count)).toEqual(['2', '', '', '']);
		popup.setCount(1, '5x');
		popup.setCount(3, '0');
		expect(popup.amount(popup.rows()[1]!)).toBe(50_000);
		expect(popup.amount(popup.rows()[3]!)).toBeNull();
		expect(popup.total()).toBe(150_000);
		popup.submit();
		expect(active.close).toHaveBeenCalledWith({
			rows: [
				{ valuePaise: 50_000, kind: 'note', count: 2 },
				{ valuePaise: 10_000, kind: 'note', count: 5 },
				{ valuePaise: 1_000, kind: 'coin', count: 0 },
				{ valuePaise: 100, kind: 'coin', count: 0 },
			],
		});
	});

	it('uses large boxes on a touch screen, and a warning with no cancel for a recount', () => {
		const { fixture, popup } = count(true);
		popup.use({ title: 't', info: 'i', tone: 'warning', action: 'a', cancel: false, denominations: DENOMS });
		fixture.detectChanges();
		expect(popup.touch).toBe(true);
		expect((fixture.nativeElement as HTMLElement).querySelector('.alert-warning')).toBeTruthy();
	});
});

describe('the petty expense pop-up (O4)', () => {
	function petty(
		check = { sheetOpen: true, withinLimit: true, billNeeded: false, limitPaise: 1_000_000 },
		pay = of({ id: 'pc_1' }),
	) {
		const active = { close: vi.fn(), dismiss: vi.fn() };
		const gateway = {
			pettyCheck: vi.fn(() =>
				of({ paidTodayPaise: 0, openedAt: '2026-11-23T04:32:00.000Z', billOverPaise: 50_000, ...check }),
			),
			pay: vi.fn((_write: unknown) => pay),
		};
		const picked = {
			result: Promise.resolve([{ assetId: 'med_bill', name: 'bill.jpg' }]),
			componentInstance: { start: vi.fn() },
		};
		const modals = { open: vi.fn(() => picked) };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			imports: [CashPettyPopup, translocoModule()],
			providers: [
				provideTanStackQuery(new QueryClient()),
				{ provide: NgbActiveModal, useValue: active },
				{ provide: NgbModal, useValue: modals },
				{ provide: CashGateway, useValue: gateway },
			],
		});
		const fixture = TestBed.createComponent(CashPettyPopup);
		fixture.componentInstance.use({
			box: BOX,
			heads: [{ id: 'led_conv', name: 'Local delivery' }],
			today: '2026-11-23',
		});
		fixture.detectChanges();
		return { fixture, popup: fixture.componentInstance, active, gateway, modals };
	}
	const fill = (popup: CashPettyPopup) => {
		popup.head.set('led_conv');
		popup.amount.set('120');
		popup.paidTo.set(' Bike courier rider ');
		popup.whatFor.set(' Urgent saree ');
	};

	it('is ready once the checks pass and the fields are filled, then pays and closes', async () => {
		const { fixture, popup, active, gateway } = petty();
		await fixture.whenStable();
		expect(popup.ready()).toBe(false);
		fill(popup);
		fixture.detectChanges();
		await vi.waitFor(() => expect(popup.ready()).toBe(true));
		await popup.pay();
		expect(gateway.pay).toHaveBeenCalledWith({
			boxId: 'box_till',
			headLedgerId: 'led_conv',
			amountPaise: 12_000,
			paidTo: 'Bike courier rider',
			whatFor: 'Urgent saree',
			billMediaId: null,
			gst: null,
		});
		expect(active.close).toHaveBeenCalledWith({ id: 'pc_1' });
	});

	it('needs a bill over the limit and a GST bill’s details, and says why a payment was refused', async () => {
		const { fixture, popup, gateway } = petty(
			{ sheetOpen: true, withinLimit: true, billNeeded: true, limitPaise: null } as never,
			throwError(() => ({ error: { issues: [{ message: 'cash_limit_exceeded' }] } })),
		);
		fill(popup);
		fixture.detectChanges();
		await vi.waitFor(() => expect(popup.checks.data()?.billNeeded).toBe(true));
		expect(popup.ready()).toBe(false);
		await popup.pickBill();
		expect(popup.bill()?.assetId).toBe('med_bill');
		popup.gstOn.set(true);
		expect(popup.ready()).toBe(false);
		popup.gstin.set('19aaaaa0000a1z5');
		popup.billNumber.set('PH/88');
		fixture.detectChanges();
		await vi.waitFor(() => expect(popup.ready()).toBe(true));
		await popup.pay();
		expect(gateway.pay.mock.calls[0]?.[0]).toMatchObject({
			billMediaId: 'med_bill',
			gst: { supplierGstin: '19AAAAA0000A1Z5', billNumber: 'PH/88', billDate: '2026-11-23', ratePercent: 18 },
		});
		expect(popup.problem()).toEqual({ key: 'cash_problem_cash_limit_exceeded', params: {} });
		expect(popup.busy()).toBe(false);
	});

	it('keeps no bill when the picker is closed, and checks nothing without a box', async () => {
		const { popup, modals } = petty();
		modals.open.mockReturnValueOnce({
			result: Promise.reject(new Error('closed')),
			componentInstance: { start: vi.fn() },
		} as never);
		await popup.pickBill();
		expect(popup.bill()).toBeNull();
		modals.open.mockReturnValueOnce({
			result: Promise.resolve([]),
			componentInstance: { start: vi.fn() },
		} as never);
		await popup.pickBill();
		expect(popup.bill()).toBeNull();
		popup.box.set(null);
		expect(popup.ready()).toBe(false);
	});
});

describe('the move pop-up', () => {
	function move(result = of({})) {
		const active = { close: vi.fn(), dismiss: vi.fn() };
		const gateway = { move: vi.fn(() => result) };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			imports: [CashMovePopup, translocoModule()],
			providers: [
				{ provide: NgbActiveModal, useValue: active },
				{ provide: CashGateway, useValue: gateway },
			],
		});
		const fixture = TestBed.createComponent(CashMovePopup);
		fixture.componentInstance.use({
			sheetId: 'sh1',
			box: BOX,
			banks: [{ id: 'led_hdfc', name: 'HDFC' }],
			boxes: [
				{ id: 'box_till', name: 'Counter till' },
				{ id: 'box_petty', name: 'Petty cash' },
			],
		});
		fixture.detectChanges();
		return { popup: fixture.componentInstance, active, gateway };
	}

	it('deposits to a bank or moves to another box, and says why it was refused', async () => {
		const { popup, active, gateway } = move();
		expect(popup.targets().map((t) => t.id)).toEqual(['led_hdfc']);
		popup.setKind('box_move');
		expect(popup.targets().map((t) => t.id)).toEqual(['box_petty']);
		expect(popup.ready()).toBe(false);
		popup.to.set('box_petty');
		popup.amount.set('200');
		popup.slip.set(' 44 ');
		popup.note.set(' change ');
		expect(popup.ready()).toBe(true);
		await popup.save();
		expect(gateway.move).toHaveBeenCalledWith('sh1', {
			kind: 'box_move',
			amountPaise: 20_000,
			toId: 'box_petty',
			slip: '44',
			note: 'change',
		});
		expect(active.close).toHaveBeenCalled();
		const refused = move(throwError(() => new Error('x')));
		refused.popup.to.set('led_hdfc');
		refused.popup.amount.set('1');
		await refused.popup.save();
		expect(refused.popup.problem()?.key).toBe('cash_failed');
	});
});
