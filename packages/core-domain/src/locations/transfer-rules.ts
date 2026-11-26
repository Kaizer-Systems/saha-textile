import type { ChartTemplateLedger } from '@saha-textile/contracts';

import { gstRateFor } from '../invoicing/tax-invoice-rules';

/**
 * Stock transfers between locations (accounts brief N; owner-approved D15, D19). Pure: the API moves the stock and
 * posts with these. A transfer within one GSTIN only moves stock at cost through Stock in transit; to another GSTIN it is
 * a supply between two persons under GST, made at cost with IGST, the branch accounts cancelling out across the company.
 */

const paise = (inr: number): number => Math.round(inr * 100);
const rupees = (p: number): number => p / 100;

/** Shared chart v4: where a piece lost on the way goes, or the claim on the carrier for it (N6). */
export const TRANSFER_LEDGERS: ChartTemplateLedger[] = [
	{
		key: 'transit_loss',
		name: 'Transit loss',
		groupKey: 'indirect_expenses',
		handPosting: false,
		roles: ['transit_loss'],
		ruleSetCode: null,
		source: '',
	},
	{
		key: 'carrier_claims_receivable',
		name: 'Claims on carriers',
		groupKey: 'loans_and_advances',
		handPosting: false,
		roles: ['carrier_claims_receivable'],
		ruleSetCode: null,
		source: '',
	},
];

/** A posting row for one end of the transfer: the sending location or the receiving one. */
export interface TransferPostingRow {
	role: string;
	at: 'sender' | 'receiver';
	debitPaise?: number;
	creditPaise?: number;
}

/** What a short piece becomes: a claim on the carrier, or a loss the business bears. */
export type ShortPieces = 'carrier_claim' | 'transit_loss';

/** A drawn cost layer: what the pieces cost and since when, carried to the receiving location. */
export interface DrawnLayer {
	layerId: string;
	quantity: number;
	unitCostINR: number;
	receivedAt: string;
}

/** A line's value at cost from the layers it drew on. */
export function drawnValueINR(drawn: readonly DrawnLayer[]): number {
	return rupees(drawn.reduce((sum, d) => sum + paise(d.unitCostINR * d.quantity), 0));
}

/**
 * Which drawn layers the pieces that arrived take, oldest first; what didn't arrive is taken from the newest.
 * Returns the layers to create at the receiving location and the cost of what is short.
 */
export function splitArrived(
	drawn: readonly DrawnLayer[],
	arrived: number,
): { arrived: DrawnLayer[]; shortValueINR: number } {
	const ordered = [...drawn].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
	const kept: DrawnLayer[] = [];
	let left = arrived;
	let shortPaise = 0;
	for (const layer of ordered) {
		const take = Math.min(left, layer.quantity);
		if (take > 0) kept.push({ ...layer, quantity: take });
		left -= take;
		shortPaise += paise(layer.unitCostINR * (layer.quantity - take));
	}
	return { arrived: kept, shortValueINR: rupees(shortPaise) };
}

/** A line of the branch invoice to another GSTIN: at cost, IGST at the item's rate. */
export interface BranchInvoiceLine {
	sku: string;
	hsn: string | null;
	quantity: number;
	valueINR: number;
}

export type BranchInvoiceProblem = { sku: string; problem: 'hsn_missing' | 'hsn_rate_missing' };

/** The branch transfer's taxable value and IGST, line by line; a line with no rate is a problem, not ₹0 tax. */
export function branchInvoice(lines: readonly BranchInvoiceLine[]): {
	problems: BranchInvoiceProblem[];
	lines: Array<BranchInvoiceLine & { ratePercent: number; igstINR: number }>;
	taxableINR: number;
	igstINR: number;
	totalINR: number;
} {
	const problems: BranchInvoiceProblem[] = [];
	const out: Array<BranchInvoiceLine & { ratePercent: number; igstINR: number }> = [];
	for (const line of lines) {
		if (!line.hsn) {
			problems.push({ sku: line.sku, problem: 'hsn_missing' });
			continue;
		}
		const unit = line.quantity > 0 ? line.valueINR / line.quantity : 0;
		const rate = gstRateFor(line.hsn, unit);
		if (rate === null) {
			problems.push({ sku: line.sku, problem: 'hsn_rate_missing' });
			continue;
		}
		out.push({ ...line, ratePercent: rate, igstINR: rupees(Math.round((paise(line.valueINR) * rate) / 100)) });
	}
	const taxablePaise = out.reduce((sum, l) => sum + paise(l.valueINR), 0);
	const igstPaise = out.reduce((sum, l) => sum + paise(l.igstINR), 0);
	return {
		problems,
		lines: out,
		taxableINR: rupees(taxablePaise),
		igstINR: rupees(igstPaise),
		totalINR: rupees(taxablePaise + igstPaise),
	};
}

/**
 * Dispatch: within one GSTIN the pieces leave the sender's stock for Stock in transit at cost; to another GSTIN the
 * sender supplies them at cost with IGST against the branch account, and their cost leaves its stock.
 */
export function transferDispatchPosting(input: {
	crossGstin: boolean;
	costINR: number;
	igstINR: number;
}): TransferPostingRow[] {
	const cost = paise(input.costINR);
	if (!input.crossGstin)
		return [
			{ role: 'stock_in_transit', at: 'sender', debitPaise: cost },
			{ role: 'stock_in_hand', at: 'sender', creditPaise: cost },
		];
	const igst = paise(input.igstINR);
	return [
		{ role: 'branch_account', at: 'sender', debitPaise: cost + igst },
		{ role: 'branch_transfer_sales', at: 'sender', creditPaise: cost },
		...(igst ? [{ role: 'output_igst', at: 'sender' as const, creditPaise: igst }] : []),
		{ role: 'cost_of_goods_sold', at: 'sender', debitPaise: cost },
		{ role: 'stock_in_hand', at: 'sender', creditPaise: cost },
	];
}

/**
 * Receipt: what arrived (good or damaged) enters the receiver's stock at the cost it left at; what is short becomes a
 * claim on the carrier or a transit loss. Across GSTINs the receiver takes input IGST only on what arrived (no credit
 * on goods lost), the short piece's tax going into the claim or the loss, against the branch account.
 */
export function transferReceivePosting(input: {
	crossGstin: boolean;
	costINR: number;
	arrivedCostINR: number;
	igstINR: number;
	short: ShortPieces;
}): TransferPostingRow[] {
	const cost = paise(input.costINR);
	const arrived = paise(input.arrivedCostINR);
	const shortCost = cost - arrived;
	const shortRole = input.short === 'carrier_claim' ? 'carrier_claims_receivable' : 'transit_loss';
	if (!input.crossGstin)
		return [
			...(arrived ? [{ role: 'stock_in_hand', at: 'receiver' as const, debitPaise: arrived }] : []),
			...(shortCost ? [{ role: shortRole, at: 'receiver' as const, debitPaise: shortCost }] : []),
			{ role: 'stock_in_transit', at: 'sender', creditPaise: cost },
		];
	const igst = paise(input.igstINR);
	const arrivedIgst = cost ? Math.round((igst * arrived) / cost) : 0;
	const shortIgst = igst - arrivedIgst;
	return [
		...(arrived ? [{ role: 'stock_in_hand', at: 'receiver' as const, debitPaise: arrived }] : []),
		...(arrivedIgst ? [{ role: 'input_igst', at: 'receiver' as const, debitPaise: arrivedIgst }] : []),
		...(shortCost + shortIgst
			? [{ role: shortRole, at: 'receiver' as const, debitPaise: shortCost + shortIgst }]
			: []),
		{ role: 'branch_account', at: 'receiver', creditPaise: cost + igst },
	];
}

/** N5: why Dispatch is off, one reason per unmet check; an empty list lets it go. */
export function dispatchBlockers(input: {
	lines: readonly { quantity: number; packed: number }[];
	sealNumber: string;
	ewayBillNeeded: boolean;
	ewayBillNumber: string | null;
}): Array<'not_all_packed' | 'seal_missing' | 'eway_bill_missing'> {
	const out: Array<'not_all_packed' | 'seal_missing' | 'eway_bill_missing'> = [];
	if (input.lines.some((l) => l.packed !== l.quantity)) out.push('not_all_packed');
	if (!input.sealNumber.trim()) out.push('seal_missing');
	if (input.ewayBillNeeded && !input.ewayBillNumber?.trim()) out.push('eway_bill_missing');
	return out;
}
