import { describe, expect, it } from 'vitest';

import { SelfInvoicePayWrite, SelfInvoiceWrite } from '../src/self-invoices';

/** Reverse charge (accounts brief D): the form and the payment refuse nothing to pay. */
describe('self-invoice contracts', () => {
	it('takes a positive value for a month and refuses zero', () => {
		const write = { supplierId: 'sup_1', ruleKey: 'shop_rent', forMonth: '2026-11', receivedOn: '2026-11-01' };
		expect(SelfInvoiceWrite.parse({ ...write, taxableINR: 60_000 }).version).toBeNull();
		expect(SelfInvoiceWrite.safeParse({ ...write, taxableINR: 0 }).success).toBe(false);
		expect(SelfInvoiceWrite.safeParse({ ...write, forMonth: '2026-13', taxableINR: 1 }).success).toBe(false);
	});

	it('takes a payment with its mode, and refuses nothing paid', () => {
		const pay = { paidOn: '2026-11-21', mode: 'bank_transfer', version: 1 };
		expect(SelfInvoicePayWrite.parse({ ...pay, amountINR: 60_000 })).toMatchObject({
			reference: null,
			paidFromLedgerId: null,
		});
		expect(SelfInvoicePayWrite.safeParse({ ...pay, amountINR: 0 }).success).toBe(false);
	});
});
