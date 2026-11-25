import { describe, expect, it } from 'vitest';

import { PaymentVoucherPage } from '@features/accounts/payment-voucher-page';
import { statementLink } from '@features/purchasing/supplier/supplier-page';

import type { PaymentVoucher, SupplierStatementRow } from '@saha-textile/contracts';

/** Expense bills reached from elsewhere (brief 25 EB2): a payment voucher's "against", and a supplier's statement. */

const row = (kind: string, documentId = 'doc_1') => ({ kind, documentId }) as unknown as SupplierStatementRow;

describe('links to expense bills and their payments (EB2)', () => {
	it('opens the expense bill a payment voucher paid', () => {
		const againstLink = PaymentVoucherPage.prototype.againstLink;
		const paid = (kind: string) => ({ against: { kind, id: 'x_1' } }) as unknown as PaymentVoucher;
		expect(againstLink(paid('expenseBill'))).toEqual(['/expense-bills', 'x_1']);
		expect(againstLink(paid('selfInvoice'))).toEqual(['/accounts/self-invoices', 'x_1']);
		expect(againstLink(paid('purchaseEntry'))).toEqual(['/purchase-entries', 'x_1']);
	});

	it('opens an expense bill, or the voucher that paid it, from a supplier’s statement, cancelled ones too', () => {
		expect(statementLink(row('expense_bill'))).toEqual(['/expense-bills', 'doc_1']);
		expect(statementLink(row('expense_bill_cancelled'))).toEqual(['/expense-bills', 'doc_1']);
		expect(statementLink(row('expense_bill_payment'))).toEqual(['/accounts/payment-vouchers', 'doc_1']);
		expect(statementLink(row('expense_bill_payment_cancelled'))).toEqual(['/accounts/payment-vouchers', 'doc_1']);
	});
});
