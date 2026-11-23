import type {
	PaymentVoucher,
	PurchaseEntry,
	PurchaseReturn,
	SelfInvoice,
	SupplierPayment,
	SupplierStatementRow,
} from '@saha-textile/contracts';

import { fromPaise, toPaise } from './money';

/**
 * A supplier's account (s03): what we owe them, bill by bill and in total.
 *
 * The supplier's ledger, as the books keep it (a credit balance is what we owe):
 *   bill posted            +total
 *   payment                −amount     (a reversed payment adds it back)
 *   debit note sent        −total      (goods sent back or never received: we owe less)
 *   settled: credit note    0          (their credit note confirms the debit note)
 *   settled: later bill     0          (taken off another bill, already in the balance)
 *   settled: refund        +amount     (they paid the claim back in money)
 *   settled: written off   +amount     (they refused it; we owe what we deducted)
 *
 * All sums are worked in paise so a statement never drifts by a rupee.
 */

/** What is still to pay on one bill; negative when the supplier owes us on it. */
export function entryOutstanding(entry: Pick<PurchaseEntry, 'totals' | 'paidINR' | 'creditedINR'>): number {
	return fromPaise(toPaise(entry.totals.totalINR) - toPaise(entry.paidINR) - toPaise(entry.creditedINR ?? 0));
}

/** Paid once nothing is left to pay; part paid once any money went; else unpaid. */
export function entryPaymentStatus(
	entry: Pick<PurchaseEntry, 'totals' | 'paidINR' | 'creditedINR'>,
): 'unpaid' | 'part_paid' | 'paid' {
	if (entryOutstanding(entry) <= 0.005) return 'paid';
	return entry.paidINR > 0 ? 'part_paid' : 'unpaid';
}

/** Net credit a set of returns gives one entry: sent debit notes less refunds and write-offs. */
export function returnsCredit(returns: readonly PurchaseReturn[]): number {
	let paise = 0;
	for (const doc of returns) {
		if (doc.status === 'draft') continue;
		paise += toPaise(doc.totalINR);
		for (const settlement of doc.settlements ?? []) {
			if (settlement.how === 'refund' || settlement.how === 'written_off') paise -= toPaise(settlement.amountINR);
		}
	}
	return fromPaise(paise);
}

/** Money paid on one entry, reversed payments left out. */
export function paymentsTotal(payments: readonly SupplierPayment[]): number {
	return fromPaise(payments.filter((row) => !row.reversedAt).reduce((sum, row) => sum + toPaise(row.amountINR), 0));
}

/**
 * The statement: every bill, debit note, settlement and payment in date order with a running
 * balance. Same-day rows go bills first, then debit notes, then money, so a bill paid the day
 * it arrived never shows a negative balance in between. Self-invoices made for their reverse-charge supplies, and
 * the payment vouchers that paid them, sit on the same statement (accounts brief D).
 */
export function supplierStatement(input: {
	entries: readonly PurchaseEntry[];
	payments: readonly SupplierPayment[];
	returns: readonly PurchaseReturn[];
	selfInvoices?: readonly SelfInvoice[];
	selfInvoicePayments?: readonly PaymentVoucher[];
}): SupplierStatementRow[] {
	type Row = Omit<SupplierStatementRow, 'balanceINR'> & { order: number; billPaise: number; creditPaise: number };
	const rows: Row[] = [];
	const push = (row: Omit<Row, 'billINR' | 'paidOrCreditedINR'>) =>
		rows.push({ ...row, billINR: fromPaise(row.billPaise), paidOrCreditedINR: fromPaise(row.creditPaise) });

	for (const entry of input.entries) {
		if (entry.status !== 'posted' && entry.status !== 'void') continue;
		push({
			date: entry.billDate,
			kind: 'bill',
			documentId: entry.id,
			documentNumber: entry.number ?? entry.billNumber,
			details: `Bill ${entry.billNumber}`,
			order: 0,
			billPaise: toPaise(entry.totals.totalINR),
			creditPaise: 0,
		});
		if (entry.status === 'void' && entry.voidedAt) {
			push({
				date: entry.voidedAt.slice(0, 10),
				kind: 'credit_note',
				documentId: entry.id,
				documentNumber: entry.number ?? entry.billNumber,
				details: `Voided: ${entry.voidReason ?? ''}`.trim(),
				order: 1,
				billPaise: 0,
				creditPaise: toPaise(entry.totals.totalINR),
			});
		}
	}
	for (const doc of input.returns) {
		if (doc.status === 'draft' || !doc.sentAt) continue;
		push({
			date: doc.sentAt.slice(0, 10),
			kind: 'debit_note',
			documentId: doc.id,
			documentNumber: doc.number ?? '',
			details: doc.purchaseEntryNumber ? `Against ${doc.purchaseEntryNumber}` : '',
			order: 1,
			billPaise: 0,
			creditPaise: toPaise(doc.totalINR),
		});
		for (const settlement of doc.settlements ?? []) {
			const amount = toPaise(settlement.amountINR);
			if (settlement.how === 'refund' || settlement.how === 'written_off') {
				push({
					date: settlement.date,
					kind: settlement.how === 'refund' ? 'refund_received' : 'claim_written_off',
					documentId: doc.id,
					documentNumber: doc.number ?? '',
					details: settlement.reference ?? '',
					order: 2,
					billPaise: amount,
					creditPaise: 0,
				});
			} else {
				push({
					date: settlement.date,
					kind: 'credit_note',
					documentId: doc.id,
					documentNumber: doc.number ?? '',
					details:
						settlement.how === 'credit_note'
							? `Their credit note ${settlement.reference ?? ''}`.trim()
							: `Taken off a later bill ${settlement.reference ?? ''}`.trim(),
					order: 2,
					billPaise: 0,
					creditPaise: 0,
				});
			}
		}
	}
	for (const payment of input.payments) {
		push({
			date: payment.paidOn,
			kind: 'payment',
			documentId: payment.purchaseEntryId,
			documentNumber: payment.reference ?? '',
			details: payment.mode,
			order: 3,
			billPaise: 0,
			creditPaise: toPaise(payment.amountINR),
		});
		if (payment.reversedAt) {
			push({
				date: payment.reversedAt.slice(0, 10),
				kind: 'payment_reversed',
				documentId: payment.purchaseEntryId,
				documentNumber: payment.reference ?? '',
				details: payment.reverseReason ?? '',
				order: 4,
				billPaise: toPaise(payment.amountINR),
				creditPaise: 0,
			});
		}
	}

	for (const invoice of input.selfInvoices ?? []) {
		if (!invoice.number || !invoice.date) continue;
		const row = { documentId: invoice.id, documentNumber: invoice.number, details: invoice.rule.name };
		push({
			...row,
			date: invoice.date,
			kind: 'self_invoice',
			order: 0,
			billPaise: toPaise(invoice.taxableINR),
			creditPaise: 0,
		});
		if (invoice.cancelledAt)
			push({
				...row,
				date: invoice.cancelledAt.slice(0, 10),
				kind: 'self_invoice_cancelled',
				details: invoice.cancelReason ?? '',
				order: 1,
				billPaise: 0,
				creditPaise: toPaise(invoice.taxableINR),
			});
	}
	for (const voucher of (input.selfInvoicePayments ?? []).filter((pv) => pv.against.kind === 'selfInvoice')) {
		const row = { documentId: voucher.id, documentNumber: voucher.number };
		push({
			...row,
			date: voucher.date,
			kind: 'self_invoice_payment',
			details: voucher.against.number,
			order: 3,
			billPaise: 0,
			creditPaise: toPaise(voucher.amountINR),
		});
		if (voucher.cancelledAt)
			push({
				...row,
				date: voucher.cancelledAt.slice(0, 10),
				kind: 'self_invoice_payment_cancelled',
				details: voucher.cancelReason ?? '',
				order: 4,
				billPaise: toPaise(voucher.amountINR),
				creditPaise: 0,
			});
	}

	rows.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
	let balance = 0;
	return rows.map(({ order: _order, billPaise, creditPaise, ...row }) => {
		balance += billPaise - creditPaise;
		return { ...row, balanceINR: fromPaise(balance) };
	});
}
