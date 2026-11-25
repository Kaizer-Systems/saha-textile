import { describe, expect, it } from 'vitest';

import { DEFAULT_SERIES, GST_DOCUMENT_TYPES, NumberedDocumentType } from '../src/document-numbering';
import {
	ExpenseBill,
	ExpenseBillLine,
	ExpenseBillPayWrite,
	ExpenseBillStatus,
	ExpenseBillWrite,
	ExpenseCredit,
} from '../src/expense-bills';
import { SupplierStatementRow } from '../src/purchasing';
import { PaymentVoucherAgainst, SelfInvoicePayWrite } from '../src/self-invoices';

/** Bills for services and expenses with their GST credit (brief 25 EB1, EB2): a line, a bill as written, and as kept. */

const accepted = (input: unknown) => expect(input).toBe(true);
const refused = (input: unknown) => expect(input).toBe(false);
const message = (result: { error?: { issues: { message: string }[] } }) => result.error?.issues[0]?.message;

const rent = { expenseLedgerId: 'led_rent', what: ' Shop rent, November ', taxableINR: 50_000, gstRatePct: 18 };

describe('a line of an expense bill', () => {
	it('claims the credit by default, with no SAC or blocked clause until given', () => {
		expect(ExpenseCredit.options).toEqual(['claim', 'blocked']);
		expect(ExpenseBillLine.parse(rent)).toEqual({
			...rent,
			what: 'Shop rent, November',
			sac: '',
			credit: 'claim',
			blockedClause: '',
		});
	});

	it('keeps a SAC of 4, 6 or 8 digits, trimmed, and refuses any other shape', () => {
		for (const sac of ['9972', ' 997212 ', '99721200'])
			expect(ExpenseBillLine.parse({ ...rent, sac }).sac).toBe(sac.trim());
		for (const sac of ['997', '99721', '9972120', '997212000', 'SAC1'])
			expect(message(ExpenseBillLine.safeParse({ ...rent, sac }))).toBe('sac_shape');
	});

	it('marks a line blocked under a clause of s.17(5), the clause up to 10 letters', () => {
		const staffLunch = {
			...rent,
			what: 'Staff lunch',
			sac: '996331',
			gstRatePct: 5,
			credit: 'blocked',
			blockedClause: ' b ',
		};
		expect(ExpenseBillLine.parse(staffLunch)).toMatchObject({ credit: 'blocked', blockedClause: 'b' });
		refused(ExpenseBillLine.safeParse({ ...staffLunch, blockedClause: 'x'.repeat(11) }).success);
		refused(ExpenseBillLine.safeParse({ ...rent, credit: 'partial' }).success);
	});

	it('keeps the taxable value from nothing to ₹1,000 crore and the rate from 0 to 28%, and a description', () => {
		accepted(ExpenseBillLine.safeParse({ ...rent, taxableINR: 0, gstRatePct: 0 }).success);
		accepted(ExpenseBillLine.safeParse({ ...rent, taxableINR: 1e10, gstRatePct: 28 }).success);
		refused(ExpenseBillLine.safeParse({ ...rent, taxableINR: 1e10 + 1 }).success);
		refused(ExpenseBillLine.safeParse({ ...rent, taxableINR: -1 }).success);
		refused(ExpenseBillLine.safeParse({ ...rent, gstRatePct: 28.5 }).success);
		refused(ExpenseBillLine.safeParse({ ...rent, gstRatePct: -1 }).success);
		refused(ExpenseBillLine.safeParse({ ...rent, what: '  ' }).success);
		refused(ExpenseBillLine.safeParse({ ...rent, what: 'x'.repeat(201) }).success);
		refused(ExpenseBillLine.safeParse({ ...rent, expenseLedgerId: '' }).success);
	});
});

const write = {
	supplierId: 'sup_landlord',
	billNumber: ' R-1126 ',
	billDate: '2026-11-01',
	locationId: 'loc_kolkata',
	lines: [rent],
};

describe('an expense bill as written', () => {
	it('takes a supplier, a bill number trimmed, a day, the location billed to and 1 to 50 lines, with no note unless written', () => {
		const parsed = ExpenseBillWrite.parse(write);
		expect(parsed).toMatchObject({ billNumber: 'R-1126', note: '' });
		expect(parsed.lines[0]?.credit).toBe('claim');
		accepted(ExpenseBillWrite.safeParse({ ...write, lines: Array.from({ length: 50 }, () => rent) }).success);
		refused(ExpenseBillWrite.safeParse({ ...write, lines: [] }).success);
		refused(ExpenseBillWrite.safeParse({ ...write, lines: Array.from({ length: 51 }, () => rent) }).success);
		refused(ExpenseBillWrite.safeParse({ ...write, billNumber: ' ' }).success);
		refused(ExpenseBillWrite.safeParse({ ...write, billNumber: 'x'.repeat(41) }).success);
		refused(ExpenseBillWrite.safeParse({ ...write, billDate: '01-11-2026' }).success);
		refused(ExpenseBillWrite.safeParse({ ...write, locationId: '' }).success);
		expect(ExpenseBillWrite.parse({ ...write, note: ' Paid by cheque ' }).note).toBe('Paid by cheque');
		refused(ExpenseBillWrite.safeParse({ ...write, note: 'x'.repeat(501) }).success);
	});
});

describe('an expense bill as kept', () => {
	const kept = {
		...write,
		id: 'eb_1',
		status: 'draft',
		interState: false,
		taxableINR: 50_000,
		cgstINR: 4_500,
		sgstINR: 4_500,
		igstINR: 0,
		blockedTaxINR: 0,
		totalINR: 59_000,
		createdAt: '2026-11-02T05:00:00.000Z',
		updatedAt: '2026-11-02T05:00:00.000Z',
		version: 0,
	};

	it('starts a draft with no number, voucher or posting', () => {
		expect(ExpenseBillStatus.options).toEqual(['draft', 'posted', 'cancelled']);
		expect(ExpenseBill.parse(kept)).toMatchObject({
			supplierName: '',
			supplierGstin: null,
			paidINR: 0,
			paymentVouchers: [],
			cancelledAt: null,
			cancelReason: null,
			number: null,
			voucherId: null,
			postedAt: null,
			postedBy: null,
			note: '',
		});
	});

	it('keeps a posted bill’s EB number, voucher and who posted it, an inter-State one in IGST', () => {
		const posted = {
			...kept,
			billNumber: 'R-1126',
			supplierName: 'Ghosh Properties',
			lines: [ExpenseBillLine.parse(rent)],
			note: '',
			status: 'posted',
			interState: true,
			cgstINR: 0,
			sgstINR: 0,
			igstINR: 9_000,
			number: 'EB/26-27/000001',
			voucherId: 'vch_eb_1',
			postedAt: '2026-11-03T05:00:00.000Z',
			postedBy: 'adm_accountant',
			supplierGstin: '27AAAPG1234K1Z5',
			paidINR: 30_000,
			paymentVouchers: [{ id: 'pv_1', number: 'PV/26-27/000009' }],
			cancelledAt: null,
			cancelReason: null,
			version: 1,
		};
		expect(ExpenseBill.parse(posted)).toEqual(posted);
		const cancelled = {
			...posted,
			status: 'cancelled',
			cancelledAt: '2026-11-10T05:00:00.000Z',
			cancelReason: 'Billed twice',
		};
		expect(ExpenseBill.parse(cancelled)).toMatchObject({ status: 'cancelled', cancelReason: 'Billed twice' });
		refused(ExpenseBill.safeParse({ ...posted, paidINR: -1 }).success);
		refused(ExpenseBill.safeParse({ ...posted, paymentVouchers: [{ id: '', number: 'PV/26-27/000009' }] }).success);
		refused(ExpenseBill.safeParse({ ...posted, paymentVouchers: [{ id: 'pv_1' }] }).success);
	});

	it('refuses an unknown status, a version below 0 or in part, and a missing tax split', () => {
		refused(ExpenseBill.safeParse({ ...kept, status: 'paid' }).success);
		refused(ExpenseBill.safeParse({ ...kept, version: -1 }).success);
		refused(ExpenseBill.safeParse({ ...kept, version: 0.5 }).success);
		refused(ExpenseBill.safeParse({ ...kept, interState: undefined }).success);
		refused(ExpenseBill.safeParse({ ...kept, blockedTaxINR: undefined }).success);
		refused(ExpenseBill.safeParse({ ...kept, createdAt: '' }).success);
		refused(ExpenseBill.safeParse({ ...kept, id: '' }).success);
		refused(ExpenseBill.safeParse({ ...kept, supplierName: null }).success);
	});
});

describe('an expense bill’s number', () => {
	it('runs an EB series by financial year, six digits, apart from the GST documents the shop issues', () => {
		expect(NumberedDocumentType.options).toContain('expenseBill');
		expect(DEFAULT_SERIES.expenseBill).toEqual({
			prefix: 'EB',
			separator: '/',
			includeFinancialYear: true,
			digits: 6,
			reset: 'fy',
		});
		expect(GST_DOCUMENT_TYPES).not.toContain('expenseBill');
	});
});

describe('paying an expense bill (brief 25 EB2)', () => {
	it('pays it as a self-invoice is paid, with a payment voucher against the bill', () => {
		expect(ExpenseBillPayWrite).toBe(SelfInvoicePayWrite);
		const pay = { amountINR: 30_000, paidOn: '2026-11-12', mode: 'bank_transfer', version: 1 };
		expect(ExpenseBillPayWrite.parse(pay)).toEqual({ ...pay, reference: null, paidFromLedgerId: null });
		expect(message(ExpenseBillPayWrite.safeParse({ ...pay, amountINR: 0 }))).toBe('amount_positive');
		expect(PaymentVoucherAgainst.parse({ kind: 'expenseBill', id: 'eb_1', number: 'EB/26-27/000001' })).toEqual({
			kind: 'expenseBill',
			id: 'eb_1',
			number: 'EB/26-27/000001',
			detail: '',
		});
		expect(PaymentVoucherAgainst.shape.kind.options).toEqual(['selfInvoice', 'purchaseEntry', 'expenseBill']);
	});

	it('shows the bill, its cancelling, its payments and their cancelling on the supplier’s statement', () => {
		const row = {
			date: '2026-11-03',
			kind: 'expense_bill',
			documentId: 'eb_1',
			documentNumber: 'EB/26-27/000001',
			details: 'Shop rent, November',
			billINR: 59_000,
			paidOrCreditedINR: 0,
			balanceINR: 59_000,
		};
		for (const kind of [
			'expense_bill',
			'expense_bill_cancelled',
			'expense_bill_payment',
			'expense_bill_payment_cancelled',
		])
			expect(SupplierStatementRow.parse({ ...row, kind }).kind).toBe(kind);
		expect(SupplierStatementRow.shape.kind.options.slice(-4)).toEqual([
			'expense_bill',
			'expense_bill_cancelled',
			'expense_bill_payment',
			'expense_bill_payment_cancelled',
		]);
		refused(SupplierStatementRow.safeParse({ ...row, kind: 'expense_bill_refund' }).success);
	});
});
