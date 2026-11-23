import { describe, expect, it } from 'vitest';

import {
	bankLanding,
	billTotals,
	purchaseEntryPosting,
	purchaseReturnPosting,
	receiptLanding,
	receiptPosting,
	reversed,
	supplierPaymentFrom,
	supplierRefundPosting,
	upiLanding,
} from '../src/ledger/money-postings';

import type { MoneyLanding } from '@saha-textile/contracts';

/** Receipts and purchases in the books (Postings and Convert brief P1, P2). */

const none: MoneyLanding = {
	receivedByGateway: null,
	receivedByUpi: null,
	receivedByBank: null,
	cashOnDelivery: null,
	paidByBank: null,
	paidInCash: null,
	updatedAt: null,
	updatedBy: null,
};
const set: MoneyLanding = {
	...none,
	receivedByGateway: 'led_gw',
	receivedByUpi: 'led_hdfc',
	receivedByBank: 'led_hdfc',
	cashOnDelivery: 'led_cod',
	paidByBank: 'led_hdfc',
	paidInCash: 'led_petty',
};

describe('where money lands (P2)', () => {
	it('uses the role’s own ledger unless one is chosen; bank transfers need a bank account', () => {
		expect(['gateway', 'upi', 'cashOnDelivery'].map((m) => receiptLanding(m as never, none))).toEqual([
			{ role: 'gateway_clearing' },
			{ role: 'upi_card_clearing' },
			{ role: 'cod_receivable' },
		]);
		expect(
			['gateway', 'upi', 'cashOnDelivery', 'bankTransfer'].map((m) => receiptLanding(m as never, set)),
		).toEqual([{ id: 'led_gw' }, { id: 'led_hdfc' }, { id: 'led_cod' }, { id: 'led_hdfc' }]);
		expect(() => receiptLanding('bankTransfer', none)).toThrow('money_lands_not_set:received_by_bank');
		expect([receiptLanding('onAccount', set), receiptLanding('setOff', set)]).toEqual([null, null]);
		expect([
			supplierPaymentFrom('cash', none),
			supplierPaymentFrom('cash', set),
			supplierPaymentFrom('upi', set),
		]).toEqual([{ role: 'cash' }, { id: 'led_petty' }, { id: 'led_hdfc' }]);
		expect(() => supplierPaymentFrom('bank_transfer', none)).toThrow('money_lands_not_set:paid_by_bank');
	});
});

describe('postings (P1)', () => {
	it('posts a receipt against the advance before the invoice, and against the debt after', () => {
		expect(receiptPosting(2_600, { role: 'gateway_clearing' }, false)).toEqual([
			{ ledger: { role: 'gateway_clearing' }, debitPaise: 260_000 },
			{ ledger: { role: 'customer_advances' }, creditPaise: 260_000 },
		]);
		expect(receiptPosting(48_000, { id: 'led_hdfc' }, true)[1]).toEqual({
			ledger: { role: 'debtors_control' },
			creditPaise: 4_800_000,
		});
	});

	it('posts a bill as stock and input tax against the supplier, rounding either way, and a return the other way', () => {
		const bill = { taxableINR: 46_095.24, cgstINR: 1_152.38, sgstINR: 1_152.38, igstINR: 0, totalINR: 48_400 };
		expect(purchaseEntryPosting(bill)).toEqual([
			{ ledger: { role: 'stock_in_hand' }, debitPaise: 4_609_524 },
			{ ledger: { role: 'input_cgst' }, debitPaise: 115_238 },
			{ ledger: { role: 'input_sgst' }, debitPaise: 115_238 },
			{ ledger: { role: 'creditors_control' }, creditPaise: 4_840_000 },
		]);
		const up = purchaseEntryPosting({ taxableINR: 99.6, cgstINR: 0, sgstINR: 0, igstINR: 0, totalINR: 100 });
		expect(up[1]).toEqual({ ledger: { role: 'rounding_off' }, debitPaise: 40 });
		const down = purchaseEntryPosting({
			taxableINR: 95.24,
			cgstINR: 0,
			sgstINR: 0,
			igstINR: 4.76 + 0.2,
			totalINR: 100,
		});
		expect(down.slice(1, 3)).toEqual([
			{ ledger: { role: 'input_igst' }, debitPaise: 496 },
			{ ledger: { role: 'rounding_off' }, creditPaise: 20 },
		]);
		expect(purchaseReturnPosting(bill)[0]).toEqual({ ledger: { role: 'stock_in_hand' }, creditPaise: 4_609_524 });
		expect(reversed([{ ledger: { role: 'x' }, creditPaise: 5 }])).toEqual([
			{ ledger: { role: 'x' }, debitPaise: 5 },
		]);
	});

	it('takes a supplier’s refund into where it landed, against their account', () => {
		expect(supplierRefundPosting(500, { id: 'led_hdfc' })).toEqual([
			{ ledger: { id: 'led_hdfc' }, debitPaise: 50_000 },
			{ ledger: { role: 'creditors_control' }, creditPaise: 50_000 },
		]);
	});

	it('takes money into the bank account set, and refuses without one', () => {
		expect(bankLanding(set)).toEqual({ id: 'led_hdfc' });
		expect(() => bankLanding(none)).toThrow('money_lands_not_set:received_by_bank');
		expect([upiLanding(set), upiLanding(none)]).toEqual([{ id: 'led_hdfc' }, { role: 'upi_card_clearing' }]);
	});

	it('puts input tax that can’t be claimed into the stock cost', () => {
		const bill = { taxableINR: 1_000, cgstINR: 25, sgstINR: 25, igstINR: 0, totalINR: 1_050 };
		expect(billTotals(bill, true)).toBe(bill);
		expect(billTotals(bill, false)).toEqual({
			taxableINR: 1_050,
			cgstINR: 0,
			sgstINR: 0,
			igstINR: 0,
			totalINR: 1_050,
		});
	});
});
