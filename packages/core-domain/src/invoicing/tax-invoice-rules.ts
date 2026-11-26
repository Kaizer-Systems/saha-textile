import type { TaxInvoiceLine } from '@saha-textile/contracts';

import { GARMENT_BAND_INR } from '../bundle/checks';

/**
 * Tax invoice rules (accounts brief D1, D3; owner-approved 2026-11-23). Pure: the API builds and checks every
 * invoice with them. Rates are today's, until the CA confirms them (round 2, B2.4–B2.6, B2.9).
 */

/**
 * Today's GST rate for an HSN code and a piece's price (tax included):
 * - chapters 50–60, fabrics (a saree is a woven fabric): 5%;
 * - chapters 61–63, garments and made-up textiles: 5% up to ₹2,500 a piece, 18% above it;
 * - anything else: unknown (null), so the invoice is refused until a rate is known.
 */
export function gstRateFor(hsn: string | null | undefined, unitPriceINR: number): number | null {
	const chapter = Number((hsn ?? '').slice(0, 2));
	if (!/^\d{4}(\d{2}){0,2}$/.test(hsn ?? '')) return null;
	if (chapter >= 50 && chapter <= 60) return 5;
	if (chapter >= 61 && chapter <= 63) return unitPriceINR <= GARMENT_BAND_INR ? 5 : 18;
	return null;
}

const paise = (inr: number): number => Math.round(inr * 100);
const rupees = (p: number): number => p / 100;

export interface InvoiceLineInput {
	lineId: string;
	sku: string;
	title: string;
	hsn: string | null;
	quantity: number;
	unit: 'PCS' | 'MTR';
	/** What the buyer paid for the line, tax included, after its share of discounts. */
	lineTotalINR: number;
}

export type InvoiceProblem = 'hsn_missing' | 'hsn_rate_missing' | 'no_lines';

/**
 * The invoice's lines and totals from tax-included line totals: each line's tax is taken out of its price at its
 * rate (taxable = total ÷ (1 + rate)), split into CGST and SGST in the seller's State, IGST to another State. The
 * shipping charge is taxed at the highest rate on the invoice (a composite supply follows its principal goods).
 */
export function buildInvoiceLines(
	lines: readonly InvoiceLineInput[],
	options: { interState: boolean; shippingINR: number; composition?: boolean },
): { problems: { lineId: string; problem: InvoiceProblem }[]; lines: TaxInvoiceLine[]; totals: InvoiceTotals } {
	const problems: { lineId: string; problem: InvoiceProblem }[] = [];
	const out: TaxInvoiceLine[] = [];
	for (const line of lines) {
		if (!line.hsn) {
			problems.push({ lineId: line.lineId, problem: 'hsn_missing' });
			continue;
		}
		const unitPriceINR = line.quantity > 0 ? line.lineTotalINR / line.quantity : 0;
		// Fabric is kept in tenths of a metre; its rate band is read on the price per metre. A composition seller's
		// bill of supply charges no tax: the whole price is the value.
		const rate = options.composition
			? 0
			: gstRateFor(line.hsn, line.unit === 'MTR' ? unitPriceINR * 10 : unitPriceINR);
		if (rate === null) {
			problems.push({ lineId: line.lineId, problem: 'hsn_rate_missing' });
			continue;
		}
		out.push({
			...splitTax(line.lineTotalINR, rate, options.interState),
			...lineFacts(line, line.hsn, unitPriceINR, rate),
		});
	}
	if (!lines.length) problems.push({ lineId: '', problem: 'no_lines' });
	const shippingRate = Math.max(0, ...out.map((l) => l.ratePercent));
	const shipping = options.shippingINR > 0 ? splitTax(options.shippingINR, shippingRate, options.interState) : null;
	return { problems, lines: out, totals: invoiceTotals(out, shipping) };
}

/**
 * A line's quantity as a document shows it (print, e-invoice, e-way bill, returns): metres for fabric, which the books
 * keep in tenths of a metre so lengths add up exactly, and pieces as they are. "2.5 m", never "25".
 */
export function documentQuantity(line: Pick<TaxInvoiceLine, 'quantity' | 'unit'>): number {
	return line.unit === 'MTR' ? line.quantity / 10 : line.quantity;
}

/** The quantity with its unit, as a document prints it: "2.5 m" or "3 pc". */
export function documentQuantityText(line: Pick<TaxInvoiceLine, 'quantity' | 'unit'>): string {
	return `${documentQuantity(line)} ${line.unit === 'MTR' ? 'm' : 'pc'}`;
}

/** The tax-included rate a document shows: per metre for fabric, per piece otherwise. */
export function documentUnitPrice(
	line: Pick<TaxInvoiceLine, 'quantity' | 'unit' | 'unitPriceINR' | 'totalINR'>,
): number {
	return line.unit === 'MTR' && line.quantity > 0
		? rupees(Math.round(paise(line.totalINR) / documentQuantity(line)))
		: line.unitPriceINR;
}

function lineFacts(line: InvoiceLineInput, hsn: string, unitPriceINR: number, rate: number) {
	return {
		lineId: line.lineId,
		sku: line.sku,
		title: line.title,
		hsn,
		quantity: line.quantity,
		unit: line.unit,
		unitPriceINR: rupees(paise(unitPriceINR)),
		ratePercent: rate,
	};
}

/** A tax-included amount split at a rate into taxable value and CGST + SGST (same State) or IGST, in paise. */
export function splitTax(totalINR: number, rate: number, interState: boolean) {
	const total = paise(totalINR);
	const taxable = Math.round((total * 100) / (100 + rate));
	const tax = total - taxable;
	const half = Math.floor(tax / 2);
	return {
		taxableINR: rupees(taxable),
		cgstINR: interState ? 0 : rupees(half),
		sgstINR: interState ? 0 : rupees(tax - half),
		igstINR: interState ? rupees(tax) : 0,
		totalINR: rupees(total),
	};
}

export interface InvoiceTotals {
	taxableINR: number;
	cgstINR: number;
	sgstINR: number;
	igstINR: number;
	shippingINR: number;
	roundOffINR: number;
	totalINR: number;
}

function invoiceTotals(lines: readonly TaxInvoiceLine[], shipping: ReturnType<typeof splitTax> | null): InvoiceTotals {
	const sum = (pick: (l: { taxableINR: number; cgstINR: number; sgstINR: number; igstINR: number }) => number) =>
		[...lines, ...(shipping ? [shipping] : [])].reduce((s, l) => s + paise(pick(l)), 0);
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
		shippingINR: shipping ? shipping.totalINR : 0,
		roundOffINR: rupees(rounded - exact),
		totalINR: rupees(rounded),
	};
}

/**
 * The invoice's posting (accounts brief Q, posting rules): the customer's advance as far as it goes, then the debtor; sales,
 * output CGST/SGST or IGST and rounding on the other side; and cost of goods sold against stock in hand.
 */
export function invoicePosting(input: {
	totals: InvoiceTotals;
	/** What the customer's advance still holds for this order (Postings and Convert brief P1): used first. */
	advanceINR: number;
	costINR: number;
}): { role: string; debitPaise?: number; creditPaise?: number }[] {
	const t = input.totals;
	const total = paise(t.totalINR);
	const advance = Math.min(total, paise(input.advanceINR));
	const rows: { role: string; debitPaise?: number; creditPaise?: number }[] = [];
	if (advance > 0) rows.push({ role: 'customer_advances', debitPaise: advance });
	if (total > advance) rows.push({ role: 'debtors_control', debitPaise: total - advance });
	rows.push({ role: 'sales', creditPaise: paise(t.taxableINR) });
	const taxes = [
		['output_cgst', t.cgstINR],
		['output_sgst', t.sgstINR],
		['output_igst', t.igstINR],
	] as const;
	for (const [role, amount] of taxes) if (amount) rows.push({ role, creditPaise: paise(amount) });
	const round = paise(t.roundOffINR);
	if (round > 0) rows.push({ role: 'rounding_off', creditPaise: round });
	if (round < 0) rows.push({ role: 'rounding_off', debitPaise: -round });
	const cost = paise(input.costINR);
	if (cost > 0) {
		rows.push({ role: 'cost_of_goods_sold', debitPaise: cost });
		rows.push({ role: 'stock_in_hand', creditPaise: cost });
	}
	return rows;
}
