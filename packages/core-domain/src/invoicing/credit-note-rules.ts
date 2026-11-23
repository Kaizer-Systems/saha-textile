import type { CreditNoteLine, ReturnOutcome, TaxInvoice, TaxInvoiceLine } from '@saha-textile/contracts';

import { addDays } from '../purchasing/fiscal-year';
import { splitTax } from './tax-invoice-rules';

/**
 * Credit and debit note rules (accounts brief B1–B11, D4; owner-approved 2026-11-23). Pure: the API builds and checks
 * every return, credit note and debit note with them. A note's lines and tax always come from its invoice's lines.
 */

const paise = (inr: number): number => Math.round(inr * 100);
const rupees = (p: number): number => p / 100;

/** The services code for delivery on a note's delivery share line. */
export const NOTE_DELIVERY_SAC = '996812';

/** CGST Act s.34(2): a credit note goes in a return no later than 30 November after the end of the invoice's year. */
export function creditNoteDeadline(invoiceDate: string): string {
	const [year, month] = invoiceDate.split('-').map(Number) as [number, number];
	return `${month >= 4 ? year + 1 : year}-11-30`;
}

/** D4: a return can be started until N days after delivery (inclusive). No delivery yet: no window. */
export function returnWindow(
	deliveredOn: string | null,
	windowDays: number,
	today: string,
): { ends: string | null; open: boolean } {
	if (!deliveredOn) return { ends: null, open: false };
	const ends = addDays(deliveredOn, windowDays);
	return { ends, open: today <= ends };
}

export interface NotePick {
	lineId: string;
	quantity: number;
	outcome?: ReturnOutcome | null;
	unitCostINR?: number | null;
	note?: string;
}

/**
 * A credit note's goods lines: each picked line's share of its invoice line, in paise. The whole line gives back
 * exactly what was invoiced; a part gives back that many pieces' share, the last pieces taking what is left over.
 */
export function creditLinesFor(
	invoiceLines: readonly TaxInvoiceLine[],
	picks: readonly NotePick[],
	creditedBefore: ReadonlyMap<string, number> = new Map(),
): CreditNoteLine[] {
	const out: CreditNoteLine[] = [];
	for (const pick of picks) {
		const line = invoiceLines.find((l) => l.lineId === pick.lineId);
		if (!line || pick.quantity <= 0) continue;
		const before = creditedBefore.get(line.lineId) ?? 0;
		const last = before + pick.quantity >= line.quantity;
		const share = (amount: number) => {
			const whole = paise(amount);
			if (!last) return rupees(Math.round((whole * pick.quantity) / line.quantity));
			// The last pieces take what the earlier notes left, so the notes add up to the invoice line exactly.
			return rupees(whole - Math.round((whole * before) / line.quantity));
		};
		out.push({
			...line,
			quantity: pick.quantity,
			taxableINR: share(line.taxableINR),
			cgstINR: share(line.cgstINR),
			sgstINR: share(line.sgstINR),
			igstINR: share(line.igstINR),
			totalINR: share(line.totalINR),
			outcome: pick.outcome ?? null,
			unitCostINR: pick.unitCostINR ?? null,
			layerId: null,
			holdId: null,
			delivery: false,
			note: pick.note ?? '',
		});
	}
	return out;
}

/** B10: lines lowered in price, the tax taken out of the amount at each line's own rate. No goods move. */
export function priceAdjustmentLines(
	invoiceLines: readonly TaxInvoiceLine[],
	picks: readonly { lineId: string; lowerByINR: number }[],
	interState: boolean,
): CreditNoteLine[] {
	const out: CreditNoteLine[] = [];
	for (const pick of picks) {
		const line = invoiceLines.find((l) => l.lineId === pick.lineId);
		if (!line || pick.lowerByINR <= 0) continue;
		out.push({
			...line,
			unitPriceINR: rupees(Math.round(paise(pick.lowerByINR) / line.quantity)),
			...splitTax(pick.lowerByINR, line.ratePercent, interState),
			outcome: null,
			unitCostINR: null,
			layerId: null,
			holdId: null,
			delivery: false,
			note: '',
		});
	}
	return out;
}

/**
 * The delivery share line (CA B7.3): ₹0 until the CA says how much of a delivery charge a return gives back. Its
 * note says why it is nothing: the order's delivery was free, or the answer is awaited.
 */
export function deliveryShareLine(invoice: Pick<TaxInvoice, 'shippingINR'>): CreditNoteLine {
	return {
		lineId: 'delivery',
		sku: '',
		title: 'Delivery charge share',
		hsn: NOTE_DELIVERY_SAC,
		quantity: 1,
		unit: 'PCS',
		unitPriceINR: 0,
		ratePercent: 0,
		taxableINR: 0,
		cgstINR: 0,
		sgstINR: 0,
		igstINR: 0,
		totalINR: 0,
		outcome: null,
		unitCostINR: null,
		layerId: null,
		holdId: null,
		delivery: true,
		note: invoice.shippingINR > 0 ? 'waits_for_ca' : 'free_delivery',
	};
}

export interface NoteTotals {
	taxableINR: number;
	cgstINR: number;
	sgstINR: number;
	igstINR: number;
	roundOffINR: number;
	totalINR: number;
}

/** A note's totals from its lines, rounded to the rupee as its invoice was. */
export function noteTotals(
	lines: readonly Pick<CreditNoteLine, 'taxableINR' | 'cgstINR' | 'sgstINR' | 'igstINR'>[],
): NoteTotals {
	const sum = (pick: (l: (typeof lines)[number]) => number) => lines.reduce((s, l) => s + paise(pick(l)), 0);
	const taxable = sum((l) => l.taxableINR);
	const cgst = sum((l) => l.cgstINR);
	const sgst = sum((l) => l.sgstINR);
	const igst = sum((l) => l.igstINR);
	const exact = taxable + cgst + sgst + igst;
	const rounded = Math.round(exact / 100) * 100;
	return {
		taxableINR: rupees(taxable),
		cgstINR: rupees(cgst),
		sgstINR: rupees(sgst),
		igstINR: rupees(igst),
		roundOffINR: rupees(rounded - exact),
		totalINR: rupees(rounded),
	};
}

export type NoteProblem = 'nothing_to_credit' | 'more_than_invoiced' | 'past_deadline' | 'too_many_pieces';

/**
 * Before a credit note is saved or issued: something to give back, never more pieces than are left on a line,
 * never more money than the invoice less earlier notes, and not after the s.34 deadline.
 */
export function creditNoteProblems(input: {
	lines: readonly Pick<CreditNoteLine, 'lineId' | 'quantity' | 'totalINR' | 'delivery'>[];
	invoice: Pick<TaxInvoice, 'totalINR' | 'lines'>;
	creditedINR: number;
	creditedPieces: ReadonlyMap<string, number>;
	kind: 'goods_returned' | 'price_adjustment' | 'undelivered';
	deadline: string;
	today: string;
}): NoteProblem[] {
	const problems = new Set<NoteProblem>();
	const goods = input.lines.filter((l) => !l.delivery);
	const total = input.lines.reduce((s, l) => s + paise(l.totalINR), 0);
	if (!goods.length || total <= 0) problems.add('nothing_to_credit');
	if (paise(input.creditedINR) + total > paise(input.invoice.totalINR)) problems.add('more_than_invoiced');
	if (input.today > input.deadline) problems.add('past_deadline');
	if (input.kind !== 'price_adjustment')
		for (const line of goods) {
			const invoiced = input.invoice.lines.find((l) => l.lineId === line.lineId)?.quantity ?? 0;
			if ((input.creditedPieces.get(line.lineId) ?? 0) + line.quantity > invoiced)
				problems.add('too_many_pieces');
		}
	return [...problems];
}

type PostingRow = { systemKey: string; debitPaise?: number; creditPaise?: number };

/**
 * A credit note's posting (posting rules, "Credit note for a return"): sales returns and the output tax back on the
 * debit side, the customer credited; pieces back in stock (to sell, or held as damaged) leave cost of goods sold.
 */
export function creditNotePosting(input: { totals: NoteTotals; restockCostINR: number }): PostingRow[] {
	const t = input.totals;
	const rows: PostingRow[] = [{ systemKey: 'sales_returns', debitPaise: paise(t.taxableINR) }];
	const taxes = [
		['output_cgst', t.cgstINR],
		['output_sgst', t.sgstINR],
		['output_igst', t.igstINR],
	] as const;
	for (const [systemKey, amount] of taxes) if (amount) rows.push({ systemKey, debitPaise: paise(amount) });
	rows.push({ systemKey: 'debtors_control', creditPaise: paise(t.totalINR) });
	const round = paise(t.roundOffINR);
	if (round > 0) rows.push({ systemKey: 'rounding_off', debitPaise: round });
	if (round < 0) rows.push({ systemKey: 'rounding_off', creditPaise: -round });
	const cost = paise(input.restockCostINR);
	if (cost > 0) {
		rows.push({ systemKey: 'stock_in_hand', debitPaise: cost });
		rows.push({ systemKey: 'cost_of_goods_sold', creditPaise: cost });
	}
	return rows;
}

/** A debit note undoing a credit note posts its exact opposite, in the month it is made (B9). */
export function debitNotePosting(input: { totals: NoteTotals; restockCostINR: number }): PostingRow[] {
	return creditNotePosting(input).map((row) => ({
		systemKey: row.systemKey,
		...(row.debitPaise ? { creditPaise: row.debitPaise } : { debitPaise: row.creditPaise }),
	}));
}

/** What pieces back in stock cost: restocked and damaged-but-kept pieces at their own cost; written off, nothing. */
export function restockCost(lines: readonly Pick<CreditNoteLine, 'outcome' | 'quantity' | 'unitCostINR'>[]): number {
	const cost = lines
		.filter((l) => l.outcome === 'restock' || l.outcome === 'damaged')
		.reduce((s, l) => s + paise((l.unitCostINR ?? 0) * l.quantity), 0);
	return rupees(cost);
}

/** B8: only a super admin, only while the note's month isn't filed or its books closed, and before the refund. */
export function creditNoteCancelAllowed(checks: {
	monthFiled: boolean;
	booksClosed: boolean;
	refundPaid: boolean;
	superAdmin: boolean;
}): boolean {
	return checks.superAdmin && !checks.monthFiled && !checks.booksClosed && !checks.refundPaid;
}
