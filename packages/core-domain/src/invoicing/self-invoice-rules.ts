import type { RcmChoice, SelfInvoice } from '@saha-textile/contracts';

import { addDays, daysBetween } from '../purchasing/fiscal-year';

const paise = (rupees: number): number => Math.round(rupees * 100);
const rupees = (p: number): number => p / 100;

/** Rule 47A: a self-invoice is made within 30 days of receiving the supply. */
export const SELF_INVOICE_DAYS = 30;

/** The last day a self-invoice is on time. */
export function selfInvoiceDeadline(receivedOn: string): string {
	return addDays(receivedOn, SELF_INVOICE_DAYS);
}

/** "Made on day 20 of 30": the days since the supply was received (D3). */
export function selfInvoiceDay(receivedOn: string, day: string): number {
	return daysBetween(receivedOn, day);
}

/**
 * The tax we pay on a reverse-charge supply. Within our State it is CGST and SGST at half the rate each (each half
 * rounded to the paisa); from another State, IGST at the full rate.
 */
export function selfInvoiceTax(
	taxableINR: number,
	ratePercent: number,
	interState: boolean,
): Pick<SelfInvoice, 'cgstINR' | 'sgstINR' | 'igstINR' | 'taxINR' | 'totalINR'> {
	const taxable = paise(taxableINR);
	const half = Math.round((taxable * ratePercent) / 200);
	const igst = interState ? Math.round((taxable * ratePercent) / 100) : 0;
	const cgst = interState ? 0 : half;
	const tax = cgst * 2 + igst;
	return {
		cgstINR: rupees(cgst),
		sgstINR: rupees(cgst),
		igstINR: rupees(igst),
		taxINR: rupees(tax),
		totalINR: rupees(taxable + tax),
	};
}

/**
 * Why a reverse-charge supply can't be saved or issued: the supplier has a GSTIN (it charges the tax itself), the "What"
 * isn't on the list for that day and kind of company, or it was received in the future. Issuing late is allowed and
 * flagged, never refused.
 */
export function selfInvoiceProblems(input: {
	supplierGstin: string | null;
	choice: RcmChoice | null;
	receivedOn: string;
	today: string;
}): string[] {
	const problems: string[] = [];
	if (input.supplierGstin) problems.push('supplier_has_gstin');
	if (!input.choice) problems.push('not_on_reverse_charge_list');
	if (input.receivedOn > input.today) problems.push('received_in_future');
	return problems;
}

type PostingRow = { role: string; debitPaise?: number; creditPaise?: number };

/**
 * Issuing a self-invoice (posting rules, "Self-invoice (reverse charge)"): the expense of the rule's role and the input
 * tax under reverse charge (claimable once the tax is paid), against the supplier for the value and the reverse-charge
 * tax payable for the tax.
 */
export function selfInvoicePosting(invoice: Pick<SelfInvoice, 'rule' | 'taxableINR' | 'taxINR'>): PostingRow[] {
	const rows: PostingRow[] = [
		{ role: invoice.rule.expenseRole, debitPaise: paise(invoice.taxableINR) },
		{ role: 'creditors_control', creditPaise: paise(invoice.taxableINR) },
	];
	if (invoice.taxINR > 0)
		rows.splice(
			1,
			0,
			{ role: 'input_gst_rcm', debitPaise: paise(invoice.taxINR) },
			{ role: 'rcm_payable', creditPaise: paise(invoice.taxINR) },
		);
	return rows;
}

/** Paying the supplier of a self-invoice: the supplier is settled against the cash or bank ledger paid from. */
export function supplierPaymentPosting(
	amountINR: number,
	paidFrom: { role: string } | { id: string },
): { ledger: { role: string } | { id: string }; debitPaise?: number; creditPaise?: number }[] {
	return [
		{ ledger: { role: 'creditors_control' }, debitPaise: paise(amountINR) },
		{ ledger: paidFrom, creditPaise: paise(amountINR) },
	];
}

/** A self-invoice can be cancelled by a super admin before anything is paid on it, while its month isn't filed. */
export function selfInvoiceCancelProblems(
	invoice: Pick<SelfInvoice, 'status' | 'paidINR'>,
	checks: { superAdmin: boolean; monthFiled: boolean },
): string[] {
	const problems: string[] = [];
	if (invoice.status !== 'issued') problems.push('self_invoice_not_issued');
	if (!checks.superAdmin) problems.push('only_super_admin');
	if (invoice.paidINR > 0) problems.push('self_invoice_paid');
	if (checks.monthFiled) problems.push('month_filed');
	return problems;
}

/**
 * A payment voucher is cancelled by a super admin while its month is open for its cash or bank part; the bill is then
 * owed again and the payment's posting reversed.
 */
export function paymentVoucherCancelProblems(
	voucher: { status: 'paid' | 'cancelled' },
	checks: { superAdmin: boolean; monthLocked: boolean },
): string[] {
	const problems: string[] = [];
	if (voucher.status === 'cancelled') problems.push('payment_voucher_cancelled');
	if (!checks.superAdmin) problems.push('only_super_admin');
	if (checks.monthLocked) problems.push('month_locked');
	return problems;
}
