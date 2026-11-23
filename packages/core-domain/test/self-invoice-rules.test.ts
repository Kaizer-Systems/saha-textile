import type { RcmChoice } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import {
	selfInvoiceCancelProblems,
	selfInvoiceDay,
	selfInvoiceDeadline,
	selfInvoicePosting,
	selfInvoiceProblems,
	selfInvoiceTax,
	supplierPaymentPosting,
} from '../src/invoicing/self-invoice-rules';
import { missingRoles } from '../src/ledger/roles';

/** Reverse charge (accounts brief D, Rules 47A and 52). */

const rent: RcmChoice = {
	templateCode: 'RS-RCM',
	templateVersion: 1,
	key: 'shop_rent',
	name: 'Rent of the shop (commercial property)',
	code: '997212',
	ratePercent: 18,
	expenseRole: 'rent',
	source: '13/2017',
};

describe('self-invoices (D2, D3)', () => {
	it('gives 30 days from receipt and counts the days used', () => {
		expect(selfInvoiceDeadline('2026-11-01')).toBe('2026-12-01');
		expect(selfInvoiceDay('2026-11-01', '2026-11-21')).toBe(20);
	});

	it('works the tax out at half the rate each within the State, or IGST from another State', () => {
		expect(selfInvoiceTax(60_000, 18, false)).toEqual({
			cgstINR: 5_400,
			sgstINR: 5_400,
			igstINR: 0,
			taxINR: 10_800,
			totalINR: 70_800,
		});
		expect(selfInvoiceTax(1_000.55, 5, true)).toEqual({
			cgstINR: 0,
			sgstINR: 0,
			igstINR: 50.03,
			taxINR: 50.03,
			totalINR: 1_050.58,
		});
	});

	it('refuses a supplier with a GSTIN, a "What" not on the list, and a supply received in the future', () => {
		const ok = { supplierGstin: null, choice: rent, receivedOn: '2026-11-01', today: '2026-11-21' };
		expect(selfInvoiceProblems(ok)).toEqual([]);
		expect(
			selfInvoiceProblems({
				supplierGstin: '19AAAAA0000A1Z5',
				choice: null,
				receivedOn: '2026-11-22',
				today: '2026-11-21',
			}),
		).toEqual(['supplier_has_gstin', 'not_on_reverse_charge_list', 'received_in_future']);
	});

	it('posts the expense and the input tax against the supplier and the reverse-charge tax payable', () => {
		expect(selfInvoicePosting({ rule: rent, taxableINR: 60_000, taxINR: 10_800 })).toEqual([
			{ role: 'rent', debitPaise: 6_000_000 },
			{ role: 'input_gst_rcm', debitPaise: 1_080_000 },
			{ role: 'rcm_payable', creditPaise: 1_080_000 },
			{ role: 'creditors_control', creditPaise: 6_000_000 },
		]);
		expect(selfInvoicePosting({ rule: { ...rent, ratePercent: 0 }, taxableINR: 500, taxINR: 0 })).toEqual([
			{ role: 'rent', debitPaise: 50_000 },
			{ role: 'creditors_control', creditPaise: 50_000 },
		]);
		expect(supplierPaymentPosting(60_000, { role: 'cash' })).toEqual([
			{ ledger: { role: 'creditors_control' }, debitPaise: 6_000_000 },
			{ ledger: { role: 'cash' }, creditPaise: 6_000_000 },
		]);
	});

	it('lets only a super admin cancel an unpaid issued self-invoice in a month not filed', () => {
		const issued = { status: 'issued' as const, paidINR: 0 };
		expect(selfInvoiceCancelProblems(issued, { superAdmin: true, monthFiled: false })).toEqual([]);
		expect(
			selfInvoiceCancelProblems({ status: 'draft', paidINR: 10 }, { superAdmin: false, monthFiled: true }),
		).toEqual(['self_invoice_not_issued', 'only_super_admin', 'self_invoice_paid', 'month_filed']);
	});

	it('knows the books need the supplier, both reverse-charge ledgers and cash for these documents', () => {
		expect(missingRoles({ ledgers: [], groups: [] }, 'selfInvoice')).toEqual([
			'creditors_control',
			'input_gst_rcm',
			'rcm_payable',
		]);
		expect(missingRoles({ ledgers: [], groups: [] }, 'paymentVoucher')).toEqual(['creditors_control', 'cash']);
	});
});
