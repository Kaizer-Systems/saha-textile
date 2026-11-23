import type { MoneyLanding, PaymentMethod, PaymentMode } from '@saha-textile/contracts';

/**
 * Receipts and purchases in the books (Postings and Convert brief P1, approved 24 Nov): the debits and credits of a
 * payment received on an order, a purchase entry, a payment to a supplier and a purchase return. Rows name roles, or a
 * ledger by id where "Where money lands" (P2) chose one.
 */

const paise = (rupees: number): number => Math.round(rupees * 100);

export type LedgerRef = { role: string } | { id: string };
export interface MoneyRow {
	ledger: LedgerRef;
	debitPaise?: number;
	creditPaise?: number;
}

const either = (id: string | null, role: string): LedgerRef => (id ? { id } : { role });

/**
 * Where a payment received on an order landed. On account and set-off move no money (null). A bank transfer or cheque
 * needs the bank account set in "Where money lands": refused with `money_lands_not_set:received_by_bank` otherwise.
 */
export function receiptLanding(method: PaymentMethod, landing: MoneyLanding): LedgerRef | null {
	switch (method) {
		case 'gateway':
			return either(landing.receivedByGateway, 'gateway_clearing');
		case 'upi':
			return upiLanding(landing);
		case 'cashOnDelivery':
			return either(landing.cashOnDelivery, 'cod_receivable');
		case 'bankTransfer':
			return bankLanding(landing);
		default:
			return null;
	}
}

/** Where money received by UPI lands: the ledger set, else UPI and card clearing. */
export function upiLanding(landing: MoneyLanding): LedgerRef {
	return either(landing.receivedByUpi, 'upi_card_clearing');
}

/** The bank account money received by transfer or cheque lands in (refused when none is set). */
export function bankLanding(landing: MoneyLanding): LedgerRef {
	if (!landing.receivedByBank) throw new Error('money_lands_not_set:received_by_bank');
	return { id: landing.receivedByBank };
}

/** A payment received: where it landed against the customer's advance, or their debt once invoiced. */
export function receiptPosting(amountINR: number, landed: LedgerRef, invoiced: boolean): MoneyRow[] {
	return [
		{ ledger: landed, debitPaise: paise(amountINR) },
		{ ledger: { role: invoiced ? 'debtors_control' : 'customer_advances' }, creditPaise: paise(amountINR) },
	];
}

/** Where a payment to a supplier left from: cash, or the bank account set (refused when none is). */
export function supplierPaymentFrom(mode: PaymentMode, landing: MoneyLanding): LedgerRef {
	if (mode === 'cash') return either(landing.paidInCash, 'cash');
	if (!landing.paidByBank) throw new Error('money_lands_not_set:paid_by_bank');
	return { id: landing.paidByBank };
}

/** Money a supplier paid back on a debit note: where it landed against their account (payments: self-invoice rules). */
export function supplierRefundPosting(amountINR: number, landed: LedgerRef): MoneyRow[] {
	return [
		{ ledger: landed, debitPaise: paise(amountINR) },
		{ ledger: { role: 'creditors_control' }, creditPaise: paise(amountINR) },
	];
}

export interface BillTotals {
	taxableINR: number;
	cgstINR: number;
	sgstINR: number;
	igstINR: number;
	totalINR: number;
}

/** A bill whose input tax can't be claimed (P5) carries that tax in the cost of its stock. */
export function billTotals(totals: BillTotals, itcClaimable: boolean): BillTotals {
	if (itcClaimable) return totals;
	return {
		taxableINR: totals.taxableINR + totals.cgstINR + totals.sgstINR + totals.igstINR,
		cgstINR: 0,
		sgstINR: 0,
		igstINR: 0,
		totalINR: totals.totalINR,
	};
}

/** The goods and input tax of a bill or a return, and the rounding that makes up its total. */
function goodsAndTax(totals: BillTotals): { role: string; paise: number }[] {
	const rows = [
		{ role: 'stock_in_hand', paise: paise(totals.taxableINR) },
		{ role: 'input_cgst', paise: paise(totals.cgstINR) },
		{ role: 'input_sgst', paise: paise(totals.sgstINR) },
		{ role: 'input_igst', paise: paise(totals.igstINR) },
	].filter((row) => row.paise > 0);
	const rounding = paise(totals.totalINR) - rows.reduce((sum, row) => sum + row.paise, 0);
	return rounding ? [...rows, { role: 'rounding_off', paise: rounding }] : rows;
}

/** A purchase entry posted: stock and input tax against the supplier (rounding either way). */
export function purchaseEntryPosting(totals: BillTotals): MoneyRow[] {
	return [
		...goodsAndTax(totals).map((row) =>
			row.paise > 0
				? { ledger: { role: row.role }, debitPaise: row.paise }
				: { ledger: { role: row.role }, creditPaise: -row.paise },
		),
		{ ledger: { role: 'creditors_control' }, creditPaise: paise(totals.totalINR) },
	];
}

/** A purchase return sent: the supplier owes back its total, against the stock and input tax. */
export function purchaseReturnPosting(totals: BillTotals): MoneyRow[] {
	return reversed(purchaseEntryPosting(totals));
}

/** The same rows with debits and credits swapped (a void, a reversal, a cancel). */
export function reversed(rows: readonly MoneyRow[]): MoneyRow[] {
	return rows.map((row) =>
		row.debitPaise
			? { ledger: row.ledger, creditPaise: row.debitPaise }
			: { ledger: row.ledger, debitPaise: row.creditPaise },
	);
}
