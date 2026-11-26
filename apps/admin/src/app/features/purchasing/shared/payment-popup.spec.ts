import { TestBed } from '@angular/core/testing';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { SelfInvoicesGateway } from '@core/accounts/self-invoices.gateway';

import { PaymentPopup } from './payment-popup';

/** Record a payment (p11), saved with its own payment voucher (accounts brief D4, decision D5). */

const bill = {
	id: 'e1',
	number: 'PE/26-27/00031',
	billNumber: 'NWC/2241',
	totalINR: 48_400,
	paidINR: 0,
	leftINR: 48_400,
};

function setup(options: { picked?: unknown; fail?: boolean } = {}) {
	const close = vi.fn();
	const pay = vi.fn(() =>
		options.fail
			? throwError(() => ({ error: { error: { message: 'overpayment' } } }))
			: of({ entry: { id: 'e1' }, voucher: { number: 'PV/26-27/000006' } }),
	);
	const picker = { start: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [PaymentPopup, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
		providers: [
			{ provide: NgbActiveModal, useValue: { close, dismiss: vi.fn() } },
			{
				provide: NgbModal,
				useValue: {
					open: () => ({
						componentInstance: picker,
						result:
							options.picked === 'dismissed'
								? Promise.reject(new Error('dismissed'))
								: Promise.resolve(options.picked ?? null),
					}),
				},
			},
			{ provide: SelfInvoicesGateway, useValue: { payPurchaseEntry: pay } },
		],
	});
	const popup = TestBed.createComponent(PaymentPopup).componentInstance;
	return { popup, pay, close, picker };
}

describe('Record a payment with its voucher (D4)', () => {
	it('needs a bill, a good amount and a day before it saves', async () => {
		const { popup, pay } = setup();
		expect([popup.bill(), popup.leftText(), popup.canSave(), popup.amountProblem()]).toEqual([
			null,
			'₹0',
			false,
			null,
		]);
		popup.amount.set('5');
		expect(popup.amountProblem()).toBeNull();
		await popup.save();
		expect(pay).not.toHaveBeenCalled();
		popup.start([]);
		expect([popup.billId(), popup.amount()]).toEqual(['', '']);
		popup.start([bill]);
		expect([popup.amount(), popup.leftText(), popup.canSave()]).toEqual(['48400', '₹48,400', true]);
		popup.amount.set('99999');
		expect(popup.amountProblem()).toBe('payment_amount_over');
		popup.amount.set('abc');
		expect(popup.amountProblem()).toBe('payment_amount_invalid');
		await popup.save();
		expect(pay).not.toHaveBeenCalled();
		popup.amount.set('0');
		expect(popup.amountProblem()).toBe('payment_amount_invalid');
		popup.amount.set('100');
		popup.paidOn.set('');
		expect(popup.canSave()).toBe(false);
		popup.paidOn.set(popup.today);
		popup.saving.set(true);
		expect(popup.canSave()).toBe(false);
	});

	it('saves through the voucher endpoint with the proof picked from Media, and closes with the entry', async () => {
		const { popup, pay, close, picker } = setup({ picked: [{ assetId: 'ast_1', name: 'utr.png' }] });
		popup.start([bill], 'e1');
		await popup.pickProof();
		expect(picker.start).toHaveBeenCalledWith(expect.objectContaining({ accept: 'any', max: 1 }));
		expect(popup.proof()).toMatchObject({ assetId: 'ast_1' });
		popup.reference.set('  ');
		await popup.save();
		expect(pay).toHaveBeenCalledWith(
			'e1',
			expect.objectContaining({ amountINR: 48_400, reference: null, proofAssetId: 'ast_1' }),
		);
		expect(close).toHaveBeenCalledWith({ id: 'e1' });
		for (const picked of [[], 'dismissed']) {
			const other = setup({ picked });
			await other.popup.pickProof();
			expect(other.popup.proof()).toBeNull();
		}
	});

	it('keeps a refusal in the popup', async () => {
		const { popup, close } = setup({ fail: true });
		popup.start([bill]);
		await popup.save();
		expect([popup.error(), popup.saving()]).toEqual(['overpayment', false]);
		expect(close).not.toHaveBeenCalled();
	});
});
