import { ApplicationRef, CUSTOM_ELEMENTS_SCHEMA, TemplateRef, signal, type EmbeddedViewRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { Select2 } from 'ng-select2-component';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { ExpenseBillsGateway } from '@core/purchasing/expense-bills.gateway';
import { PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { ExpenseBillFormPage } from './bill-form';

import type { ExpenseBill } from '@saha-textile/contracts';

/** Paying an expense bill (brief 25 EB2): its payments, and Pay with a payment voucher issued. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const refusal = (message: string) => ({ error: { message } });
const bill = (over: Partial<ExpenseBill> = {}): ExpenseBill =>
	({
		id: 'eb_1',
		number: 'EB/26-27/000007',
		supplierId: 'sup_wb',
		supplierName: 'Bose Properties',
		billNumber: 'BP-77',
		billDate: '2026-11-20',
		locationId: 'loc_b',
		lines: [
			{
				expenseLedgerId: 'rent',
				what: 'Shop rent',
				sac: '',
				taxableINR: 50_000,
				gstRatePct: 18,
				credit: 'claim',
				blockedClause: '',
			},
		],
		note: '',
		status: 'posted',
		interState: false,
		taxableINR: 50_000,
		cgstINR: 4_500,
		sgstINR: 4_500,
		igstINR: 0,
		blockedTaxINR: 0,
		totalINR: 59_000,
		paidINR: 9_000,
		voucherId: 'jv_1',
		postedAt: null,
		postedBy: null,
		createdAt: '2026-11-20T06:00:00.000Z',
		updatedAt: '2026-11-20T06:00:00.000Z',
		version: 3,
		...over,
	}) as ExpenseBill;
const voucher = (id: string, number: string, amountINR: number) => ({
	id,
	number,
	date: '2026-11-22',
	amountINR,
	mode: 'bank_transfer',
	reference: 'NEFT 42',
});
const at = '2026-01-01T00:00:00.000Z';
const group = (id: string, systemKey: string | null) => ({
	id,
	systemKey,
	parentId: null,
	name: id,
	nature: 'asset',
	order: 0,
	createdAt: at,
	updatedAt: at,
});
const CHART = (banks: number) => ({
	groups: [group('g_bank', 'bank_accounts'), group('g_cash', 'cash_in_hand')],
	ledgers: [
		{ id: 'hdfc', name: 'HDFC current', groupId: 'g_bank', active: true },
		...(banks > 1 ? [{ id: 'sbi', name: 'SBI savings', groupId: 'g_bank', active: true }] : []),
		{ id: 'cash', name: 'Cash', groupId: 'g_cash', active: true },
	],
});

interface Popup {
	close: ReturnType<typeof vi.fn>;
	dismiss: ReturnType<typeof vi.fn>;
	view: EmbeddedViewRef<unknown>;
}

function mount(
	options: { bill?: ExpenseBill; permissions?: string[]; banks?: number; gateway?: Record<string, unknown> } = {},
) {
	TestBed.resetTestingModule();
	document.body.querySelectorAll('.ebp-test-modal').forEach((node) => node.remove());
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	let current = options.bill ?? bill();
	const gateway = {
		get: vi.fn(() => of(current)),
		form: vi.fn(() =>
			of({
				locations: [
					{ id: 'loc_b', name: 'Barasat', stateCode: '19', gstin: '19DBYPS6736R1ZZ', composition: false },
				],
				ledgers: [],
			}),
		),
		paymentVouchers: vi.fn(() => of([voucher('pv_1', 'PV/26-27/000011', 9_000)])),
		pay: vi.fn((id: string, write: { amountINR: number }) => {
			current = { ...current, paidINR: current.paidINR + write.amountINR, version: current.version + 1 };
			return of({ bill: current, voucher: voucher('pv_2', 'PV/26-27/000012', write.amountINR) });
		}),
		...options.gateway,
	} as Record<string, ReturnType<typeof vi.fn>>;
	const chart = vi.fn(() => of(CHART(options.banks ?? 2)));
	const popups: Popup[] = [];
	TestBed.configureTestingModule({
		imports: [
			ExpenseBillFormPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			provideRouter([]),
			{ provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'eb_1' })) } },
			{ provide: ExpenseBillsGateway, useValue: gateway },
			{ provide: LedgerGateway, useValue: { chart } },
			{
				provide: PurchasingGateway,
				useValue: {
					suppliers: vi.fn(() =>
						of({
							items: [
								{
									id: 'sup_wb',
									shortName: 'Bose',
									legalName: 'Bose Properties',
									gstin: '19AAPFU0939F1ZV',
									stateName: 'West Bengal',
									active: true,
								},
							],
							total: 1,
						}),
					),
				},
			},
			{ provide: NotificationService, useValue: notifier },
			{
				provide: AuthStore,
				useValue: {
					permissions: signal(
						options.permissions ?? ['accounts.index', 'accounts.edit', 'accounts.post', 'purchase.payment'],
					),
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
						holder.className = 'ebp-test-modal';
						holder.append(...(view.rootNodes as Node[]));
						document.body.append(holder);
						popups.push({ ...ref, view });
						return ref;
					}),
				},
			},
		],
	});
	TestBed.overrideComponent(ExpenseBillFormPage, {
		remove: { imports: [Select2] },
		add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
	});
	const fixture = TestBed.createComponent(ExpenseBillFormPage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, notifier, gateway, chart, popups };
}
async function opened(options: Parameters<typeof mount>[0] = {}) {
	const harness = mount(options);
	await settle(harness.fixture);
	return harness;
}

const el = <T extends HTMLElement = HTMLElement>(fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as T | null;
const modal = <T extends HTMLElement = HTMLElement>(selector: string) =>
	document.querySelector(`.ebp-test-modal ${selector}`) as T | null;
const enter = async (popup: Popup, box: Element | null, value: string) => {
	(box as HTMLInputElement).value = value;
	box?.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
	popup.view.detectChanges();
	await new Promise((resolve) => setTimeout(resolve, 0));
	popup.view.detectChanges();
};

describe('an expense bill’s payments (EB2)', () => {
	it('lists the payment vouchers of a posted bill, with what is still owed and Pay, and no Cancel once paid', async () => {
		const { fixture, page, gateway } = await opened();
		expect(gateway['paymentVouchers']).toHaveBeenCalledWith('eb_1');
		expect(el(fixture, 'a[href="/accounts/payment-vouchers/pv_1"]')?.textContent?.trim()).toBe('PV/26-27/000011');
		expect([page.owed(), page.canPay()]).toEqual([50_000, true]);
		expect(el(fixture, '#eb_pay_open')).not.toBeNull();
		expect(el(fixture, '#eb_cancel')).toBeNull();
	});

	it('offers no Pay for a draft, a bill paid in full, or someone who may not pay, and no payments card on a draft', async () => {
		const draft = await opened({ bill: bill({ status: 'draft', number: null, paidINR: 0 }) });
		expect([draft.page.canPay(), el(draft.fixture, '#eb_pay_open')]).toEqual([false, null]);
		expect(el(draft.fixture, 'a[href^="/accounts/payment-vouchers/"]')).toBeNull();
		const paid = await opened({ bill: bill({ paidINR: 59_000 }) });
		expect([paid.page.owed(), paid.page.canPay()]).toEqual([0, false]);
		const clerk = await opened({ permissions: ['accounts.index', 'accounts.post'] });
		expect(clerk.page.canPay()).toBe(false);
		const unpaid = await opened({ bill: bill({ paidINR: 0 }) });
		expect(el(unpaid.fixture, '#eb_cancel')).not.toBeNull();
	});

	it('owes nothing before the bill is read', () => {
		const { page } = mount({ gateway: { get: vi.fn(() => of()) } });
		expect(page.owed()).toBe(0);
	});
});

describe('paying an expense bill (EB2)', () => {
	it('opens with what is owed, today and a bank transfer, reads the banks once, and asks which bank when there are several', async () => {
		const { fixture, page, chart, popups } = await opened();
		page.reference.set('old');
		(el(fixture, '#eb_pay_open') as HTMLButtonElement).click();
		await settle(fixture);
		const popup = popups[0] as Popup;
		expect([page.amount(), page.paidOn(), page.mode(), page.reference(), page.paidFrom()]).toEqual([
			'50000',
			page.today,
			'bank_transfer',
			'',
			'',
		]);
		expect(page.banks().map((l) => l.id)).toEqual(['hdfc', 'sbi']);
		expect(page.choosesBank()).toBe(true);
		popup.view.detectChanges();
		expect(modal('#eb_pay_from')).not.toBeNull();
		expect(page.canConfirm()).toBe(false);
		await enter(popup, modal('#eb_pay_from'), 'sbi');
		expect(page.canConfirm()).toBe(true);
		await enter(popup, modal('#eb_pay_mode'), 'cash');
		expect([page.choosesBank(), modal('#eb_pay_from')]).toEqual([false, null]);
		(el(fixture, '#eb_pay_open') as HTMLButtonElement).click();
		await settle(fixture);
		expect([chart.mock.calls.length, popups.length, page.mode()]).toEqual([1, 2, 'bank_transfer']);
	});

	it('pays part or all of what is owed on a day, never more, nor nothing, nor without a day', async () => {
		const { fixture, page, popups } = await opened({ banks: 1 });
		(el(fixture, '#eb_pay_open') as HTMLButtonElement).click();
		await settle(fixture);
		const popup = popups[0] as Popup;
		expect([page.choosesBank(), page.settles(), page.canConfirm()]).toEqual([false, true, true]);
		await enter(popup, modal('#eb_pay_amount'), '20,000');
		expect([page.amountValue(), page.settles(), page.canConfirm()]).toEqual([20_000, false, true]);
		expect(document.querySelector('.ebp-test-modal')?.textContent).toContain('eb_pay_part');
		await enter(popup, modal('#eb_pay_amount'), '50000.01');
		expect(page.canConfirm()).toBe(false);
		await enter(popup, modal('#eb_pay_amount'), '0');
		expect(page.canConfirm()).toBe(false);
		await enter(popup, modal('#eb_pay_amount'), 'lots');
		expect([page.amountValue(), page.settles(), page.canConfirm()]).toEqual([null, false, false]);
		await enter(popup, modal('#eb_pay_amount'), '20000');
		await enter(popup, modal('#eb_pay_paid_on'), '');
		expect(page.canConfirm()).toBe(false);
		await enter(popup, modal('#eb_pay_paid_on'), '2026-11-24');
		page.busy.set(true);
		expect(page.canConfirm()).toBe(false);
	});

	it('pays from the bank picked with the reference typed, closes the pop-up and names the voucher', async () => {
		const { fixture, page, gateway, notifier, popups } = await opened();
		(el(fixture, '#eb_pay_open') as HTMLButtonElement).click();
		await settle(fixture);
		const popup = popups[0] as Popup;
		await enter(popup, modal('#eb_pay_amount'), '20000');
		await enter(popup, modal('#eb_pay_paid_on'), '2026-11-24');
		await enter(popup, modal('#eb_pay_reference'), '  NEFT 77 ');
		await enter(popup, modal('#eb_pay_from'), 'hdfc');
		(modal('#eb_pay_confirm') as HTMLButtonElement).click();
		await settle(fixture);
		expect(gateway['pay']).toHaveBeenCalledWith('eb_1', {
			amountINR: 20_000,
			paidOn: '2026-11-24',
			mode: 'bank_transfer',
			reference: 'NEFT 77',
			paidFromLedgerId: 'hdfc',
			version: 3,
		});
		expect(popup.close).toHaveBeenCalled();
		expect(notifier.showSuccess).toHaveBeenCalledWith('eb_paid_done');
		expect(page.owed()).toBe(30_000);
	});

	it('pays in cash with no bank and no reference, and names a refusal keeping the pop-up open', async () => {
		const pay = vi.fn(() => throwError(() => refusal('overpayment')));
		const { fixture, page, notifier, popups } = await opened({ gateway: { pay } });
		(el(fixture, '#eb_pay_open') as HTMLButtonElement).click();
		await settle(fixture);
		const popup = popups[0] as Popup;
		await enter(popup, modal('#eb_pay_mode'), 'cash');
		page.amount.set('nothing');
		await page.pay(page.bill.data() as ExpenseBill);
		expect(pay).toHaveBeenCalledWith(
			'eb_1',
			expect.objectContaining({ amountINR: 0, mode: 'cash', reference: null, paidFromLedgerId: null }),
		);
		expect(notifier.showError).toHaveBeenCalledWith('eb_problem_overpayment');
		expect(popup.close).not.toHaveBeenCalled();
		(document.querySelector('.ebp-test-modal .btn-close') as HTMLButtonElement).click();
		expect(popup.dismiss).toHaveBeenCalled();
	});
});

describe('opening Pay when the banks cannot be read (EB2)', () => {
	it('says why and opens nothing', async () => {
		const { fixture, page, chart, notifier, popups } = await opened();
		chart.mockReturnValueOnce(throwError(() => refusal('payment_needs_a_bank_ledger')) as never);
		(el(fixture, '#eb_pay_open') as HTMLButtonElement).click();
		await settle(fixture);
		expect(notifier.showError).toHaveBeenCalledWith('eb_problem_payment_needs_a_bank_ledger');
		expect([popups.length, page.banks()]).toEqual([0, []]);
	});
});
