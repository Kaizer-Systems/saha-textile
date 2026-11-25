import type { ExpenseBillLine } from '@saha-textile/contracts';

/**
 * Expense bills (brief 25 EB1; approved 2026-11-25). Pure: a bill's totals from its lines, and the voucher it posts.
 * Tax on each line is worked to the paisa; in-State bills split it half CGST and half SGST, other States IGST. A blocked
 * line's tax (s.17(5)) joins its expense; a claimable line's is input tax at the billed location. The supplier is owed
 * the whole bill.
 */

const paise = (inr: number) => Math.round(inr * 100);

export interface ExpenseBillTotals {
	taxableINR: number;
	cgstINR: number;
	sgstINR: number;
	igstINR: number;
	blockedTaxINR: number;
	totalINR: number;
}

/** One line's tax in paise (rate on taxable, to the paisa). */
const lineTax = (line: Pick<ExpenseBillLine, 'taxableINR' | 'gstRatePct'>) =>
	Math.round((paise(line.taxableINR) * line.gstRatePct) / 100);

export function expenseBillTotals(lines: readonly ExpenseBillLine[], interState: boolean): ExpenseBillTotals {
	let taxable = 0;
	let claim = 0;
	let blocked = 0;
	for (const line of lines) {
		taxable += paise(line.taxableINR);
		if (line.credit === 'blocked') blocked += lineTax(line);
		else claim += lineTax(line);
	}
	const half = Math.floor(claim / 2);
	const inr = (p: number) => p / 100;
	return {
		taxableINR: inr(taxable),
		cgstINR: interState ? 0 : inr(claim - half),
		sgstINR: interState ? 0 : inr(half),
		igstINR: interState ? inr(claim) : 0,
		blockedTaxINR: inr(blocked),
		totalINR: inr(taxable + claim + blocked),
	};
}

export interface ExpensePostingLine {
	ledger: { id: string } | { role: string };
	locationId: string;
	debitPaise?: number;
	creditPaise?: number;
	narration: string;
}

/** EB1's voucher: each expense (blocked tax in its cost) and the input tax debited at the billed location, the supplier credited. */
export function expenseBillPosting(bill: {
	lines: readonly ExpenseBillLine[];
	locationId: string;
	billNumber: string;
	interState: boolean;
}): ExpensePostingLine[] {
	const at = bill.locationId;
	const out: ExpensePostingLine[] = [];
	for (const line of bill.lines) {
		const cost = paise(line.taxableINR) + (line.credit === 'blocked' ? lineTax(line) : 0);
		if (cost)
			out.push({ ledger: { id: line.expenseLedgerId }, locationId: at, debitPaise: cost, narration: line.what });
	}
	const totals = expenseBillTotals(bill.lines, bill.interState);
	for (const [role, inr] of [
		['input_cgst', totals.cgstINR],
		['input_sgst', totals.sgstINR],
		['input_igst', totals.igstINR],
	] as const)
		if (inr)
			out.push({
				ledger: { role },
				locationId: at,
				debitPaise: paise(inr),
				narration: `Bill ${bill.billNumber}`,
			});
	out.push({
		ledger: { role: 'creditors_control' },
		locationId: at,
		creditPaise: paise(totals.totalINR),
		narration: `Bill ${bill.billNumber}`,
	});
	return out;
}
