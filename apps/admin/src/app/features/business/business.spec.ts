import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { BusinessesGateway } from '@core/business/businesses.gateway';
import { PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { BusinessForm } from './business-form';
import { businessFilterQuery, toBusinessRow } from './business-list';
import { statementCsv } from './business-page';
import { BusinessReceiptPopup, oldestFirst } from './business-receipt-popup';
import { BusinessSetOffPopup, standingAgreement } from './business-setoff-popup';
import { BusinessStandingPopup } from './business-standing-popup';

import type { Business, BusinessListRow } from '@saha-textile/contracts';

vi.mock('@core/business/businesses.gateway', async (original) => ({
	...(await original<typeof import('@core/business/businesses.gateway')>()),
	injectZoneChoicesQuery: () => ({
		data: signal([
			{ id: 'zone_w', name: 'Wholesale', system: false, status: 'live' },
			{ id: 'zone_retail', name: 'RETAIL', system: true, status: 'live' },
		]),
	}),
}));

const t = (key: string, params?: object) => (params ? `${key}:${JSON.stringify(params)}` : key);

const row = (over: Partial<BusinessListRow> = {}): BusinessListRow => ({
	id: 'biz_1',
	legalName: 'Bose Textiles Pvt Ltd',
	tradeName: 'Bose Boutique',
	gstin: '19AABCB1234F1Z5',
	stateName: 'West Bengal',
	sellsToUs: false,
	buysFromUs: true,
	zone: { id: 'zone_retail', code: 'RETAIL', name: 'RETAIL' },
	creditLimitINR: 200_000,
	creditUsedINR: 60_000,
	owesUsINR: 60_000,
	weOweINR: 0,
	standing: 'creditOnHold',
	active: true,
	...over,
});

describe('businesses list (bz01)', () => {
	it('draws roles, credit, both balances and standing, escaping names', () => {
		const drawn = toBusinessRow(row({ tradeName: '<b>Bose</b>' }), t);
		expect(drawn.business).toContain('&lt;b&gt;Bose&lt;/b&gt;');
		expect(drawn.roles).toContain('biz_buys_from_us');
		expect(drawn.roles).not.toContain('biz_sells_to_us');
		expect(drawn.credit).toContain('biz_credit_used_of');
		expect(drawn.standing).toContain('status-pending');
		const supplierOnly = toBusinessRow(
			row({ buysFromUs: false, sellsToUs: true, weOweINR: 38_200, standing: null }),
			t,
		);
		expect(supplierOnly.credit).toContain('biz_not_a_customer');
		expect(supplierOnly.weOwe).toContain('38,200');
	});

	it('turns each filter into the list query', () => {
		expect(businessFilterQuery('all')).toEqual({ role: 'all' });
		expect(businessFilterQuery('supplier')).toEqual({ role: 'supplier' });
		expect(businessFilterQuery('blocked')).toEqual({ role: 'customer', standing: 'blocked' });
	});

	it('exports a statement as CSV with debits and credits apart', () => {
		const csv = statementCsv(
			[
				{
					at: '2026-11-04T05:00:00.000Z',
					documentNumber: 'ST-2611-482190',
					kind: 'orderOnAccount',
					amountINR: 26_000,
					balanceINR: 26_000,
					dueOn: '2026-11-19',
				},
				{
					at: '2026-11-12T05:00:00.000Z',
					documentNumber: 'RC/26-27/000003',
					kind: 'receipt',
					amountINR: -26_000,
					balanceINR: 0,
					dueOn: null,
				},
			] as never,
			['Date', 'Document', 'Debit', 'Credit', 'Balance', 'Due'],
		);
		expect(csv.split('\n')).toEqual([
			'"Date","Document","Debit","Credit","Balance","Due"',
			'"2026-11-04","ST-2611-482190","26000","","26000","2026-11-19"',
			'"2026-11-12","RC/26-27/000003","","26000","0",""',
		]);
	});
});

describe('business form (bz02)', () => {
	function form(permissions: string[] = ['business.assign', 'business.approve']) {
		const gateway = {
			save: vi.fn((_id: string | null, body: unknown) => of({ id: 'biz_9', ...(body as object) })),
			setStanding: vi.fn(),
		};
		const router = { navigate: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: BusinessesGateway, useValue: gateway },
				{
					provide: PurchasingGateway,
					useValue: { states: () => of([{ code: '19', name: 'West Bengal' }]), checkGstin: () => of(null) },
				},
				{ provide: NotificationService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
				{ provide: TranslocoService, useValue: { translate: (key: string) => key, getActiveLang: () => 'en' } },
				{ provide: QueryClient, useValue: { invalidateQueries: vi.fn() } },
				{ provide: NgbModal, useValue: { open: vi.fn() } },
				{ provide: AuthStore, useValue: { permissions: () => permissions } },
				{ provide: Router, useValue: router },
				{ provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({}) } } },
			],
		});
		TestBed.overrideComponent(BusinessForm, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(BusinessForm);
		return { page: fixture.componentInstance, gateway, router };
	}

	it('sends the customer side with its zone and the accounts contact, and no supplier fields when it doesn’t sell to us', async () => {
		const { page, gateway, router } = form();
		page.form.patchValue({
			legalName: 'Bose Textiles Pvt Ltd',
			tradeName: 'Bose Boutique',
			kind: 'unregistered',
			line: '41 Gariahat Road',
			city: 'Kolkata',
			pin: '700029',
			creditLimitINR: 200_000,
			creditDays: 30,
			zoneId: 'zone_w',
		});
		page.contacts.at(0).patchValue({ name: 'Sumita Bose', email: 'accounts@example.test', mobile: '9830055667' });
		expect(page.canSave()).toBe(true);
		await page.save();
		expect(gateway.save).toHaveBeenCalledWith(
			null,
			expect.objectContaining({
				customer: { zoneId: 'zone_w', creditLimitINR: 200_000, creditDays: 30 },
				supplier: null,
				sellsToUs: false,
				contacts: [
					expect.objectContaining({
						name: 'Sumita Bose',
						isAccounts: true,
						mobile: { countryCallingCode: '91', number: '9830055667' },
					}),
				],
			}),
		);
		expect(router.navigate).toHaveBeenCalledWith(['/businesses', 'biz_9']);
	});

	it('needs a role, and keeps one accounts contact', () => {
		const { page } = form();
		page.form.patchValue({ legalName: 'X', kind: 'unregistered', line: 'A', pin: '700029', buysFromUs: false });
		expect(page.canSave()).toBe(false);
		page.addContact();
		page.setAccounts(1);
		expect(page.contacts.controls.map((group) => group.value.isAccounts)).toEqual([false, true]);
	});
});

describe('change standing (bz05)', () => {
	it('needs a different standing and a reason', async () => {
		const gateway = { setStanding: vi.fn(() => of({ id: 'biz_1' })) };
		const modal = { close: vi.fn(), dismiss: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: BusinessesGateway, useValue: gateway },
				{ provide: NgbActiveModal, useValue: modal },
				{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
			],
		});
		TestBed.overrideComponent(BusinessStandingPopup, { set: { imports: [], template: '' } });
		const popup = TestBed.createComponent(BusinessStandingPopup).componentInstance;
		popup.start({ id: 'biz_1', roles: { customer: { standing: 'active' } } } as Business);
		expect(popup.canSave()).toBe(false);
		popup.standing.set('creditOnHold');
		popup.reason.set('Two payments late');
		expect(popup.canSave()).toBe(true);
		await popup.save();
		expect(gateway.setStanding).toHaveBeenCalledWith('biz_1', {
			standing: 'creditOnHold',
			reason: 'Two payments late',
		});
		expect(modal.close).toHaveBeenCalled();
	});
});

describe('record a receipt (bz06)', () => {
	const open = [
		{
			orderId: 'b',
			orderNumber: 'ST-2611-000002',
			placedAt: '2026-11-15T06:00:00.000Z',
			dueOn: '2026-11-30',
			dueINR: 30_000,
		},
		{
			orderId: 'a',
			orderNumber: 'ST-2611-000001',
			placedAt: '2026-11-04T06:00:00.000Z',
			dueOn: '2026-11-19',
			dueINR: 20_000,
		},
	];

	it('fills the oldest open orders first', () => {
		expect(oldestFirst(open, 35_000).map((row) => [row.order.orderId, row.amount])).toEqual([
			['a', '20000'],
			['b', '15000'],
		]);
	});

	it('keeps a split changed by hand, refuses one above the receipt, and sends it', async () => {
		const gateway = { openOrders: vi.fn(() => of(open)), recordReceipt: vi.fn(() => of({ id: 'led_1' })) };
		const modal = { close: vi.fn(), dismiss: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: BusinessesGateway, useValue: gateway },
				{ provide: NgbActiveModal, useValue: modal },
				{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
			],
		});
		TestBed.overrideComponent(BusinessReceiptPopup, { set: { imports: [], template: '' } });
		const popup = TestBed.createComponent(BusinessReceiptPopup).componentInstance;
		await popup.start({ id: 'biz_1', legalName: 'Kolkata stores' } as Business);
		popup.setAmount('18400');
		popup.reference.set('SBIN52026112000981');
		expect(popup.shares().map((row) => row.amount)).toEqual(['18400', '']);
		popup.setShare(0, '');
		popup.setShare(1, '18400');
		expect(popup.canSave()).toBe(true);
		popup.setShare(0, '100');
		expect(popup.canSave()).toBe(false);
		popup.setShare(0, '');
		await popup.save();
		expect(gateway.recordReceipt).toHaveBeenCalledWith(
			'biz_1',
			expect.objectContaining({ amountINR: 18_400, allocations: [{ orderId: 'b', amountINR: 18_400 }] }),
		);
		expect(modal.close).toHaveBeenCalled();
	});
});

describe('set-off (so01–so03)', () => {
	const agreement = {
		mode: 'agreement',
		reference: 'STS/2026/04',
		signedOn: '2026-04-01',
		validUntil: '2027-03-31',
		mediaId: 'med_1',
	};

	it('uses the standing agreement only while it is valid', () => {
		expect(standingAgreement({ setOff: agreement } as Business, '2026-11-20')).toMatchObject({
			reference: 'STS/2026/04',
		});
		expect(standingAgreement({ setOff: agreement } as Business, '2027-04-02')).toBeNull();
		expect(standingAgreement({ setOff: { mode: 'never' } } as Business, '2026-11-20')).toBeNull();
	});

	it('caps the amount at the smaller balance and needs a note, then records it under the agreement', async () => {
		const gateway = { recordSetOff: vi.fn(() => of({})) };
		const modal = { close: vi.fn(), dismiss: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: BusinessesGateway, useValue: gateway },
				{ provide: NgbActiveModal, useValue: modal },
				{ provide: NgbModal, useValue: { open: vi.fn() } },
				{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
			],
		});
		TestBed.overrideComponent(BusinessSetOffPopup, { set: { imports: [], template: '' } });
		const popup = TestBed.createComponent(BusinessSetOffPopup).componentInstance;
		popup.start({ id: 'biz_1', setOff: agreement } as Business, { theyOweUsINR: 18_400, weOweThemINR: 124_500 });
		expect(popup.amount()).toBe('18400');
		expect(popup.canSave()).toBe(false);
		popup.note.set('Settles an order against a purchase entry');
		expect(popup.canSave()).toBe(true);
		popup.amount.set('18401');
		expect(popup.canSave()).toBe(false);
		popup.amount.set('18400');
		await popup.save();
		expect(gateway.recordSetOff).toHaveBeenCalledWith(
			'biz_1',
			expect.objectContaining({ amountINR: 18_400, basis: { kind: 'standingAgreement' } }),
		);
		expect(popup.afterUs()).toBe(0);
		expect(popup.afterThem()).toBe(106_100);
	});
});
