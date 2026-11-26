import { TestBed } from '@angular/core/testing';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { LedgerGateway } from '@core/accounts/ledger.gateway';
import { SelfInvoicesGateway } from '@core/accounts/self-invoices.gateway';
import { ExpenseBillsGateway } from '@core/purchasing/expense-bills.gateway';

import { PaymentPopup, type PayableBill } from './payment-popup';

/** Record a payment from the supplier page against an expense bill (brief 25 EB2), beside purchase entries. */

const flush = async () => {
	for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const refusal = (message: string) => ({ error: { message } });
const ENTRY: PayableBill = {
	id: 'pe_1',
	number: 'PE/26-27/00031',
	billNumber: 'NWC/2241',
	totalINR: 48_400,
	paidINR: 0,
	leftINR: 48_400,
};
const EXPENSE: PayableBill = {
	id: 'eb_1',
	number: 'EB/26-27/000007',
	billNumber: 'BP-77',
	totalINR: 59_000,
	paidINR: 9_000,
	leftINR: 50_000,
	expenseBillVersion: 4,
};
const at = '2026-01-01T00:00:00.000Z';
const group = (id: string, systemKey: string) => ({
	id,
	systemKey,
	parentId: null,
	name: id,
	nature: 'asset',
	order: 0,
	createdAt: at,
	updatedAt: at,
});
const chartWith = (banks: string[]) => ({
	groups: [group('g_bank', 'bank_accounts')],
	ledgers: banks.map((id) => ({ id, name: id.toUpperCase(), groupId: 'g_bank', active: true })),
});

function setup(
	options: {
		chart?: ReturnType<typeof vi.fn>;
		pay?: ReturnType<typeof vi.fn>;
		payEntry?: ReturnType<typeof vi.fn>;
	} = {},
) {
	const close = vi.fn();
	const chart = options.chart ?? vi.fn(() => of(chartWith(['hdfc', 'sbi'])));
	const pay =
		options.pay ??
		vi.fn(() => of({ bill: { id: 'eb_1', paidINR: 59_000 }, voucher: { number: 'PV/26-27/000012' } }));
	const payPurchaseEntry =
		options.payEntry ?? vi.fn(() => of({ entry: { id: 'pe_1' }, voucher: { number: 'PV/26-27/000013' } }));
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			PaymentPopup,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			{ provide: NgbActiveModal, useValue: { close, dismiss: vi.fn() } },
			{ provide: NgbModal, useValue: { open: vi.fn() } },
			{ provide: SelfInvoicesGateway, useValue: { payPurchaseEntry } },
			{ provide: ExpenseBillsGateway, useValue: { pay } },
			{ provide: LedgerGateway, useValue: { chart } },
		],
	});
	const fixture = TestBed.createComponent(PaymentPopup);
	fixture.detectChanges();
	const redraw = async () => {
		await flush();
		fixture.detectChanges();
		await flush();
		fixture.detectChanges();
	};
	return { fixture, popup: fixture.componentInstance, close, chart, pay, payPurchaseEntry, redraw };
}

const el = <T extends HTMLElement = HTMLElement>(fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as T | null;
const enter = async (redraw: () => Promise<void>, box: Element | null, value: string) => {
	(box as HTMLInputElement).value = value;
	box?.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
	await redraw();
};

describe('paying an expense bill from the payment pop-up (EB2)', () => {
	it('reads the banks only when an expense bill is among the bills, and asks which bank when there are several', async () => {
		const entries = setup();
		entries.popup.start([ENTRY]);
		await entries.redraw();
		expect(entries.chart).not.toHaveBeenCalled();
		expect([entries.popup.isExpenseBill(), entries.popup.choosesBank()]).toEqual([false, false]);
		expect(el(entries.fixture, '#payment_paid_from')).toBeNull();
		expect(entries.fixture.nativeElement.textContent).toContain('payment_proof');

		const { fixture, popup, chart, redraw } = setup();
		popup.start([ENTRY, EXPENSE], 'eb_1');
		await redraw();
		expect(chart).toHaveBeenCalledTimes(1);
		expect([popup.isExpenseBill(), popup.choosesBank(), popup.amount()]).toEqual([true, true, '50000']);
		expect(
			[...(el<HTMLSelectElement>(fixture, '#payment_paid_from')?.options ?? [])].map((o) => o.value),
		).toContain('sbi');
		expect(fixture.nativeElement.textContent).not.toContain('payment_proof');
		expect(popup.canSave()).toBe(false);
		await enter(redraw, el(fixture, '#payment_paid_from'), 'sbi');
		expect(popup.canSave()).toBe(true);
		await enter(redraw, el(fixture, '#payment_mode'), 'cash');
		expect([popup.choosesBank(), el(fixture, '#payment_paid_from')]).toEqual([false, null]);
	});

	it('pays an expense bill through its own route with the bank picked and its version, and closes with the bill', async () => {
		const { fixture, popup, pay, close, redraw } = setup();
		popup.start([EXPENSE]);
		await redraw();
		await enter(redraw, el(fixture, '#payment_amount'), '20000');
		await enter(redraw, el(fixture, '#payment_paid_on'), '2026-11-24');
		await enter(redraw, el(fixture, '#payment_reference'), '  NEFT 77 ');
		await enter(redraw, el(fixture, '#payment_paid_from'), 'hdfc');
		(el(fixture, '#payment_save') as HTMLButtonElement).click();
		await redraw();
		expect(pay).toHaveBeenCalledWith('eb_1', {
			amountINR: 20_000,
			paidOn: '2026-11-24',
			mode: 'bank_transfer',
			reference: 'NEFT 77',
			paidFromLedgerId: 'hdfc',
			version: 4,
		});
		expect(close).toHaveBeenCalledWith({ id: 'eb_1', paidINR: 59_000 });
	});

	it('pays with no bank when there is only one, or the chart could not be read', async () => {
		const one = setup({ chart: vi.fn(() => of(chartWith(['hdfc']))) });
		one.popup.start([EXPENSE]);
		await one.redraw();
		expect(one.popup.choosesBank()).toBe(false);
		await one.popup.save();
		expect(one.pay).toHaveBeenCalledWith(
			'eb_1',
			expect.objectContaining({ paidFromLedgerId: null, reference: null }),
		);
		const failed = setup({ chart: vi.fn(() => throwError(() => new Error('down'))) });
		failed.popup.start([EXPENSE]);
		await failed.redraw();
		expect([failed.popup.banks(), failed.popup.canSave()]).toEqual([[], true]);
	});

	it('words an expense bill’s refusal, shows any other message as it came, and stays open', async () => {
		const pay = vi
			.fn()
			.mockReturnValueOnce(throwError(() => refusal('payment_choose_bank_ledger')))
			.mockReturnValueOnce(throwError(() => refusal('Supplier on hold')));
		const { fixture, popup, close, redraw } = setup({ pay, chart: vi.fn(() => of(chartWith(['hdfc']))) });
		popup.start([EXPENSE]);
		await redraw();
		await popup.save();
		await redraw();
		expect(popup.error()).toBe('eb_problem_payment_choose_bank_ledger');
		expect(fixture.nativeElement.textContent).toContain('eb_problem_payment_choose_bank_ledger');
		await popup.save();
		expect(popup.error()).toBe('Supplier on hold');
		expect([close.mock.calls.length, popup.saving()]).toEqual([0, false]);
	});

	it('pays a purchase entry the old way, with its proof, and shows its refusal as it came, even a known code', async () => {
		const payEntry = vi
			.fn()
			.mockReturnValueOnce(throwError(() => refusal('overpayment')))
			.mockReturnValueOnce(of({ entry: { id: 'pe_1' }, voucher: { number: 'PV/26-27/000013' } }));
		const { popup, close, payPurchaseEntry } = setup({ payEntry });
		popup.start([ENTRY, EXPENSE]);
		popup.proof.set({ assetId: 'asset_9', name: 'neft.png' } as never);
		await popup.save();
		expect(popup.error()).toBe('overpayment');
		await popup.save();
		expect(payPurchaseEntry).toHaveBeenLastCalledWith('pe_1', expect.objectContaining({ proofAssetId: 'asset_9' }));
		expect(close).toHaveBeenCalledWith({ id: 'pe_1' });
	});
});
