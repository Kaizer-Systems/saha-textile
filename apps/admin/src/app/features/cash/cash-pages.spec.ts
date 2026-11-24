import { signal } from '@angular/core';
import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { CashGateway } from '@core/cash/cash.gateway';
import { LocationsGateway } from '@core/locations/locations.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { CashBoxesSettings } from '@features/setting/cash-boxes/cash-boxes';

import { CashSheetPage } from './cash-sheet-page';
import { CashClaimPage } from './claim-page';

import type { CashSheetRow } from '@saha-textile/contracts';

/** A cash sheet and its settlement (O8, O10), an expense claim (O12), and Settings › Cash boxes (O1). */

const view = (status = 'difference', differencePaise = -30_000) => ({
	sheet: {
		id: 'sh1',
		date: '2026-11-23',
		status,
		version: 3,
		differencePaise,
		expectedAtClosePaise: 671_200,
		counts: [{ totalPaise: 641_200 }, { totalPaise: 641_200 }],
		closedAt: '2026-11-23T15:11:00.000Z',
		closedLate: true,
		settlement: status === 'settled' ? { how: 'write_off', note: 'gone', suspenseUntil: '2026-12-23' } : null,
	},
	box: { id: 'box_till', name: 'Counter till' },
	locationName: 'Gariahat',
	closedByName: null,
	rows: [],
	amounts: true,
	denominations: [{ valuePaise: 50_000, kind: 'note', on: true }],
});
const claim = (patch: Record<string, unknown> = {}) => ({
	id: 'ec1',
	number: 'EC/26-27/000017',
	staffUserId: 'adm_rahul',
	staffName: 'Rahul Das',
	locationId: 'loc_gar',
	locationName: 'Gariahat',
	headName: 'Local delivery',
	amountPaise: 45_000,
	whatFor: 'Auto',
	billName: null,
	spentOn: '2026-11-21',
	status: 'waiting',
	rejectReason: null,
	version: 0,
	...patch,
});
const choices = (patch: Record<string, unknown> = {}) => ({
	boxes: [
		{ id: 'box_petty', name: 'Petty cash', locationId: 'loc_gar' },
		{ id: 'box_far', name: 'Far', locationId: 'loc_far' },
	],
	banks: [{ id: 'led_hdfc', name: 'HDFC' }],
	staff: [],
	ledgers: [],
	manager: true,
	superAdmin: false,
	userId: 'adm_meera',
	...patch,
});

function setup<T>(
	component: Type<T>,
	gateway: Record<string, unknown>,
	answers: unknown[] = [],
	permissions = ['cash.settings'],
) {
	const queue = [...answers];
	const modals = {
		open: vi.fn(() => {
			const answer = queue.shift();
			return {
				componentInstance: { use: vi.fn() },
				close: vi.fn(),
				result: answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer),
			};
		}),
	};
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
			{
				provide: LocationsGateway,
				useValue: { list: vi.fn(() => of([{ id: 'loc_gar', name: 'Gariahat' }])) },
			},
			{ provide: NgbModal, useValue: modals },
			{ provide: NotificationService, useValue: notifier },
			{ provide: AuthStore, useValue: { permissions: signal(permissions) } },
			{ provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'x1' })) } },
		],
	});
	const fixture = TestBed.createComponent(component);
	return { fixture, page: fixture.componentInstance, notifier, modals };
}

describe('a cash sheet waiting with a difference (O8)', () => {
	const gateway = (patch: Record<string, unknown> = {}) => ({
		sheet: vi.fn(() => of(view())),
		choices: vi.fn(() => of(choices())),
		settle: vi.fn(() => of({})),
		...patch,
	});

	it('offers the ways that fit the difference and needs what each one asks for', async () => {
		const { fixture, page } = setup(CashSheetPage, gateway(), [{ rows: [] }, new Error('closed')]);
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.waiting()).toBe(true));
		fixture.detectChanges();
		expect(page.difference()).toBe(-30_000);
		expect(page.applies('write_off')).toBe(true);
		expect(page.applies('excess_suspense')).toBe(false);
		expect(page.ready()).toBe(false);
		page.pick('counting_mistake');
		expect(page.ready()).toBe(false);
		await page.countAgain();
		expect(page.ready()).toBe(true);
		await page.countAgain();
		page.pick('missed_payment_out');
		expect(page.ready()).toBe(false);
		page.ledgerId.set('led_debtors');
		expect(page.ready()).toBe(true);
		page.pick('missed_money_in');
		expect(page.ready()).toBe(true);
		page.pick('banked_not_recorded');
		expect(page.depositDate()).toBe('2026-11-23');
		expect(page.ready()).toBe(false);
		page.bankLedgerId.set('led_hdfc');
		expect(page.ready()).toBe(true);
		page.depositDate.set('2026-11-22');
		page.pick('banked_not_recorded');
		expect(page.depositDate()).toBe('2026-11-22');
		page.pick('recover_from_staff');
		expect(page.ready()).toBe(false);
		page.staffUserId.set('adm_rahul');
		expect(page.ready()).toBe(true);
		page.repayBy.set('payroll');
		expect(page.ready()).toBe(false);
		page.consent.set(true);
		expect(page.ready()).toBe(true);
		page.pick('theft');
		expect(page.ready()).toBe(false);
		page.policeReport.set(' GRH/1 ');
		expect(page.ready()).toBe(true);
		page.pick('counterfeit');
		expect(page.ready()).toBe(true);
		fixture.detectChanges();
		const rows: Partial<CashSheetRow>[] = [
			{ kind: 'opening', what: 'opening' },
			{ kind: 'carried', what: '2026-11-22' },
			{ kind: 'counter_sale', what: 'Counter sale' },
		];
		expect(rows.map((r) => page.rowWhat(r as CashSheetRow))).toEqual([
			'cash_row_opening',
			'cash_row_carried',
			'Counter sale',
		]);
	});

	it('settles with only what the chosen way needs, and says why it was refused', async () => {
		const api = gateway();
		const { fixture, page, notifier } = setup(CashSheetPage, api, [
			{ rows: [{ valuePaise: 50_000, kind: 'note', count: 1 }] },
		]);
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.waiting()).toBe(true));
		const settled = async (how: string) => {
			page.pick(how as never);
			await page.resolve();
			return (api.settle.mock.calls.at(-1) as unknown[] | undefined)?.[1];
		};
		page.note.set(' typed as 300 ');
		page.ledgerId.set('led_debtors');
		page.bankLedgerId.set('led_hdfc');
		page.depositSlip.set(' 44 ');
		page.staffUserId.set('adm_rahul');
		page.consent.set(true);
		page.policeReport.set(' GRH/1 ');
		page.insured.set(true);
		page.noteDetails.set(' AB 123 ');
		await page.countAgain();
		expect(await settled('counting_mistake')).toMatchObject({
			how: 'counting_mistake',
			note: 'typed as 300',
			recount: { rows: [{ count: 1 }] },
			ledgerId: null,
			version: 3,
		});
		expect(await settled('missed_payment_out')).toMatchObject({ ledgerId: 'led_debtors', recount: null });
		expect(await settled('missed_money_in')).toMatchObject({ ledgerId: 'led_debtors' });
		expect(await settled('banked_not_recorded')).toMatchObject({
			bankLedgerId: 'led_hdfc',
			depositSlip: '44',
			depositDate: '2026-11-23',
		});
		page.depositSlip.set('');
		expect(await settled('banked_not_recorded')).toMatchObject({ depositSlip: null });
		expect(await settled('recover_from_staff')).toMatchObject({
			staffUserId: 'adm_rahul',
			repayBy: 'cash',
			consent: true,
		});
		expect(await settled('theft')).toMatchObject({ policeReport: 'GRH/1', insured: true });
		expect(await settled('counterfeit')).toMatchObject({ noteDetails: 'AB 123' });
		page.noteDetails.set('');
		expect(await settled('counterfeit')).toMatchObject({ noteDetails: null });
		expect(await settled('write_off')).toMatchObject({
			how: 'write_off',
			policeReport: null,
			insured: false,
			consent: false,
		});
		expect(notifier.showSuccess).toHaveBeenCalledWith('cash_settled');
		api.settle.mockReturnValueOnce(throwError(() => ({ error: { issues: [{ message: 'cash_sheet_changed' }] } })));
		await page.resolve();
		expect(notifier.showError).toHaveBeenCalledWith('cash_problem_cash_sheet_changed');
		page.how.set(null);
		await page.resolve();
		expect(api.settle).toHaveBeenCalledTimes(11);
	});

	it('shows a settled or open sheet without the settle form, and does nothing before it loads', async () => {
		const settled = setup(CashSheetPage, gateway({ sheet: vi.fn(() => of(view('settled', 50_000))) }));
		settled.fixture.detectChanges();
		await vi.waitFor(() => expect(settled.page.sheet.data()).toBeTruthy());
		settled.fixture.detectChanges();
		expect(settled.page.waiting()).toBe(false);
		const open = setup(
			CashSheetPage,
			gateway({
				sheet: vi.fn(() =>
					of({
						...view('open', 0),
						sheet: { ...view('open').sheet, status: 'open', closedAt: null, differencePaise: null },
					}),
				),
			}),
		);
		open.fixture.detectChanges();
		await vi.waitFor(() => expect(open.page.sheet.data()).toBeTruthy());
		open.fixture.detectChanges();
		expect(open.page.difference()).toBe(0);
		const empty = setup(CashSheetPage, gateway({ sheet: vi.fn(() => of(undefined)) }));
		expect(empty.page.difference()).toBe(0);
		await empty.page.countAgain();
		await empty.page.resolve();
		expect(empty.modals.open).not.toHaveBeenCalled();
	});
});

describe('an expense claim (O12)', () => {
	const gateway = (
		claimPatch: Record<string, unknown> = {},
		choicePatch: Record<string, unknown> = {},
		decide = vi.fn(() => of({})),
	) => ({
		claim: vi.fn(() => of(claim(claimPatch))),
		choices: vi.fn(() => of(choices(choicePatch))),
		decide,
	});

	it('approves with how it is paid back, or rejects with why', async () => {
		const api = gateway();
		const { fixture, page, notifier } = setup(CashClaimPage, api);
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.canDecide()).toBe(true));
		fixture.detectChanges();
		expect(page.boxes().map((b) => b.id)).toEqual(['box_petty']);
		expect(page.ready()).toBe(true);
		page.payBack.set('petty');
		expect(page.ready()).toBe(false);
		page.boxId.set('box_petty');
		expect(page.ready()).toBe(true);
		page.payBack.set('bank');
		expect(page.ready()).toBe(false);
		page.bankId.set('led_hdfc');
		fixture.detectChanges();
		await page.approve();
		expect(api.decide).toHaveBeenLastCalledWith('ec1', {
			decision: 'approve',
			payBack: 'bank',
			payBoxId: null,
			bankLedgerId: 'led_hdfc',
			version: 0,
		});
		page.payBack.set('petty');
		await page.approve();
		expect(api.decide).toHaveBeenLastCalledWith('ec1', {
			decision: 'approve',
			payBack: 'petty',
			payBoxId: 'box_petty',
			bankLedgerId: null,
			version: 0,
		});
		await page.reject();
		expect(api.decide).toHaveBeenCalledTimes(2);
		page.rejecting.set(true);
		fixture.detectChanges();
		page.reason.set(' No bill ');
		await page.reject();
		expect(api.decide).toHaveBeenLastCalledWith('ec1', { decision: 'reject', reason: 'No bill', version: 0 });
		expect(page.rejecting()).toBe(false);
		expect(notifier.showSuccess).toHaveBeenCalledWith('cash_claim_decided');
	});

	it('leaves decisions to managers, never one’s own claim unless the owner, and says why one was refused', async () => {
		const own = setup(CashClaimPage, gateway({ staffUserId: 'adm_meera' }));
		own.fixture.detectChanges();
		await vi.waitFor(() => expect(own.page.claim.data()).toBeTruthy());
		expect(own.page.canDecide()).toBe(false);
		const owner = setup(CashClaimPage, gateway({ staffUserId: 'adm_meera' }, { superAdmin: true }));
		owner.fixture.detectChanges();
		await vi.waitFor(() => expect(owner.page.canDecide()).toBe(true));
		const staff = setup(CashClaimPage, gateway({}, { manager: false }));
		staff.fixture.detectChanges();
		await vi.waitFor(() => expect(staff.page.choices.data()).toBeTruthy());
		expect(staff.page.canDecide()).toBe(false);
		const paid = setup(CashClaimPage, gateway({ status: 'rejected', rejectReason: 'No bill', billName: 'auto' }));
		paid.fixture.detectChanges();
		await vi.waitFor(() => expect(paid.page.claim.data()).toBeTruthy());
		paid.fixture.detectChanges();
		expect(paid.page.canDecide()).toBe(false);
		const refused = setup(
			CashClaimPage,
			gateway(
				{},
				{},
				vi.fn(() => throwError(() => new Error('x'))),
			),
		);
		refused.fixture.detectChanges();
		await vi.waitFor(() => expect(refused.page.claim.data()).toBeTruthy());
		await refused.page.approve();
		expect(refused.notifier.showError).toHaveBeenCalledWith('cash_failed');
		const none = setup(CashClaimPage, gateway());
		expect(none.page.canDecide()).toBe(false);
		expect(none.page.boxes()).toEqual([]);
		await none.page.approve();
		await none.page.reject();
	});
});

describe('Settings › Cash boxes (O1)', () => {
	const settings = {
		settings: {
			denominations: [
				{ valuePaise: 50_000, kind: 'note', on: true },
				{ valuePaise: 200_000, kind: 'note', on: false },
			],
			rules: { billPhotoOverPaise: 50_000, suspenseDays: 30, autoAcceptUpToPaise: 0 },
		},
		boxes: [
			{
				id: 'box_till',
				name: 'Counter till',
				locationId: 'loc_gar',
				kind: 'day_sheet',
				floatPaise: 200_000,
				countedBy: 'cashier',
				reviewedBy: 'location_manager',
				active: true,
			},
		],
	};

	it('loads the boxes, notes and rules, edits and adds boxes, and saves them together', async () => {
		const api = { settings: vi.fn(() => of(settings)), saveSettings: vi.fn(() => of(settings)) };
		const { fixture, page, notifier } = setup(CashBoxesSettings, api);
		expect(page.placeName('loc_gar')).toBe('—');
		fixture.detectChanges();
		await vi.waitFor(() => expect(page.boxes()).toHaveLength(1));
		fixture.detectChanges();
		expect(page.canEdit()).toBe(true);
		expect(page.bill()).toBe('500');
		expect(page.placeName('loc_gar')).toBe('Gariahat');
		expect(page.placeName('loc_none')).toBe('—');
		page.toggle(1, true);
		expect(page.denominations()[1]?.on).toBe(true);
		page.editBox({} as never, page.boxes()[0] as never);
		page.setEditing({ name: 'Front till' });
		page.float.set('2500');
		page.keepBox();
		expect(page.boxes()[0]).toMatchObject({ name: 'Front till', floatPaise: 250_000 });
		page.editBox({} as never, null);
		expect(page.editing().locationId).toBe('loc_gar');
		page.keepBox();
		expect(page.boxes()).toHaveLength(1);
		page.setEditing({ name: 'Petty cash', kind: 'fixed_float' });
		page.float.set('abc');
		page.keepBox();
		expect(page.boxes()[1]).toMatchObject({ name: 'Petty cash', floatPaise: 0 });
		page.editBox({} as never, page.boxes()[1] as never);
		page.float.set('5000');
		page.keepBox();
		expect(page.boxes().map((b) => b.floatPaise)).toEqual([250_000, 500_000]);
		page.days.set(0);
		page.bill.set('');
		page.autoAccept.set('');
		await page.save();
		const sent = (api.saveSettings.mock.calls[0] as unknown[])[0] as { boxes: { id?: string }[]; rules: unknown };
		expect(sent.boxes[0]?.id).toBe('box_till');
		expect(sent.boxes[1]?.id).toBeUndefined();
		expect(sent.rules).toEqual({ billPhotoOverPaise: 0, suspenseDays: 1, autoAcceptUpToPaise: 0 });
		expect(notifier.showSuccess).toHaveBeenCalledWith('cash_settings_saved');
	});

	it('says why a save was refused, and reads only without the permission', async () => {
		const api = {
			settings: vi.fn(() => of(settings)),
			saveSettings: vi.fn(() =>
				throwError(() => ({ error: { issues: [{ message: 'cash_no_denomination_on' }] } })),
			),
		};
		const { page, notifier } = setup(CashBoxesSettings, api, [], []);
		expect(page.canEdit()).toBe(false);
		await page.save();
		expect(notifier.showError).toHaveBeenCalledWith('cash_problem_cash_no_denomination_on');
		// No locations yet: a new box starts with none.
		TestBed.inject(LocationsGateway);
		page.editBox({} as never, null);
		expect(page.editing().locationId).toBe('');
	});
});
