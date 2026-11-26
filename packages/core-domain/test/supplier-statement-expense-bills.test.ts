import { describe, expect, it } from 'vitest';

import { supplierStatement } from '../src/purchasing/supplier-account';

/** Expense bills on the supplier's statement (brief 25 EB2): owed like a purchase bill, settled by payment vouchers. */

const bill = (patch: Record<string, unknown> = {}) =>
	({
		id: 'eb_1',
		number: 'EB/26-27/000001',
		billNumber: 'LP/26/1104',
		billDate: '2026-11-04',
		totalINR: 31_600,
		cancelledAt: null,
		cancelReason: null,
		...patch,
	}) as never;
const voucher = (patch: Record<string, unknown> = {}) =>
	({
		id: 'pv_9',
		number: 'PV/26-27/000009',
		date: '2026-11-10',
		amountINR: 20_000,
		against: { kind: 'expenseBill', id: 'eb_1', number: 'EB/26-27/000001' },
		cancelledAt: null,
		cancelReason: null,
		...patch,
	}) as never;

describe('expense bills on the supplier statement', () => {
	it('owes the bill, takes off its payments, and puts back what is cancelled', () => {
		const rows = supplierStatement({
			entries: [],
			payments: [],
			returns: [],
			expenseBills: [
				bill(),
				bill({ id: 'eb_draft', number: null }),
				bill({
					id: 'eb_2',
					number: 'EB/26-27/000002',
					billNumber: 'SW/1',
					billDate: '2026-11-05',
					totalINR: 1_180,
					cancelledAt: '2026-11-06T10:00:00.000Z',
					cancelReason: 'Wrong supplier',
				}),
				bill({
					id: 'eb_3',
					number: 'EB/26-27/000003',
					billNumber: 'SW/2',
					billDate: '2026-11-07',
					totalINR: 100,
					cancelledAt: '2026-11-08T10:00:00.000Z',
				}),
			],
			selfInvoicePayments: [
				voucher(),
				voucher({
					id: 'pv_10',
					number: 'PV/26-27/000010',
					date: '2026-11-11',
					amountINR: 500,
					cancelledAt: '2026-11-12T10:00:00.000Z',
					cancelReason: 'Paid twice',
				}),
				voucher({
					id: 'pv_11',
					number: 'PV/26-27/000011',
					date: '2026-11-13',
					amountINR: 300,
					cancelledAt: '2026-11-14T10:00:00.000Z',
				}),
				voucher({ id: 'pv_si', amountINR: 0, against: { kind: 'selfInvoice', id: 'si_1', number: 'SI/1' } }),
			],
		});
		const expense = rows.filter((row) => row.kind.startsWith('expense_bill'));
		expect(
			expense.map((r) => [r.date, r.kind, r.documentNumber, r.details, r.billINR, r.paidOrCreditedINR]),
		).toEqual([
			['2026-11-04', 'expense_bill', 'EB/26-27/000001', 'Bill LP/26/1104', 31_600, 0],
			['2026-11-05', 'expense_bill', 'EB/26-27/000002', 'Bill SW/1', 1_180, 0],
			['2026-11-06', 'expense_bill_cancelled', 'EB/26-27/000002', 'Wrong supplier', 0, 1_180],
			['2026-11-07', 'expense_bill', 'EB/26-27/000003', 'Bill SW/2', 100, 0],
			['2026-11-08', 'expense_bill_cancelled', 'EB/26-27/000003', '', 0, 100],
			['2026-11-10', 'expense_bill_payment', 'PV/26-27/000009', 'EB/26-27/000001', 0, 20_000],
			['2026-11-11', 'expense_bill_payment', 'PV/26-27/000010', 'EB/26-27/000001', 0, 500],
			['2026-11-12', 'expense_bill_payment_cancelled', 'PV/26-27/000010', 'Paid twice', 500, 0],
			['2026-11-13', 'expense_bill_payment', 'PV/26-27/000011', 'EB/26-27/000001', 0, 300],
			['2026-11-14', 'expense_bill_payment_cancelled', 'PV/26-27/000011', '', 300, 0],
		]);
		// The self-invoice voucher stays a self-invoice payment; the balance is the bill less what was paid.
		expect(rows.some((row) => row.kind === 'self_invoice_payment')).toBe(true);
		expect(
			rows.find((row) => row.documentNumber === 'PV/26-27/000011' && row.kind.endsWith('cancelled'))?.balanceINR,
		).toBe(11_600);
	});
});
